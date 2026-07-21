from __future__ import annotations

import re

from django.db import transaction
from django.utils import timezone

from .models import Expense, ProjectCodeSequence

PROJECT_CODE_PREFIX = "PRJ"


def normalize_project_code(value: str | None) -> str:
    return re.sub(r"\s+", "-", str(value or "").strip()).upper()


def _project_code_for(year: int, number: int) -> str:
    return f"{PROJECT_CODE_PREFIX}-{year}-{number:04d}"


def peek_next_project_code(*, year: int | None = None) -> str:
    target_year = int(year or timezone.now().year)
    last_number = (
        ProjectCodeSequence.objects.filter(year=target_year).values_list("last_number", flat=True).first() or 0
    )
    next_number = int(last_number) + 1
    candidate = _project_code_for(target_year, next_number)
    while Expense.objects.filter(project_code=candidate, is_deleted=False).exists():
        next_number += 1
        candidate = _project_code_for(target_year, next_number)
    return candidate


def generate_next_project_code(*, year: int | None = None) -> str:
    target_year = int(year or timezone.now().year)
    with transaction.atomic():
        sequence, _ = ProjectCodeSequence.objects.select_for_update().get_or_create(year=target_year)
        next_number = int(sequence.last_number) + 1
        candidate = _project_code_for(target_year, next_number)
        while Expense.objects.filter(project_code=candidate, is_deleted=False).exists():
            next_number += 1
            candidate = _project_code_for(target_year, next_number)
        sequence.last_number = next_number
        sequence.save(update_fields=["last_number"])
    return candidate
