from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import django.utils.timezone


PERMISSIONS = [
    ("settings.global.read", "Read global settings"),
    ("settings.global.write", "Write global settings"),
    ("admin.users.read", "Read users"),
    ("admin.users.write", "Manage users"),
    ("admin.logo.upload", "Upload logo"),
    ("admin.oauth.status.read", "Read OAuth status"),
    ("admin.email.test", "Send test emails"),
    ("fx.read", "Read exchange rates"),
    ("fx.write", "Manage exchange rates"),
    ("currency.write", "Manage currencies"),
]


ROLE_GRANTS = {
    "user": [],
    "staff": ["settings.global.read", "fx.read"],
    "admin": [p[0] for p in PERMISSIONS],
}


def seed_rbac(apps, schema_editor):
    Role = apps.get_model("core", "Role")
    Permission = apps.get_model("core", "Permission")
    RolePermission = apps.get_model("core", "RolePermission")
    UserRole = apps.get_model("core", "UserRole")
    User = apps.get_model("auth", "User")

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

    for u in User.objects.all().iterator():
        role_name = "user"
        if bool(getattr(u, "is_superuser", False)):
            role_name = "admin"
        elif bool(getattr(u, "is_staff", False)):
            role_name = "staff"
        UserRole.objects.get_or_create(user=u, role=roles[role_name])


class Migration(migrations.Migration):
    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("core", "0011_move_tax_identification_number_to_globalsettings"),
    ]

    operations = [
        migrations.CreateModel(
            name="Permission",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("code", models.CharField(max_length=120, unique=True)),
                ("description", models.CharField(blank=True, max_length=255, null=True)),
                ("created_at", models.DateTimeField(default=django.utils.timezone.now)),
            ],
        ),
        migrations.CreateModel(
            name="Role",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=50, unique=True)),
                ("description", models.CharField(blank=True, max_length=255, null=True)),
                ("created_at", models.DateTimeField(default=django.utils.timezone.now)),
            ],
        ),
        migrations.CreateModel(
            name="AdminMfaDevice",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("secret", models.CharField(max_length=64)),
                ("confirmed_at", models.DateTimeField(blank=True, null=True)),
                ("last_used_ts", models.BigIntegerField(blank=True, null=True)),
                ("created_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("user", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name="admin_mfa_device", to=settings.AUTH_USER_MODEL)),
            ],
        ),
        migrations.CreateModel(
            name="RolePermission",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("permission", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="permission_roles", to="core.permission")),
                ("role", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="role_permissions", to="core.role")),
            ],
        ),
        migrations.CreateModel(
            name="UserRole",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("role", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="role_users", to="core.role")),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="rbac_roles", to=settings.AUTH_USER_MODEL)),
            ],
        ),
        migrations.CreateModel(
            name="AccessToken",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("key", models.CharField(max_length=64, unique=True)),
                ("created_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("expires_at", models.DateTimeField(blank=True, null=True)),
                ("revoked_at", models.DateTimeField(blank=True, null=True)),
                ("role", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="access_tokens", to="core.role")),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="access_tokens", to=settings.AUTH_USER_MODEL)),
            ],
        ),
        migrations.AddIndex(
            model_name="accesstoken",
            index=models.Index(fields=["user", "created_at"], name="core_access_user_id_4c87f7_idx"),
        ),
        migrations.AddIndex(
            model_name="accesstoken",
            index=models.Index(fields=["key"], name="core_access_key_7a5943_idx"),
        ),
        migrations.AddIndex(
            model_name="accesstoken",
            index=models.Index(fields=["revoked_at", "expires_at"], name="core_access_revoked_1d6e2c_idx"),
        ),
        migrations.AddConstraint(
            model_name="rolepermission",
            constraint=models.UniqueConstraint(fields=("role", "permission"), name="uniq_role_permission"),
        ),
        migrations.AddConstraint(
            model_name="userrole",
            constraint=models.UniqueConstraint(fields=("user", "role"), name="uniq_user_role"),
        ),
        migrations.RunPython(seed_rbac, migrations.RunPython.noop),
    ]
