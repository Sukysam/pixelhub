from django.db import migrations, models
import django.utils.timezone


PERMISSIONS = [
    ("data.source_accounts.read", "Read source accounts"),
    ("data.source_accounts.write", "Write source accounts"),
]


ROLE_GRANTS = {
    "user": [p[0] for p in PERMISSIONS],
    "staff": [p[0] for p in PERMISSIONS],
    "admin": [p[0] for p in PERMISSIONS],
    "viewer": ["data.source_accounts.read"],
    "editor": [p[0] for p in PERMISSIONS],
    "manager": [p[0] for p in PERMISSIONS],
}


def seed_source_account_permissions(apps, schema_editor):
    Role = apps.get_model("core", "Role")
    Permission = apps.get_model("core", "Permission")
    RolePermission = apps.get_model("core", "RolePermission")

    perms = {}
    for code, desc in PERMISSIONS:
        perms[code], _ = Permission.objects.get_or_create(code=code, defaults={"description": desc})

    for role_name, codes in ROLE_GRANTS.items():
        role = Role.objects.filter(name=role_name).first()
        if role is None:
            continue
        for code in codes:
            RolePermission.objects.get_or_create(role=role, permission=perms[code])


def migrate_legacy_source_accounts(apps, schema_editor):
    Expense = apps.get_model("core", "Expense")
    SourceAccount = apps.get_model("core", "SourceAccount")
    Currency = apps.get_model("core", "Currency")
    GlobalSettings = apps.get_model("core", "GlobalSettings")

    default_currency = None
    settings_row = GlobalSettings.objects.order_by("id").first()
    if settings_row is not None and getattr(settings_row, "default_currency_id", None):
        default_currency = Currency.objects.filter(pk=settings_row.default_currency_id).first()
    if default_currency is None:
        default_currency = Currency.objects.order_by("id").first()
    if default_currency is None:
        default_currency = Currency.objects.create(code="USD", name="US Dollar", symbol="$", decimal_places=2)

    account_ids = {}
    legacy_values = (
        Expense.objects.exclude(source_account_legacy__isnull=True)
        .exclude(source_account_legacy="")
        .values_list("source_account_legacy", flat=True)
        .distinct()
    )
    for raw_name in legacy_values:
        name = str(raw_name or "").strip()
        if not name:
            continue
        account, _ = SourceAccount.objects.get_or_create(
            name=name,
            defaults={
                "account_type": "petty_cash" if name.lower().startswith("petty") else "other",
                "initial_balance": "0.00",
                "currency": default_currency,
                "status": "active",
            },
        )
        account_ids[name] = account.id

    for expense in Expense.objects.exclude(source_account_legacy__isnull=True).exclude(source_account_legacy="").iterator():
        name = str(expense.source_account_legacy or "").strip()
        if not name:
            continue
        account_id = account_ids.get(name)
        if account_id:
            expense.source_account_id = account_id
            expense.save(update_fields=["source_account"])


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0031_expense_cleanup_and_source_account"),
    ]

    operations = [
        migrations.CreateModel(
            name="SourceAccount",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("is_deleted", models.BooleanField(default=False)),
                ("deleted_at", models.DateTimeField(blank=True, null=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("name", models.CharField(max_length=120, unique=True)),
                ("account_type", models.CharField(choices=[("petty_cash", "Petty Cash"), ("bank", "Bank"), ("mobile_money", "Mobile Money"), ("other", "Other")], default="petty_cash", max_length=20)),
                ("initial_balance", models.DecimalField(decimal_places=2, default=0, max_digits=12)),
                ("status", models.CharField(choices=[("active", "Active"), ("inactive", "Inactive"), ("closed", "Closed")], default="active", max_length=20)),
                ("created_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("currency", models.ForeignKey(on_delete=models.deletion.PROTECT, related_name="source_accounts", to="core.currency")),
            ],
            options={},
        ),
        migrations.AddIndex(
            model_name="sourceaccount",
            index=models.Index(fields=["is_deleted", "name"], name="core_source_is_dele_name_idx"),
        ),
        migrations.AddIndex(
            model_name="sourceaccount",
            index=models.Index(fields=["is_deleted", "status"], name="core_source_is_dele_status_idx"),
        ),
        migrations.AddIndex(
            model_name="sourceaccount",
            index=models.Index(fields=["currency", "name"], name="core_source_currency_name_idx"),
        ),
        migrations.RemoveIndex(
            model_name="expense",
            name="core_expens_is_dele_source_idx",
        ),
        migrations.RenameField(
            model_name="expense",
            old_name="source_account",
            new_name="source_account_legacy",
        ),
        migrations.AddField(
            model_name="expense",
            name="source_account",
            field=models.ForeignKey(blank=True, null=True, on_delete=models.deletion.SET_NULL, related_name="expenses", to="core.sourceaccount"),
        ),
        migrations.RunPython(seed_source_account_permissions, migrations.RunPython.noop),
        migrations.RunPython(migrate_legacy_source_accounts, migrations.RunPython.noop),
        migrations.RemoveField(
            model_name="expense",
            name="source_account_legacy",
        ),
    ]
