# Keyless SNAP Intake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Muse submit periodic SNAP observations without a worker-held app key, while making their unverified status unmistakable.

**Architecture:** A new public route validates and sends observations to a service-role-only database function. That function atomically rate-limits and stores accepted or flagged observations separately from trusted snapshots. Signed-in dashboard reads accepted and flagged state; financial review export remains trusted-only.

**Tech Stack:** Next.js 16, TypeScript, Supabase/Postgres, PGlite tests, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-05-keyless-snap-intake.md`

## Global Constraints

- Do not change authorization on `POST /api/benefits/snap`.
- Never put unverified observations in `snap_balance_snapshots` or financial review exports.
- No extra hosted service or new account is required.

## Review Focus

- Invalid calendar months and next-month dates: 422, no database write.
- Stale and future observation times: 422, no database write.
- Concurrent or repeated submissions: rate limit atomically and never regress latest timestamp.
- Large same-month increase: flag and preserve last accepted balance.
- Missing or stale Muse reads: dashboard states no current verified reading, not a false success.

---

### Task 1: Database intake

**Files:** Create migration `supabase/migrations/008_public_snap_observations.sql`; test `tests/snap-database.test.ts`.

**Interfaces:** Service-role RPC `server_receive_public_snap(month_start date, amount bigint, seen_at timestamptz, client_hash text)` returns text `updated`, `unchanged`, `flagged`, or `rate_limited`. Tables `snap_public_observations` and `snap_public_rate_limits`.

- [ ] Write PGlite tests for accepted, older, flagged, and rate-limited submissions, plus RLS.
- [ ] Confirm tests fail before migration.
- [ ] Implement migration and confirm tests pass.

### Task 2: HTTP validation

**Files:** Create `src/lib/snap/public-intake.ts` and `src/app/api/benefits/snap-observation/route.ts`; test `tests/snap-http.test.ts`.

**Interfaces:** `parsePublicSnapRequest(request: Request, now: Date)` returns the validated payload; route calls `server_receive_public_snap` using `adminDb()`.

- [ ] Write tests for JSON/body bounds, strict schema, time/month bounds, and response mapping.
- [ ] Confirm tests fail, implement, and confirm they pass.

### Task 3: Signed-in dashboard and Muse instructions

**Files:** Modify `src/lib/types.ts`, `src/lib/defaults.ts`, `src/lib/store.ts`, `src/components/home.tsx`, `src/app/interface.css`, `docs/muse-snap-setup.md`; add a focused UI test.

**Interfaces:** Snapshot gains `snap_public_observations`; accepted newest observation may be displayed only with an unverified label, while flagged state warns without changing the amount.

- [ ] Add a failing dashboard test for fresh, stale, and flagged status.
- [ ] Implement the read/display and exact Muse instructions.
- [ ] Run unit tests, typecheck, build, and browser verification.

### Task 4: Production

**Files:** No new code.

- [ ] Apply migration 008 and verify it exists.
- [ ] Deploy and smoke-test rejected and accepted public requests without exposing household data.
- [ ] Give user the exact Muse prompt and explain ConnectEBT/scheduler remain external dependencies.
