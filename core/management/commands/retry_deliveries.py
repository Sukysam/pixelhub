from types import SimpleNamespace
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.db import transaction
from django.db import models
from django.utils import timezone

from core.documents import send_delivery
from core.models import DocumentDelivery


def _backoff_seconds(attempt_count: int) -> int:
    attempt = max(0, int(attempt_count))
    base = 60
    cap = 6 * 60 * 60
    delay = base * (2**attempt)
    return int(min(cap, max(base, delay)))


class Command(BaseCommand):
    def add_arguments(self, parser):
        parser.add_argument("--limit", type=int, default=50)
        parser.add_argument("--max-attempts", type=int, default=6)

    def handle(self, *args, **options):
        limit = max(1, min(int(options["limit"]), 500))
        max_attempts = max(1, min(int(options["max_attempts"]), 20))
        now = timezone.now()

        qs = (
            DocumentDelivery.objects.filter(status__in=["queued", "failed"], attempt_count__lt=max_attempts)
            .filter(models.Q(next_retry_at__isnull=True) | models.Q(next_retry_at__lte=now))
            .select_related("user", "invoice", "receipt", "receipt__invoice")
            .order_by("next_retry_at", "id")
        )[:limit]

        picked = list(qs)
        if not picked:
            self.stdout.write("0")
            return

        ok_count = 0
        fail_count = 0
        for delivery in picked:
            req = SimpleNamespace(user=delivery.user, headers={}, META={}, query_params={})
            try:
                with transaction.atomic():
                    locked = DocumentDelivery.objects.select_for_update().get(pk=delivery.pk)
                    if locked.status not in ("queued", "failed"):
                        continue
                    locked.status = "sending"
                    locked.save(update_fields=["status", "updated_at"])
                send_delivery(req, locked, token=None)
                ok_count += 1
            except Exception as e:
                with transaction.atomic():
                    locked = DocumentDelivery.objects.select_for_update().get(pk=delivery.pk)
                    locked.status = "failed"
                    locked.attempt_count = (locked.attempt_count or 0) + 1
                    locked.last_attempt_at = timezone.now()
                    locked.last_error_code = e.__class__.__name__
                    locked.last_error_message = str(e)[:255]
                    locked.next_retry_at = timezone.now() + timedelta(seconds=_backoff_seconds(locked.attempt_count))
                    locked.save(
                        update_fields=[
                            "status",
                            "attempt_count",
                            "last_attempt_at",
                            "last_error_code",
                            "last_error_message",
                            "next_retry_at",
                            "updated_at",
                        ]
                    )
                fail_count += 1
        self.stdout.write(f"{ok_count}:{fail_count}")
