# Muse SNAP Balance Updates

In Squires Family Finance, sign in as an administrator, open Settings, and select **Create or replace key**. Copy the key immediately into Muse's secure secrets as `FINANCE_SNAP_TOKEN`. Creating a replacement key revokes the previous one.

Give Muse these instructions:

> Once every hour, use the authenticated benefits website in your browser and read the current available SNAP card balance and the benefit month shown by the site. If you need Luke to sign in or complete MFA, stop and ask him.
>
> Send the balance to `https://squires-family-finance.vercel.app/api/benefits/snap` using an HTTPS POST request with `Content-Type: application/json` and `Authorization: Bearer $FINANCE_SNAP_TOKEN`.
>
> The JSON body must contain only:
>
> ```json
> {
>   "benefit_month": "YYYY-MM",
>   "balance_cents": 0,
>   "observed_at": "2026-10-03T14:00:00Z"
> }
> ```
>
> Replace the example values with the month and current available balance shown by the benefits site. Convert dollars to integer cents. Use the current time in UTC for `observed_at`. Report the balance again every hour, even if it has not changed, so the app can show when it was last checked. A successful HTTP 200 response means the update was saved. Do not print or include the secret token in messages, files, screenshots, or logs. Never send Google credentials, benefit-site credentials, MFA codes, screenshots, or unrelated household data to the finance app.

The endpoint keeps one latest balance per benefit month. A repeated or older report will not create a duplicate or replace a newer observation. The Home page shows the latest balance and its observation time.
