from __future__ import annotations

import re

from django.db import migrations, models
from django.utils import timezone


GENERATED_CODE_RE = re.compile(r"^PRJ-(\d{4})-(\d+)$")


def _normalize_project_code(value) -> str:
    return re.sub(r"\s+", "-", str(value or "").strip()).upper()


def seed_project_codes_and_sequences(apps, schema_editor):
    Expense = apps.get_model("core", "Expense")
    ProjectCodeSequence = apps.get_model("core", "ProjectCodeSequence")

    used_codes: set[str] = set()
    max_by_year: dict[int, int] = {}

    expenses = Expense.objects.filter(is_deleted=False).order_by("expense_date", "id")
    for expense in expenses.iterator():
        normalized = _normalize_project_code(getattr(expense, "project_code", None))
        if not normalized:
            if getattr(expense, "project_code", None) not in (None, ""):
                expense.project_code = None
                expense.save(update_fields=["project_code"])
            continue

        match = GENERATED_CODE_RE.match(normalized)
        if match and normalized not in used_codes:
            year = int(match.group(1))
            number = int(match.group(2))
            max_by_year[year] = max(max_by_year.get(year, 0), number)

        if normalized not in used_codes:
            used_codes.add(normalized)
            if expense.project_code != normalized:
                expense.project_code = normalized
                expense.save(update_fields=["project_code"])
            continue

        year = int(getattr(expense, "expense_date", None).year if getattr(expense, "expense_date", None) else timezone.now().year)
        next_number = max_by_year.get(year, 0) + 1
        candidate = f"PRJ-{year}-{next_number:04d}"
        while candidate in used_codes:
            next_number += 1
            candidate = f"PRJ-{year}-{next_number:04d}"
        expense.project_code = candidate
        expense.save(update_fields=["project_code"])
        used_codes.add(candidate)
        max_by_year[year] = next_number

    for year, last_number in max_by_year.items():
        ProjectCodeSequence.objects.update_or_create(year=year, defaults={"last_number": last_number})


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0033_item_category"),
    ]

    operations = [
        migrations.CreateModel(
            name="ProjectCodeSequence",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("year", models.IntegerField(unique=True)),
                ("last_number", models.IntegerField(default=0)),
            ],
        ),
        migrations.RunPython(seed_project_codes_and_sequences, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name="expense",
            constraint=models.UniqueConstraint(
                condition=models.Q(is_deleted=False, project_code__isnull=False) & ~models.Q(project_code=""),
                fields=("project_code",),
                name="uniq_active_expense_project_code",
            ),
        ),
    ]
