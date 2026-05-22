# Registration API

Base path: `/api/auth`

## GET /captcha/
Returns a simple challenge used for bot protection.

Response:
```json
{ "captcha_id": "...", "question": "What is 3 + 7?" }
```

## POST /register/
Creates a new account (inactive until email verification).

Request:
```json
{
  "email": "new@example.com",
  "password": "...",
  "password_confirm": "...",
  "full_name": "New User",
  "phone": "+15551234567",
  "accept_terms": true,
  "captcha_id": "...",
  "captcha_answer": "10",
  "website": ""
}
```

Response:
```json
{ "registered": true, "verification_sent": true }
```

Notes:
- `website` is a honeypot field and must be empty.
- Rate limits apply per-IP and per-email.
- If the account is created but email sending fails, the response will be:
  ```json
  { "registered": true, "verification_sent": false, "detail": "..." }
  ```

## POST /verify-email/
Activates the account using the verification token.

Request:
```json
{ "token": "..." }
```

Response:
```json
{ "verified": true }
```

## POST /resend-verification/
Requests a new verification email.

Request:
```json
{ "email": "new@example.com" }
```

Response:
```json
{ "sent": true }
```

Notes:
- If the email backend cannot send, the response will be `503`:
  ```json
  { "sent": false, "detail": "..." }
  ```

## GET /me/
Returns the current authenticated user (Token auth).
