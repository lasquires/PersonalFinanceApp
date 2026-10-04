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

Migration 006 applied to the existing Supabase production project on 2026-10-04; SQL Editor reported Success. No rows returned. Release commit 4204494 pushed to main and Vercel production reported Ready. Signed-in live checks confirmed Home Add purchase, category plus with Gas preselected, category drilldown (3 October purchases versus 59 all-time purchases), and Bank imports reconciliation/budget status rendering. No production test financial records were created.

Live proof saved at test-results/live-purchase-dashboard.jpg. Local preview runs on http://localhost:3018. The in-app browser viewport override did not change its actual 1280x720 viewport; phone layout verification therefore relies on the passing local Playwright phone tests/screenshots rather than claiming a live iPhone check. Actual multi-session database concurrency remains unexercised by the in-memory tests.
