# SDD ledger - plan: docs/superpowers/plans/2026-10-04-financial-review-courier.md

Base: cc249a6. Execution: inline, independent whole-change review requested.

Ruling: Work on codex/financial-review-courier in the current checkout, honoring
the user's request to work here; leave main and unrelated next-env.d.ts untouched.
No external worktree created. Cost if wrong: shared development checkout remains
visible to the user, but changes are not published until verified.

Ruling: Windows lacks the skill's POSIX task bookkeeping runtime; use this
checked-in ledger, focused test output, and task commits as the equivalent record.
Cost if wrong: less automated tracking; explicit evidence remains available.

Pre-flight: Tasks 1/3/4/5 share periods/contracts/export; use the shared Zod types.
Tasks 2/3 share identity and RPC return contracts; session identity is a member
UUID, courier identity a hash, both rechecked in SQL. Tasks 2/4 share report
summary/detail types; full packets load on demand. No conflicting names found.

Baseline: npm test passed 53/53 before implementation.
Task 1: complete. New reviews.test.ts observed module-not-found RED, then 3/3
GREEN for calendar/DST, strict packet validation, and double-count-safe export.
Contracts/export/periods now shared by server, UI, and handoff.

Tasks 2-3: migration and HTTP tests observed RED, then 8/8 focused tests passed.
Database tests cover replay/conflict/revisions, preserved completed task edits,
rollback, restricted grants, viewer rejection, revoked tokens, and rate caps.
HTTP tests cover byte/media limits, safe errors, scoped credentials, and Origin.
Task 4: UI implemented; browser RED exposed missing controls before implementation.
First post-implementation browser run reached successful import/replay; two test
locators needed adjustment for existing task-count labels and switch/region names.
Ruling: Build the handoff shared module before finishing UI, since export controls
consume its schema/example. Cost: task order differs, no scope or behavior change.
Task 5: shared Muse/ChatGPT prompt and schema generation passed handoff test after
observed RED. Human-readable documentation and final release prompt still pending.

Task 4: browser suite passed 18/18 on one worker, including review import/replay,
phone layout, dashboard preferences, and all prior budgeting workflows.
Task 5: both Muse and ChatGPT instructions are documented and available for
download in the app. Example packet validates against the shared contract.
Follow-through: recent review task references are now included in exports;
focused test, full 65/65 unit/database suite, and typecheck passed.
Release candidate: optimized production build passed and emits all review routes.
Independent whole-change review and production rollout remain pending.
