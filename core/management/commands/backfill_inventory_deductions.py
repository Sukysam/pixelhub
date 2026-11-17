from django.core.management.base import BaseCommand
from django.db import transaction
from rest_framework.exceptions import ValidationError

from core.finance_services import deduct_inventory_for_invoice
from core.models import Invoice


DEFAULT_STATUSES = "Sent,Paid"


class Command(BaseCommand):
    help = (
        "Deduct inventory for invoices that were completed before automatic "
        "deduction was wired in. Idempotent: invoices already stamped with "
        "inventory_deducted_at are skipped, so it is safe to re-run."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--status",
            default=DEFAULT_STATUSES,
            help=(
                "Comma-separated invoice statuses to treat as completed sales "
                f"(default: {DEFAULT_STATUSES}). Add Draft/Overdue to also "
                "deduct those, e.g. --status Draft,Sent,Paid,Overdue."
            ),
        )
        parser.add_argument(
            "--invoice",
            action="append",
            default=None,
            help="Limit the run to specific invoice numbers (repeatable).",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Report what would change without writing anything.",
        )
        parser.add_argument(
            "--force",
            action="store_true",
            help="Deduct even when current stock is insufficient (stock may go negative).",
        )

    def handle(self, *args, **options):
        statuses = [s.strip() for s in options["status"].split(",") if s.strip()]
        invoice_numbers = options["invoice"]
        dry_run = options["dry_run"]
        allow_negative = options["force"]

        qs = (
            Invoice.objects.filter(
                is_deleted=False,
                status__in=statuses,
                inventory_deducted_at__isnull=True,
            )
            .order_by("id")
        )
        if invoice_numbers:
            qs = qs.filter(invoice_number__in=invoice_numbers)

        pending = list(qs.values_list("pk", "invoice_number", "status"))
        if not pending:
            self.stdout.write("Nothing to do: no matching invoices are awaiting a deduction.")
            return

        mode = "DRY-RUN" if dry_run else "APPLY"
        self.stdout.write(f"[{mode}] {len(pending)} invoice(s) to process (statuses: {', '.join(statuses)}).")

        deducted = 0
        skipped = 0
        failed = 0

        for pk, invoice_number, invoice_status in pending:
            try:
                with transaction.atomic():
                    locked = Invoice.objects.select_for_update().get(pk=pk)
                    if locked.inventory_deducted_at is not None:
                        skipped += 1
                        continue
                    deduct_inventory_for_invoice(locked, allow_negative=allow_negative)
                    if dry_run:
                        # Roll back so the preview leaves the database untouched.
                        transaction.set_rollback(True)
                deducted += 1
                if dry_run:
                    self.stdout.write(f"  would deduct  {invoice_number} ({invoice_status})")
                else:
                    self.stdout.write(self.style.SUCCESS(f"  deducted      {invoice_number} ({invoice_status})"))
            except ValidationError as exc:
                failed += 1
                detail = getattr(exc, "detail", exc)
                self.stdout.write(
                    self.style.WARNING(
                        f"  skipped       {invoice_number} ({invoice_status}): {detail} "
                        "(re-run with --force to deduct anyway)"
                    )
                )
            except Exception as exc:  # noqa: BLE001 - keep the batch running on any single failure
                failed += 1
                self.stderr.write(f"  error         {invoice_number} ({invoice_status}): {exc.__class__.__name__}: {exc}")

        summary = f"[{mode}] processed={deducted} skipped={skipped} failed={failed}"
        if dry_run:
            self.stdout.write(self.style.HTTP_INFO(summary))
        elif failed:
            self.stdout.write(self.style.WARNING(summary))
        else:
            self.stdout.write(self.style.SUCCESS(summary))
