# Execution Ledger

Baseline: 7fd33d1. User approved the design and implementation plan; native execution.

Ruling: reuse the current checkout, preserving generated next-env.d.ts changes, because this is the already-approved deployed app checkout and no unrelated source edits are present.

Task 1 started: counting, eligibility, and reversible preview tests written before implementation.

Tasks 1-3 implemented: state-aware allocations, eligible and likely candidates, reversible links and per-pair rejection, guarded database mutations, preserved pending replacements, Home entry shortcuts, and separate bank import review.

Task 4 implemented locally: grouped phone dashboard, 44px controls, purchase bottom sheet, keyboard-height layout check, and safe-area footer. Desktop, phone, and dark dashboard screenshots inspected.

Verification: 53 Node tests and 16 Playwright tests passed on 2026-10-04. The database fixture applies migrations 001 through 006. TypeScript checking and optimized production builds passed. Rejection and remembered-preview regressions were observed failing before targeted fixes.

Ruling: release the closely coupled schema, counting, and interface work as one integrated implementation commit instead of separate task commits. The additive migration retains prior RPC definitions under private-to-client backup names and leaves historical budget state unchanged.

Independent review identified changed held pending charges, stale inherited matches after removal, and resolved review flags. All three were reproduced with failing tests and fixed. Insert/update guards return changed held charges to unbudgeted review and prevent stale links from reclaiming already-owned manual purchases. Targeted review of those fixes requested.

Follow-up review found that unchanged remembered-bank sync cleared held review flags. Reproduced and fixed both insert and UPSERT update paths. Independent targeted review reports all four findings resolved and independently reran all five database tests successfully.

Migration 006 applied to the existing Supabase production project on 2026-10-04; SQL Editor reported Success. No rows returned. GitHub/Vercel deployment and read-only live verification remain pending. Production mutation testing deliberately uses local fixtures instead of real household purchases; actual multi-session concurrency is not exercised by the in-memory database tests.
