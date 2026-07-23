from __future__ import annotations

from decimal import Decimal

from django.db import models
from django.db.models import Count, F, Max, OuterRef, Subquery, Sum
from django.db.models.functions import Coalesce

from .models import Expense, SourceAccountDeposit

BALANCE_OUTPUT_FIELD = models.DecimalField(max_digits=12, decimal_places=2)
ZERO_BALANCE = Decimal("0.00")
ZERO_COUNT = 0


def annotate_source_account_balance_fields(queryset):
    expense_totals = (
        Expense.objects.filter(source_account=OuterRef("pk"), is_deleted=False)
        .values("source_account")
        .annotate(total=Sum("amount"), count=Count("id"))
    )
    deposit_totals = (
        SourceAccountDeposit.objects.filter(source_account=OuterRef("pk"))
        .values("source_account")
        .annotate(total=Sum("amount"), count=Count("id"), last_deposit_at=Max("deposited_at"))
    )
    return queryset.annotate(
        active_expense_total=Coalesce(
            Subquery(expense_totals.values("total")[:1], output_field=BALANCE_OUTPUT_FIELD),
            ZERO_BALANCE,
            output_field=BALANCE_OUTPUT_FIELD,
        ),
        active_expense_count=Coalesce(
            Subquery(expense_totals.values("count")[:1], output_field=models.IntegerField()),
            ZERO_COUNT,
            output_field=models.IntegerField(),
        ),
        total_deposited=Coalesce(
            Subquery(deposit_totals.values("total")[:1], output_field=BALANCE_OUTPUT_FIELD),
            ZERO_BALANCE,
            output_field=BALANCE_OUTPUT_FIELD,
        ),
        deposit_count=Coalesce(
            Subquery(deposit_totals.values("count")[:1], output_field=models.IntegerField()),
            ZERO_COUNT,
            output_field=models.IntegerField(),
        ),
        last_deposit_at=Subquery(deposit_totals.values("last_deposit_at")[:1], output_field=models.DateTimeField()),
    ).annotate(
        current_balance=models.ExpressionWrapper(
            F("initial_balance") + F("total_deposited") - F("active_expense_total"),
            output_field=BALANCE_OUTPUT_FIELD,
        )
    )

