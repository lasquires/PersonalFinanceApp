# Purchase Entry and Import Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make manual purchase entry convenient on Home and reconcile bank imports without duplicate budget charges.

**Architecture:** Extend the existing ledger, household RPC, and bank sync rather than introduce a second ledger. Database state determines budget inclusion and one-to-one links; shared TypeScript helpers determine candidate ranking and presentation. Reuse a single purchase editor in Home and Transactions.

**Tech Stack:** Existing Next.js App Router, React, TypeScript, Supabase/PostgreSQL, Lucide, Node tests/PGlite, and Playwright. No new production dependencies.

**Spec:** `docs/superpowers/specs/2026-10-04-purchase-import-reconciliation-design.md`

**Execution:** Native, in this session, preserving the user's previously selected approach. Implement after plan approval.

## Global Constraints

- This remains the existing installable web app, not a new native binary.
- Suggestions never silently merge or delete purchases.
- Existing categorized purchases and their current budget treatment are preserved at migration.
- Viewers cannot create, edit, match, unmatch, or dismiss records.
- Keep unrelated SNAP, invitations, OAuth, and financial-plan behavior unchanged.
- Apply the migration, publish to the existing GitHub/Vercel project, and verify signed-in production entry and review without exposing credentials or creating real test financial records.

## Review Focus

- Two simultaneous match confirmations: exactly one active link wins, without losing a record (Task 2).
- Equal amounts at different merchants, opposite-sign refunds, excluded records, and incompatible accounts: no misleading automatic match (Tasks 1 and 2).
- Pending charge posts with a changed amount/currency: preserve duplicate suppression, flag attention, retain manual splits (Task 2).
- A candidate is deleted, edited, rejected, or backdated: reevaluate holds without silently charging on undo (Tasks 1 and 2).
- Phone keyboard, long merchant names, sheet scrolling, and safe areas: Save remains reachable and lists do not overflow (Task 4).

## Task 1: Shared Counting and Candidate Rules

**Files:** Create `src/lib/reconciliation.ts`, `tests/reconciliation.test.ts`; modify `src/lib/types.ts`, `src/lib/finance.ts`, `src/lib/store.ts`, `tests/finance.test.ts`.

**Interfaces:** Add optional `Transaction.budget_state: 'unbudgeted'|'budgeted'|'held'|'matched'` and `matched_manual_id: string|null` for legacy fixture compatibility. Add `MatchRejection = {import_id: string; manual_id: string}` and optional `Snapshot.match_rejections: MatchRejection[]`. Export `countsInBudget(transaction: Transaction): boolean`, `eligibleMatches(imported: Transaction, transactions: Transaction[], rejections?: MatchRejection[]): Transaction[]`, and `likelyMatches(imported: Transaction, transactions: Transaction[], rejections?: MatchRejection[]): Transaction[]`. Export `reconcilePreview(data: Snapshot, action: string, payload: Record<string, unknown>): Snapshot` for the existing preview action path.

- [ ] Write failing tests: a held or matched import contributes zero allocations; a legacy categorized purchase still counts; a matched manual split counts exactly its total. Candidate eligibility requires an active unmatched USD expense, equal signed cents, dates within seven days inclusive, and compatible explicit accounts; excluded, removed, nonexpense, opposite-sign, and already-linked records are rejected. Similar normalized merchant tokens rank likely suggestions; same-amount unrelated merchants remain eligible for manual selection but are not labeled likely.
- [ ] Run `npm test`; confirm new assertions fail for missing helpers or old counting behavior.
- [ ] Implement helpers and use `countsInBudget` in `allocations`. Preview supports `match_import`, `unmatch_import`, and `separate_import`; purchase writes reevaluate affected holds. A rejection excludes only the rejected pair, not every other manual candidate. Undo and linked-manual removal return the import to unbudgeted review.
- [ ] Run `npm test`; confirm candidate boundary dates, manual-before-import, import-before-manual, rejected candidate, correction, and deletion cases pass.
- [ ] Commit only Task 1 files with `feat: define purchase reconciliation rules`.

## Task 2: Atomic Production Reconciliation and Bank Sync

**Files:** Create `supabase/migrations/006_purchase_reconciliation.sql`, `tests/reconciliation-database.test.ts`; modify `src/lib/server/plaid.ts`, `tests/database.test.ts`, `src/lib/store.ts` where new RPC errors need user-facing messages.

**Interfaces:** Extend `public.household_action(action text, payload jsonb, origin text)` with `match_import` payload `{import_id,manual_id}`, `unmatch_import` payload `{import_id}`, and `separate_import` payload `{import_id,manual_id}`. Retain the current `transaction` action and `remember_category` contract. Add authenticated household-read `public.list_import_match_rejections(after_import_id text default null, after_manual_id text default null, page_size int default 1000)` returning `(import_id text, manual_id text)` in tuple order with a maximum page size of 1000; anonymous execution is revoked. `readSnapshot` paginates this RPC into `match_rejections`, initializing preview/default snapshots to an empty list. Preserve `server_apply_sync`'s existing cursor compare-and-swap signature.

- [ ] Write failing PGlite tests that apply migrations 001 through 006. Assert new imports are Uncategorized/unbudgeted, remembered merchants are budgeted without duplicates, either insertion order holds possible duplicates, and existing categorized imports preserve spending. Assert CSV imports receive the same review rules and repeat imports remain idempotent.
- [ ] Run `npm test`; confirm failures originate from missing migration/state behavior.
- [ ] Add ledger state/link constraints, an active one-to-one partial unique index, private rejected-pair storage, and audit-aware RPC actions. Lock reconciliation mutations in a consistent order (a shared transaction-scoped advisory lock followed by row locks) to serialize matching and entry/sync races. Validate permissions, source, account, amount, currency, date, and current linkage inside the transaction; do not trust submitted state fields. Preserve current security-definer search paths and grants.
- [ ] Extend existing transaction writes to accept an optional valid account for manual entry and allow manual amount/date/merchant correction. Maintain split validation, avoid mutating bank-provided amount/date, and reject conflicting direct edits of matched imports. Pair rejections and candidate eligibility are reevaluated on relevant entry changes.
- [ ] Normalize future Plaid expense categories to null. Apply only explicit merchant rules, then hold likely duplicates before budgeting. Preserve legacy classification on sync of existing records. For pending replacement, release the pending record's active link before inserting the posted counterpart within the same transaction; carry linkage, holds, and rejected-pair decisions forward. Changed amount/currency keeps a matched import suppressed and marks it Needs attention. Sync never changes the manual entry.
- [ ] Update `assistant_spending` to use exactly the same state inclusion rules as frontend allocations; retain its existing output columns so dependent budget views and MCP tools keep their contracts.
- [ ] Run `npm test`; assert viewer/outsider denial, second-link rejection, simultaneous confirm serialization, changed pending amounts, preserved splits, manual deletion/edit, undo-to-review, rejected-as-different budgeting, and assistant/frontend total agreement. Check no SQL grants expose bank tokens or merchant rule tables.
- [ ] Commit Task 2 files with `feat: reconcile bank imports atomically`.

## Task 3: Purchase Entry and Import Review Interface

**Files:** Create `src/components/purchase-editor.tsx`, `src/components/import-review.tsx`, `e2e/reconciliation.spec.ts`; modify `src/components/home.tsx`, `src/components/budget.tsx`, `src/components/transactions.tsx`, `src/components/finance-app.tsx`, `src/components/ui.tsx`, `e2e/app.spec.ts`, `e2e/dashboard-sync.spec.ts`.

**Interfaces:** `PurchaseEditor({transaction, data, save, close})` consumes the existing `Save` contract and optional initial category through a blank manual transaction. `ImportReview({data, month, allTime, save, onEdit})` displays/imports reconciliation actions. `CategoryBar` accepts optional `onAdd` as a sibling plus button, never nested inside the category drilldown button. Transactions uses `initialView?: 'purchases'|'imports'` for dashboard review navigation; retain existing month/category/account navigation behavior.

- [ ] Write failing browser tests for Home Add purchase, a category plus with preselection, backdated entry, optional account, manual correction, Purchases/Bank imports separation, no-likely-match entry, candidate confirmation, reject-as-different, and undo. Include both arrival orders and confirm category drilldowns still include split allocations.
- [ ] Run `npm run test:e2e`; confirm missing UI/action failures, using mocked bank data and the existing test server rather than live financial writes.
- [ ] Extract the existing editor while preserving CSV parsing/import, remember-category, split, exclusions, and transfer/income controls. Require a category or valid split for new manual purchases intended to count; show a distinct imported-record category workflow. Keep existing Add and modal accessible names compatible where practical.
- [ ] Add Home purchase entry and per-category plus shortcuts, gated by write role. Separate Purchases and Bank imports with familiar segmented controls. Unbudgeted/held/matched bank counterparts stay out of Purchases; budgeted imported purchases remain inspectable there. Import cards show explicit reconciliation and budget statuses, accessible on mobile rather than hidden in desktop-only columns. Provide candidate selection, matched-record inspection, undo, separate-purchase confirmation, and Add to budget without creating a second record.
- [ ] Run `npm run test:e2e`; verify both arrival orders count once, all-time/month reset still works, errors retain drafts, viewers see no write controls, and failed saves do not optimistically claim reconciliation succeeded.
- [ ] Commit Task 3 files with `feat: add home purchase entry and bank import review`.

## Task 4: iPhone Presentation and Verified Release

**Files:** Modify `src/app/interface.css`, `src/components/ui.tsx`, `e2e/reconciliation.spec.ts`; update this plan's checkboxes as work completes.

**Interfaces:** Purchase editor opts into a sheet variant of the existing `Modal`; other dialogs retain their established behavior. No new navigation destination or native app package is introduced.

- [ ] Add browser assertions for 390x844 and 430x932 phone viewports, desktop 1440x960, dark appearance, long labels, viewport keyboard reduction, reachable Save, sheet scrolling, reduced motion, and zero horizontal overflow.
- [ ] Implement system-font iOS-style grouped lists, restrained backgrounds/separators, bottom-sheet forms with visible close/save controls, minimum 44 CSS-pixel touch targets, and safe-area-aware tab bar spacing. Preserve semantic form labels and focus management, and keep plus buttons visually separate from category drilldowns.
- [ ] Read the local Next.js component/CSS guidance and run React quality review before finalizing changes. Run `npm test`, `npm run test:e2e`, and `npm run build`; require exit 0 for all. Inspect generated screenshots, not just overflow assertions. Obtain independent review if a reviewer tool is available; otherwise explicitly self-review SQL invariants and role gates.
- [ ] Commit verified interface/test changes. Apply migration 006 to the existing Supabase project, preserving a recoverable prior schema definition; confirm success before deploying dependent app code. No credentials are printed, committed, or given to other services.
- [ ] Push approved work to main and verify the matching Vercel production commit is Ready. Verify live signed-in dashboard controls, filtered categories, and import status rendering read-only; do not create real test purchases. Keep a screenshot as proof and report any unverified production mutation coverage plainly.
- [ ] Provide the live link and brief everyday instructions: Home Add purchase, category plus, and Bank imports review. State only verified test/build/deployment results.
