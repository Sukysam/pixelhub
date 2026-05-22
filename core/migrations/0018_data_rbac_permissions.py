from django.db import migrations


PERMISSIONS = [
    ("data.customers.read", "Read customers"),
    ("data.customers.write", "Write customers"),
    ("data.items.read", "Read items"),
    ("data.items.write", "Write items"),
    ("data.invoices.read", "Read invoices"),
    ("data.invoices.write", "Write invoices"),
    ("data.receipts.read", "Read receipts"),
    ("data.receipts.write", "Write receipts"),
    ("data.expenses.read", "Read expenses"),
    ("data.expenses.write", "Write expenses"),
]


ROLE_GRANTS = {
    "user": [p[0] for p in PERMISSIONS],
    "staff": [p[0] for p in PERMISSIONS],
    "admin": [p[0] for p in PERMISSIONS],
}


def seed_data_permissions(apps, schema_editor):
    Role = apps.get_model("core", "Role")
    Permission = apps.get_model("core", "Permission")
    RolePermission = apps.get_model("core", "RolePermission")

    roles = {}
    for name in ("user", "staff", "admin"):
        roles[name], _ = Role.objects.get_or_create(name=name, defaults={"description": name.title()})

    perms = {}
    for code, desc in PERMISSIONS:
        perms[code], _ = Permission.objects.get_or_create(code=code, defaults={"description": desc})

    for role_name, codes in ROLE_GRANTS.items():
        role = roles[role_name]
        for code in codes:
            RolePermission.objects.get_or_create(role=role, permission=perms[code])


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0017_remove_whatsapp_integration"),
    ]

    operations = [
        migrations.RunPython(seed_data_permissions, migrations.RunPython.noop),
    ]

