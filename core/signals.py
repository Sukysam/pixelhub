from django.db.models.signals import pre_save, post_save
from django.dispatch import receiver
from django.db import transaction
from django.utils import timezone
from django.contrib.auth import get_user_model
from .models import Invoice, InvoiceNumberSequence
from .rbac import sync_user_role_from_flags


def generate_invoice_number():
    year = timezone.now().year
    with transaction.atomic():
        seq, _ = InvoiceNumberSequence.objects.select_for_update().get_or_create(year=year)
        seq.last_number += 1
        seq.save(update_fields=["last_number"])
        return f"INV-{year}-{seq.last_number:04d}"


@receiver(pre_save, sender=Invoice)
def set_invoice_number(sender, instance, **kwargs):
    if not instance.invoice_number:
        instance.invoice_number = generate_invoice_number()


@receiver(post_save, sender=get_user_model())
def sync_user_role(sender, instance, **kwargs):
    sync_user_role_from_flags(instance)
