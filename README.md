# Squires Family Finance

A private, mobile-first budget and trust-runway app for Luke and Samantha.

## What is ready

- Home: flexible money left, trust balance, runway, tasks, upcoming events, recent activity
- Budget: editable monthly limits, personal rollover, fixed costs, separate business costs
- Transactions: manual entry, CSV import, categorization, splits, notes, exclusions, review queue
- Plan: auditable reservoir history, dated one-offs, recurring funding, 36-month runway, $5,000 floor
- Tasks: status, priority, assignee, due date, estimated impact, deterministic suggestions
- Accounts: Plaid Link, cursor-based transaction sync, signed webhooks, reconnect and sync state
- Security: role-based household access, expiring invitations, Supabase Auth, RLS, private Plaid tokens, audited household and assistant changes
- ChatGPT: private OAuth-protected MCP tools for weekly reviews, tips, and suggested tasks
- PWA: installable app shell, phone navigation, dark mode, offline notice

The app cannot move money, pay bills, trade, or initiate transfers.

## ChatGPT connection

Administrators can connect ChatGPT to `https://squires-family-finance.vercel.app/api/mcp`. The connector reads only bounded finance views and writes only tips or `Suggested` tasks. See [docs/chatgpt-connection.md](docs/chatgpt-connection.md) for connection, weekly scheduling, and revocation instructions.

## Local preview

```powershell
npm install
npm run dev
```

Open `http://localhost:3000` and choose **Open local preview**. Preview changes are temporary and contain no real bank data.

## Free account setup

Do not paste passwords, access tokens, service-role keys, or Plaid secrets into chat.

### 1. Supabase

1. Create a free project at <https://supabase.com/dashboard/sign-up>.
2. Open **SQL Editor** and run `supabase/migrations/001_household.sql` once.
3. In **Authentication > Users**, create Luke and Samantha with their real email addresses and strong temporary passwords. Do not create public signup links.
4. Open **SQL Editor**, copy `supabase/add-members.example.sql`, replace the two email placeholders, and run it.
5. In **Authentication > Settings**, disable new-user signups. The app contains no signup screen, and RLS also blocks every user who is not in `public.members`.
6. In the project **Connect** dialog, copy the project URL and publishable key. In **Project Settings > API**, copy the service-role key for server configuration only.

### 2. Plaid

1. Create a developer account at <https://dashboard.plaid.com/signup> and choose **Personal use**.
2. Confirm in **Billing & Plans** that the account is on the free Trial and note the Production Item limit before connecting a real institution.
3. Enable **Transactions**. Start in Sandbox.
4. Copy the client ID and the Sandbox secret. Later, after the free Trial is confirmed, use the Production secret and set `PLAID_PRODUCTION_ENABLED=true`.
5. Never expose the Plaid secret or access tokens in a browser variable. This app stores access tokens only in Supabase's non-exposed `private` schema.

### 3. Local environment

Copy `.env.example` to `.env.local` and fill it locally:

```text
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
PLAID_CLIENT_ID=...
PLAID_SECRET=...
PLAID_ENV=sandbox
PLAID_PRODUCTION_ENABLED=false
PLAID_MAX_ITEMS=5
APP_URL=http://localhost:3000
```

Run `npm run dev`, sign in as Luke or Samantha, and connect Plaid's Sandbox test institution. Production stays disabled until its flag is deliberately changed.

### 4. Vercel

1. Create a free account at <https://vercel.com/signup>.
2. Deploy this folder as a Next.js project on the Hobby plan.
3. Add the same environment variables, changing `APP_URL` to the final `https://...vercel.app` address.
4. In Supabase Auth, add the Vercel URL as the Site URL and an allowed redirect URL.
5. In Plaid Dashboard, add `https://...vercel.app/oauth` as a redirect URI and `https://...vercel.app/api/plaid/webhook` as the webhook URL.
6. Redeploy, sign in on each phone, and use **Add to Home Screen**.

No custom domain, paid monitoring, analytics, email service, or other recurring-cost service is needed.

## Verification

```powershell
npm test
npm run typecheck
npm run build
npm run test:e2e
```

The database tests cover private token storage, RLS, cursor concurrency, and pending-to-posted reconciliation. The money tests cover transfers, card payments, refunds, rollover, splits, foreign currency, and runway events. The browser tests exercise the core flow on desktop and a 390 x 844 phone viewport.

## CSV format

The importer accepts a header row and up to 5,000 rows. Map date, merchant/description, and amount columns in the preview. Dates may be `YYYY-MM-DD` or `M/D/YYYY`. Use the same account label each time. Avoid importing dates already supplied by Plaid.

## Known next inputs

- Confirmed opening reservoir balance
- Exact remaining tuition amount and due date
- Peach State funding date and monthly amount, if applicable
- Registration/title amount and date
- Costco membership amount and renewal date

These values are deliberately not guessed.
