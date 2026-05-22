import json
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.request import Request, urlopen

from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Basic registration load test. Requires REGISTRATION_CAPTCHA_BYPASS=1."

    def add_arguments(self, parser):
        parser.add_argument("--url", default="http://127.0.0.1:8000/api/auth/register/")
        parser.add_argument("--total", type=int, default=1000)
        parser.add_argument("--concurrency", type=int, default=100)

    def handle(self, *args, **options):
        url = options["url"]
        total = max(1, int(options["total"]))
        concurrency = max(1, int(options["concurrency"]))

        started = time.time()
        ok = 0
        failed = 0

        def do_one(i: int) -> bool:
            email = f"loadtest-{uuid.uuid4().hex[:16]}@example.com"
            secret = f"Aa1!{uuid.uuid4().hex}"
            payload = {
                "email": email,
                "password": secret,
                "password_confirm": secret,
                "full_name": f"Load Test {i}",
                "company_legal_name": f"Load Test Company {i}",
                "company_registration_number": "",
                "business_industry": "Technology",
                "business_address": "1 Load Test Street, Lagos, NG",
                "certifications": [],
                "accept_terms": True,
                "captcha_id": "bypass",
                "captcha_answer": "bypass",
                "website": "",
            }
            req = Request(url, method="POST", data=json.dumps(payload).encode("utf-8"))
            req.add_header("Content-Type", "application/json")
            try:
                with urlopen(req, timeout=10) as resp:
                    return 200 <= resp.status < 300
            except Exception:
                return False

        with ThreadPoolExecutor(max_workers=concurrency) as ex:
            futures = [ex.submit(do_one, i) for i in range(total)]
            for f in as_completed(futures):
                if f.result():
                    ok += 1
                else:
                    failed += 1

        elapsed = time.time() - started
        rps = ok / elapsed if elapsed > 0 else 0
        self.stdout.write(f"total={total} ok={ok} failed={failed} elapsed_s={elapsed:.2f} ok_per_s={rps:.2f}")
