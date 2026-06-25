from django.db import migrations


ROLE_DEFINITIONS = {
    "viewer": {
        "description": "Read-only access to business data",
        "permission_codes": [
            "data.customers.read",
            "data.items.read",
            "data.invoices.read",
            "data.receipts.read",
            "data.expenses.read",
        ],
    },
    "editor": {
        "description": "Create and update business records without admin access",
        "permission_codes": [
            "data.customers.read",
            "data.customers.write",
            "data.items.read",
            "data.items.write",
            "data.invoices.read",
            "data.invoices.write",
            "data.receipts.read",
            "data.receipts.write",
            "data.expenses.read",
            "data.expenses.write",
        ],
    },
    "manager": {
        "description": "Operational access across business records and finance lookups",
        "permission_codes": [
            "data.customers.read",
            "data.customers.write",
            "data.items.read",
            "data.items.write",
            "data.invoices.read",
            "data.invoices.write",
            "data.receipts.read",
            "data.receipts.write",
            "data.expenses.read",
            "data.expenses.write",
            "fx.read",
        ],
    },
}


def seed_management_roles(apps, schema_editor):
    Role = apps.get_model("core", "Role")
    Permission = apps.get_model("core", "Permission")
    RolePermission = apps.get_model("core", "RolePermission")

    for role_name, config in ROLE_DEFINITIONS.items():
        role, _ = Role.objects.get_or_create(
            name=role_name,
            defaults={"description": config["description"]},
        )
        if role.description != config["description"]:
            role.description = config["description"]
            role.save(update_fields=["description"])
        for code in config["permission_codes"]:
            perm = Permission.objects.filter(code=code).first()
            if perm is None:
                continue
            RolePermission.objects.get_or_create(role=role, permission=perm)


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0020_socialauthconnection"),
    ]

    operations = [
        migrations.RunPython(seed_management_roles, migrations.RunPython.noop),
    ]
