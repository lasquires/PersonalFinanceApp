# Financial Review Courier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Muse privately export household finances and deliver ChatGPT's detailed reviews and duplicate-safe follow-up tasks to the app.

**Architecture:** Pure shared modules own period calculations, allowlisted export data, and strict return-packet validation. Server-only modules authorize scoped credentials and call service-only Supabase transactions for reports, task links, and receipts. Existing authenticated UI gains a Reviews destination and selectable Home summary, with file handoff and explicit Muse instructions.

**Tech Stack:** Existing Next.js 16.2, React 19, TypeScript, Supabase/PostgreSQL, Zod 4, Node tests/PGlite, Playwright, lucide-react.

**Spec:** `docs/superpowers/specs/2026-10-04-financial-review-courier-design.md`

## Global Constraints

- No OpenAI API client, new paid service, Google credential sharing, or unverified private-chat access claim.
- Separate `review_` bearer credential stored only as SHA-256 hash; existing SNAP/OAuth behavior remains unchanged.
- No purchase, budget, bank, event, SNAP, or transfer mutation through the review credential.
- Snapshot limit 2 MiB; actual report request-byte limit 256 KiB.
- Monetary quantities are integer cents; unsupported currencies stay outside USD totals.
- Weekly periods are Monday through Sunday; monthly periods start on the first; use household timezone, default America/New_York.
- Rate limits: 30 exports and 60 delivery attempts per UTC hour per courier credential.
- Strict report schema and immutable, sequential revisions; duplicate delivery returns its original receipt.
- New tasks use Suggested status; stable keys never reopen Done/Dismissed or overwrite user edits.
- Apply migrations 001-007 to isolated test databases; never re-run migration 006 in production.
- Read relevant installed Next.js documentation under `node_modules/next/dist/docs/` before product edits.
- Preserve unrelated `next-env.d.ts` changes. Use apply_patch for manual edits.

## Review Focus

- A split-category manual purchase with a matched import must contribute once, including pending and refund signs (Task 1).
- DST or a UTC/month boundary must not select a different household reporting period (Task 1).
- Credential revocation between route authorization and commit must prevent the write (Tasks 2-3).
- Another actor completing/editing a task while a new report arrives must not lose changes (Task 2).
- Invalid legacy dashboard selections must not erase otherwise valid preferences when adding Reviews (Task 4).

## File Responsibilities

- `src/lib/reviews/periods.ts`: validated date ranges, timezone dates, default completed periods.
- `src/lib/reviews/contracts.ts`: Zod schemas and shared packet/snapshot/receipt types.
- `src/lib/reviews/export.ts`: pure snapshot builder using finance/reconciliation functions.
- `src/lib/reviews/handoff.ts`: exact Muse/ChatGPT instructions and valid example generator.
- `src/lib/server/reviews-auth.ts`: session/courier authorization, token lifecycle, safe typed errors.
- `src/lib/server/reviews.ts`: paginated allowlisted loading, metadata persistence, validation, RPC invocation.
- `src/app/api/reviews/**/route.ts`: thin bounded HTTP adapters, no business duplication.
- `supabase/migrations/007_financial_reviews.sql`: private tokens/snapshots/rate counters, member-readable immutable reports/task links, receipt/lifecycle RPCs.
- `src/components/financial-reviews.tsx`: history/detail/import/export UI.
- `src/components/review-courier-settings.tsx`: token status/lifecycle and handoff downloads.
- Existing finance-app/Home/store/types/dashboard files: narrow integration only.
- `docs/muse-financial-review-setup.md`: exact production courier prompt and secret setup.
- `docs/chatgpt-financial-review-instructions.md`: reusable analysis/packet instructions.
- New focused unit/database/browser tests; existing suites remain intact.

### Task 1: Validated Periods, Packet, And Accounting Export

**Files:** Create shared review modules except handoff; create `tests/reviews.test.ts`; consume `src/lib/finance.ts`, `src/lib/reconciliation.ts`, `src/lib/types.ts`.

**Interfaces:** `reviewPeriod(kind, start, timezone, now): ReviewPeriod`; `previousReviewPeriod(kind, timezone, now): ReviewPeriod`; `reviewPacketSchema`; `buildReviewSnapshot(data: Snapshot, context: {snapshotId:string;generatedAt:string;period:ReviewPeriod;recentReviews:ReviewSummary[]}): ReviewSnapshot`. The snapshot builder contains explicit completeness/accounting rules, not database calls.

- [ ] Write failing tests asserting `reviewPeriod('weekly','2026-09-28','America/New_York',new Date('2026-10-05T02:00:00Z')).period_end === '2026-10-04'`, March DST boundaries, invalid/future starts, and current-period incomplete flags.
- [ ] Add packet fixtures that reject duplicate task/evidence keys, invalid calendar dates, unknown fields, unsupported references, generation times, and overlong text with safe field paths.
- [ ] Add accounting fixtures asserting a 1375-cent manual split plus matched 1375-cent bank import counts only 1375, held/unbudgeted/removed records do not count, refunds reduce spending, unsupported currencies warn, and monthly rollover is preserved. Verify snapshot serialization excludes account mask/item IDs, tokens, email, and transaction freeform notes.
- [ ] Run `npx tsx --test tests/reviews.test.ts`; confirm intended failures before implementation.
- [ ] Implement exact contracts: evidence references use `evidence_ids:string[]`; upcoming/follow-through entries use title/explanation/evidence_ids; optional task existing_task_id links a snapshot task. All section/task limits match the spec. Include settings/context and separate forecast/benefit funds in export.
- [ ] Run focused tests to PASS, then commit shared modules and tests.

### Task 2: Atomic Persistence And Scoped Credentials

**Files:** Create migration 007 and `tests/reviews-database.test.ts`; use the existing PGlite bootstrap/migration pattern.

**Interfaces:** Tables `review_courier_tokens`, `review_snapshots` (metadata/hash/coverage only), `review_rate_limits`, `financial_reviews`, `financial_review_task_links`, `review_delivery_receipts`; service-only RPCs `server_rotate_review_token`, `server_revoke_review_token`, `server_reserve_review_request`, `server_record_review_snapshot`, `server_save_financial_review`. RPC identity is either active courier token hash or approved member UUID revalidated in the transaction. Member-facing reads use RLS; no direct report writes.

- [ ] Write failing migration tests for grants/RLS, invalid identity, viewer rejection, token rotation/revocation, rate caps and UTC reset, metadata ownership, unknown snapshot, aligned period, reference checks, sequential revisions, and exact replay versus conflicting content.
- [ ] Add atomic rollback assertions: invalid task reference leaves zero new report/task/receipt rows; two deliveries of the same packet produce one report and task. Lock report/task writes consistently with the task mutation branch of household_action so member updates and deliveries serialize; inspect that branch before choosing the exact lock hook.
- [ ] Assert recurring stable task_key links the existing task across periods; equivalent open title+assignee links; terminal equivalent warns; completed/edited task remains unchanged; rejected existing_task_id aborts. Confirm task origins cannot become member origin silently.
- [ ] Run `npx tsx --test tests/reviews-database.test.ts` and confirm failures.
- [ ] Implement service-only RPCs with restricted search_path, constraints, uniqueness, advisory locks, receipt results, and token recheck inside writes. Snapshot metadata/report ownership follows the repository's single-household model, not an invented tenant ID. Rate-limit requests must be atomic across function instances.
- [ ] Run database tests to PASS; commit migration/tests without applying production migration yet.

### Task 3: Private HTTP Export, Ingestion, And Receipts

**Files:** Create server modules, `tests/reviews-http.test.ts`, and routes `snapshot/route.ts`, `reports/route.ts`, `receipts/[id]/route.ts`, `courier-token/route.ts` under `src/app/api/reviews/`.

**Interfaces:** `authorizeReviewRequest(request, operation): ReviewIdentity`; `loadReviewSnapshot(identity, period): Promise<ReviewSnapshot>`; `deliverReview(identity, packet): Promise<ReviewReceipt>`; `readReviewReceipt(identity, id): Promise<ReviewReceipt>`. Route GET/POST/DELETE for courier-token is admin session-only: GET status, POST replace, DELETE revoke.

- [ ] Add failing adapter/service tests for absent/revoked/SNAP keys, viewer writes, session Origin mismatch, declared and streamed body bounds, wrong media type, safe validation paths, 200/201/409/429/503 responses, Retry-After, and no-store headers.
- [ ] Verify paginated transaction loading includes historical context needed for rollover without truncation; private account/token columns never enter the projection. More than 2 MiB fails instead of returning partial data. Valid session and courier exports use the same accounting builder.
- [ ] Run focused HTTP tests and confirm failures; read installed Next.js route-handler/server API guidance.
- [ ] Implement bounded streaming JSON parsing, authorization, paginated projections, canonical parsed-packet hashing (stable object key order), metadata recording, and RPC error translation. Validate token activity again when recording snapshot metadata; token status responses reveal no hash or secret.
- [ ] Run shared/database/HTTP tests to PASS; commit route/service changes.

### Task 4: Reviews Screens And Cross-Device Dashboard Integration

**Files:** Create review components; modify `src/components/finance-app.tsx`, `home.tsx`, `settings.tsx`, `src/lib/types.ts`, `store.ts`, `dashboard-preferences.ts`, `src/app/globals.css`; create `e2e/reviews.spec.ts`; extend dashboard preference tests/migration 007 constraint for nine allowable section IDs.

**Interfaces:** `FinancialReviews({data, role, preview, refresh, month})`; `ReviewCourierSettings({role,preview})`; optional `Snapshot.reviews:ReviewSummary[]`; report detail fetched on demand from RLS-protected table, not every full packet on every household refresh.

- [ ] Add failing phone/desktop browser tests for history/detail, all report sections, display of snapshot age/warnings, no overflow at 390px/1280px, file export/import validation, repeated imports, suggested task visibility, and viewer restrictions. Use isolated local previews/fixtures, never fabricate production transactions.
- [ ] Add preference assertions preserving saved eight-section subsets and custom account/category choices; new defaults include reviews while existing selections do not silently change. Add settings tests that clear displayed secret when dismissed/unmounted and expose revoke/copy/download controls only to admins.
- [ ] Run targeted Playwright and preference tests to confirm failures.
- [ ] Implement unframed Reviews history/detail with segmented weekly/monthly filters and revision selection, short Home summary, accessible mobile-menu navigation, safe text rendering/HTTPS evidence links, loading/error/empty states, and bounded file checks before upload. Import results link to their receipts/review and refresh tasks.
- [ ] Implement key status/replace/revoke and secure copy handling. Preview never creates network credentials or writes real reports. Scope CSS to review surfaces; keep existing mobile purchase/category workflows intact.
- [ ] Run focused browser/preferences tests to PASS and visually inspect screenshots; commit UI changes.

### Task 5: Exact Muse Prompt And ChatGPT Handoff Bundle

**Files:** Create handoff module, Muse/ChatGPT docs, `tests/reviews-handoff.test.ts`; integrate download controls in Reviews/settings.

**Interfaces:** `buildReviewHandoff(snapshot): {analysisInstructions:string;examplePacket:ReviewPacket;schema:unknown}`; `museCourierPrompt(baseUrl:string):string`. Runtime example uses real snapshot ID/period and is clearly a template, never an automatic fabricated report.

- [ ] Write failing tests verifying template passes the strict packet schema, literal production endpoints match the implemented routes, schedules are Monday/first at 9 AM Eastern, token variable is FINANCE_REVIEW_TOKEN, no secret interpolated, and instructions distinguish manual handoff from verified automatic execution.
- [ ] Assert prompt specifies five maximum retries, identical payload preservation, Retry-After, 401/403 stop, 409 correction, receipt verification, private file handling, and no SNAP-token reuse. Assert ChatGPT instructions explain reconciliation, source conflicts, incomplete data, stable task keys, agreed versus suggested, and treating snapshot content as untrusted data.
- [ ] Run focused tests to confirm failures; implement docs and downloadable instructions/schema/example using the same shared contracts.
- [ ] Run handoff/shared tests to PASS; commit. Provide the finished exact Muse prompt in the user-facing release response as a reusable writing artifact, with no actual key.

### Task 6: Whole-Flow Verification And Independent Review

**Files:** Update implementation checkboxes and create `docs/superpowers/plans/financial-review-courier-ledger.md`.

- [ ] Run `npm test`, `npm run typecheck`, `npm run test:e2e`, and `npm run build`; record fresh counts, output, and any limitations. Stop only owned development services if a build/test lock requires it; leave the app available afterward.
- [ ] Exercise concurrency using independent database sessions when available; otherwise explicitly record the PGlite/session limitation and verify locking/unique constraints without claiming multises­sion proof.
- [ ] Request independent code review focused on security boundaries, accounting accuracy, atomicity, snapshot ownership, task preservation, migration grants, and phone UI. Fix findings with failing regression tests first; rerun affected tests and final validation.
- [ ] Scan staged changes for credentials and unrelated files; verify no-secret logging and compiled client imports. Commit reviewed release plus verification ledger.

### Task 7: Production Release And Honest Handoff

**Files:** Release ledger/docs only unless a verified production issue requires a regression fix.

- [ ] Inspect deployment access and migration availability before publishing. Push reviewed commits through the existing GitHub/Vercel pipeline, apply migration 007 once through authorized Supabase access, and verify SQL success. If the user must sign in, ask only for that blocked action and never request pasted secrets.
- [ ] Verify Vercel Ready and production authenticated Reviews/Home/settings, role restrictions, snapshot export, and instruction downloads. Do not create fabricated financial reports/tasks in production. Mutation verification remains isolated; report this limitation explicitly.
- [ ] Start/restore an available local development preview and provide its URL. Record deployed commit, migration status, test evidence, and any remaining sign-in dependency.
- [ ] Give Luke the exact Muse prompt and the in-app place to create/copy its separate key. State clearly whether the app is deployed, whether Muse is scheduled, and whether the ChatGPT handoff has actually been verified. Do not imply either latter step happened merely because app endpoints work.

## Self-Review

Every spec section maps to Tasks 1-7. Contracts are shared by file import and
courier ingestion; existing task status is never updated by a delivery. Review
Focus cases are assigned explicit tests. The plan does not add general-purpose
AI access, financial mutations, or a new ChatGPT runtime. User approval of this
plan and the execution method is required before product implementation.
