# Muse SNAP Balance Updates

The recommended path for Muse's scheduled worker is the keyless observation endpoint. It does not require an app key or the family's Google login. Because anyone can submit a plausible balance, the app labels these readings **Unverified Muse report**. The app does not send these readings into the financial review export or the protected SNAP balance table.

Give Muse these exact instructions:

> Schedule a SNAP balance check once every hour. Use the authenticated ConnectEBT site to read the current available SNAP card balance. Do not infer or reuse a previous balance when the site times out. If sign-in or MFA is required, ask Luke to complete it; do not collect his Google password.
>
> After a successful read, immediately POST over HTTPS to `https://squires-family-finance.vercel.app/api/benefits/snap-observation` with `Content-Type: application/json`. Do not send an Authorization header or an app key. Send only this JSON:
>
> ```json
> { "benefit_month": "2026-10", "balance_cents": 19758, "observed_at": "2026-10-05T20:04:00Z" }
> ```
>
> Replace every example value with the actual benefit month, available balance in integer cents, and the exact UTC time you observed it. The benefit month must be the current or previous Eastern calendar month. Send a fresh observation every hour even when the amount is unchanged. Do not send credentials, MFA codes, screenshots, transaction histories, or any other household data.
>
> Treat HTTP 200 with `{ "ok": true }` as received, not proof that the balance was displayed. For privacy, the response does not say whether the report was accepted, repeated, or held. Luke can check the signed-in dashboard for a held-report warning. HTTP 422 means the payload is invalid or too old; re-read the site before retrying. HTTP 429 means wait at least one minute before retrying. HTTP 503 means retry with backoff, but re-read the site if the observation becomes more than 10 minutes old. If the ConnectEBT read fails, report the failure instead of posting a guessed balance.
>
> After setup, make one real test read and submission, confirm HTTP 200, and ask Luke to verify that the dashboard shows a fresh **Unverified Muse report**. Tell him whether the hourly scheduled job is enabled and when its next run is due.

The app accepts a recent ISO timestamp, a current or previous Eastern benefit month, and $0-$2,500. The public endpoint is limited to 10 submissions per minute and 100 per hour per client IP. A same-month increase over $500 is held rather than displayed. These controls limit mistakes and abuse; they do not authenticate Muse or guarantee ConnectEBT is available.

The older, key-protected endpoint remains available at `/api/benefits/snap` for a worker that can securely hold a scoped app key. Its key is created by an administrator in Settings. Never give the protected key, Google credentials, or ConnectEBT login to this keyless job.
