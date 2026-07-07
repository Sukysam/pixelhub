from django.db import migrations, models


PERMISSIONS = [
    ("data.customers.remarks.read", "Read customer internal remarks"),
    ("data.customers.remarks.write", "Write customer internal remarks"),
]


ROLE_GRANTS = {
    "staff": [p[0] for p in PERMISSIONS],
    "admin": [p[0] for p in PERMISSIONS],
}


def seed_customer_remarks_permissions(apps, schema_editor):
    Role = apps.get_model("core", "Role")
    Permission = apps.get_model("core", "Permission")
    RolePermission = apps.get_model("core", "RolePermission")

    roles = {}
    for name in ("staff", "admin"):
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
        ("core", "0029_saveddocument_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="customer",
            name="internal_remarks",
            field=models.TextField(blank=True, null=True),
        ),
        migrations.RunPython(seed_customer_remarks_permissions, migrations.RunPython.noop),
    ]

