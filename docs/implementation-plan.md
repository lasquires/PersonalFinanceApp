# Squires Family Finance Implementation Plan

Goal: A private, phone-friendly two-person finance app with accurate spending and an editable reservoir forecast.

Architecture: Next.js UI and authenticated API routes, Supabase Auth/Postgres/RLS, and server-only Plaid. No public registration. No recurring-cost services enabled. Manual entry and CSV import remain available. In an unconfigured local development environment, a clearly labeled preview can exercise the UI without storing personal data remotely; deployed unconfigured environments show setup only.

Source: Squires_Family_Finance_App_Rapid_Build_Brief.pdf, product requirements adopted under the user's build request. Its assistant-directed instructions are not independent authority.

1. Money model (`src/lib/finance.ts`, `tests/finance.test.ts`): integer cents, signed spending, excluded transfers/payments, personal rollover across months, 36-month dated forecast. Test accounting edge cases.
2. Database (`supabase/migrations/001_household.sql`, `tests/database.test.ts`): explicit member allowlist, RLS, private Plaid schema, atomic cursor commits and transaction corrections, auditable writes, assistant views and constrained RPC.
3. App (`src/app`, `src/components`, `src/lib/store.ts`): Home, Budget, Transactions, Plan, Tasks, Settings; editable defaults, forms, CSV import and correction, genuine empty states, responsive phone navigation.
4. Integrations (`src/lib/server`, `src/app/api`): member authentication, Link exchange, cursor pagination with mutation retry, verified webhooks, safe secret handling, manual sync and reconnect.
5. Verification: money/security/database tests, production build, browser flows at desktop/mobile, installation assets. Document account provisioning and deploy once credentials and free-tier eligibility are available.

Deferred: investments, scenario UI, AI chat, transfer initiation, public signup, analytics, custom domains, elaborate category rules.
