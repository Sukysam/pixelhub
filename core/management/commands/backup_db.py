import os
import shutil
import subprocess
from datetime import datetime
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    def add_arguments(self, parser):
        parser.add_argument("--output-dir", default=str(Path(settings.BASE_DIR) / "backups"))

    def handle(self, *args, **options):
        output_dir = Path(options["output_dir"]).expanduser().resolve()
        output_dir.mkdir(parents=True, exist_ok=True)

        db = settings.DATABASES.get("default", {})
        engine = db.get("ENGINE", "")

        timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")

        if engine.endswith("sqlite3"):
            db_path = Path(str(db.get("NAME", ""))).expanduser().resolve()
            if not db_path.exists():
                raise CommandError(f"SQLite DB file not found: {db_path}")
            out = output_dir / f"sqlite_backup_{timestamp}.sqlite3"
            shutil.copy2(db_path, out)
            self.stdout.write(str(out))
            return

        if "postgresql" in engine:
            name = db.get("NAME") or os.environ.get("POSTGRES_DB")
            user = db.get("USER") or os.environ.get("POSTGRES_USER")
            password = db.get("PASSWORD") or os.environ.get("POSTGRES_PASSWORD")
            host = db.get("HOST") or os.environ.get("POSTGRES_HOST", "localhost")
            port = str(db.get("PORT") or os.environ.get("POSTGRES_PORT", "5432"))
            if not name:
                raise CommandError("POSTGRES_DB/NAME is required for postgres backups")

            out = output_dir / f"postgres_backup_{timestamp}.sql"
            env = os.environ.copy()
            if password:
                env["PGPASSWORD"] = password

            cmd = [
                "pg_dump",
                "-h",
                host,
                "-p",
                port,
                "-U",
                user or "",
                "-d",
                name,
                "--no-owner",
                "--no-privileges",
            ]

            try:
                with out.open("wb") as f:
                    subprocess.run(cmd, env=env, stdout=f, stderr=subprocess.PIPE, check=True)
            except FileNotFoundError as e:
                raise CommandError("pg_dump not found on PATH") from e
            except subprocess.CalledProcessError as e:
                raise CommandError(e.stderr.decode("utf-8", errors="replace")) from e

            self.stdout.write(str(out))
            return

        raise CommandError(f"Unsupported database engine: {engine}")

