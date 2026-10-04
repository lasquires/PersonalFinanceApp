# Muse Financial Review Courier

The app's Reviews view and Settings > Review courier produce everything needed
for the handoff. Luke creates the **Review courier key** in Settings, copies it
directly into Muse's secure secrets as `FINANCE_REVIEW_TOKEN`, and gives Muse
the following message. Never paste the key into a chat, document, URL, or
source file. The SNAP key is separate and cannot be used for reviews.

## Message To Give Muse

> Set up a private financial-review courier for Luke and Samantha's Squires
> Family Finance app at https://squires-family-finance.vercel.app. You are the
> courier, not the analyst. Use no OpenAI API key and do not request Google
> passwords, bank passwords, Supabase keys, or Plaid tokens.
>
> 1. Ask me to provide the separate Review courier key from the app's Settings
> through your secure secret-entry facility. Store it as FINANCE_REVIEW_TOKEN.
> Never print it, put it in a URL, include it in a report, or commit it. The
> existing FINANCE_SNAP_TOKEN cannot be used for reviews. All requests below
> use HTTPS and Authorization: Bearer $FINANCE_REVIEW_TOKEN. Do not publish
> snapshots on GitHub or public file links.
>
> 2. First establish whether you have a supported way to attach a file to my
> existing regular financial ChatGPT conversation and retrieve its response.
> Do not substitute Work mode or another analyst. Do not scrape private chats
> or invent access. If unavailable, use a manual handoff: privately prepare
> the snapshot, schema, and ChatGPT prompt for me to attach, then wait for me
> to return financial-review.json. Tell me exactly which handoff is blocked;
> never claim full automation without testing it.
>
> 3. Fetch GET https://squires-family-finance.vercel.app/api/reviews/contract
> for the exact JSON schema and ChatGPT analysis instructions. Fetch a private
> snapshot using GET
> https://squires-family-finance.vercel.app/api/reviews/snapshot?kind=weekly&period_start=YYYY-MM-DD
> (or kind=monthly). Weekly period_start must be a Monday, monthly the first.
> Use America/New_York calendar dates. Retain snapshot_id, timestamps,
> coverage warnings and report keys unchanged. Send the snapshot plus the
> contract's analysis_instructions and packet_schema to ChatGPT. Include
> household discussion only if authorized and actually accessible. Ask
> ChatGPT to return one valid financial-review.json; you must not rewrite
> its analysis or financial numbers.
>
> 4. Set up your own supported schedules: Mondays at 9:00 AM
> America/New_York for the previous Monday-Sunday, and the first of each
> month at 9:00 AM America/New_York for the previous calendar month. Ensure
> DST follows Eastern local time. Check your scheduler supports this and
> report the actual registered schedules. If ChatGPT handoff is manual,
> schedule preparation/reminders only and clearly say a completed review
> still requires my returned file. Do not repeatedly fetch financial data
> every 30 minutes.
>
> 5. Validate returned JSON against packet_schema, including the additional
> semantic rules in analysis_instructions. Preserve the exact snapshot_id,
> report_key, revision, and stable task keys. Then POST
> https://squires-family-finance.vercel.app/api/reviews/reports with
> Content-Type: application/json and that JSON body. Read the response
> receipt: 201 means new delivery, 200 means an identical delivery replay.
> Verify by GET
> https://squires-family-finance.vercel.app/api/reviews/receipts/{delivery_id}.
> Confirm report_id and revision agree. Only after a verified receipt tell
> me it is saved, with the authenticated report link and task counts.
>
> 6. For timeouts, network failures, 429 or 503, use bounded exponential
> backoff with at most five attempts and respect Retry-After. Retry the
> identical JSON packet, not a new report/revision/key; a lost response
> cannot create duplicates. On 400 or 415 return the safe validation errors
> to ChatGPT for correction. On 409 use the expected revision/conflict
> information for correction, never invent a different identity. On 401 or
> 403 stop and ask me to repair the credential or access. Do not log request
> headers or raw financial bodies. Store pending files privately, remove
> snapshots after delivery, retain only private receipts/retry metadata as
> needed, and alert me on a blocked handoff or failed scheduled run.
>
> Tell me what you verified, what schedules actually exist, and whether the
> ChatGPT handoff is automatic or manual. Do not report success for steps you
> have not performed.

The app's **Export review packet** download contains the snapshot, analysis
instructions, schema, and valid-shaped example in one private JSON file. The
example is a template, not a completed review; ChatGPT must replace it. The
returned `financial-review.json` can be imported in Reviews if the ChatGPT
handoff to Muse is manual. A successful import shows the review and creates
Suggested follow-up tasks. It does not change the budget or move money.
