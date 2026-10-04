# Purchase Entry and Bank Import Review

## Approved Product Direction

The household wants manual purchase entry to drive its budget. Bank imports remain available as a checklist for forgotten purchases, rather than silently spending category balances. Explicit remembered-merchant rules can budget future purchases automatically. A manual entry and its bank record must never count twice after reconciliation.

Home offers Add purchase and a separate plus button beside each spending category. Category entry starts with that category selected. Transactions contains Purchases and Bank imports views. iPhone presentation uses system typography, readable grouped lists, generous touch targets, stable bottom navigation, safe-area padding, and bottom-sheet purchase forms. This remains the existing installable web app, not a new native binary.

## Everyday Flow

1. Enter a purchase from Home: merchant, amount, date, category, optional account and note. It affects the selected category immediately. Manual dates can be backdated; amounts and dates can be corrected later.
2. Review Bank imports for the selected month, with All time available. New bank purchases without a remembered rule are Uncategorized and not budgeted.
3. An import shows Possible match found, No likely match found, or Matched. Its separate budget status shows Not budgeted, Automatically budgeted, or Already recorded. Transfers and income remain distinguishable and do not masquerade as forgotten purchases.
4. Match existing purchase links a bank record to a manual entry. Add to budget opens the imported record's category form instead of creating another purchase.
5. Remember category explicitly opts future purchases from that merchant into automatic categorization and budgeting. A possible manual duplicate pauses that automatic budget charge until reviewed.
6. Adding a manual purchase after a bank import must also find possible matches. The imported charge is held from budgeting while the manual purchase counts. The user confirms the link or identifies the import as a different purchase.

## Matching and Budget Invariants

- Match candidates are active, unmatched manual expenses with the same signed integer-cent amount and currency, within seven calendar days. Explicitly different accounts are not candidates. Merchant similarity ranks candidates; multiple candidates stay a choice rather than an automatic match.
- Suggestions never silently merge or delete purchases. The user can select another eligible manual purchase when no likely match is found.
- Confirmed links are one-to-one. Link validation and updates are atomic in the database, including concurrent attempts by both household members. Viewers cannot create, edit, match, unmatch, or dismiss records.
- A matched bank record never contributes a second budget allocation. Manual category, splits, and note are preserved. Both records remain inspectable.
- A held import can be confirmed as a separate purchase and budgeted normally. Matching is reversible; undo returns the import to review without silently spending a second time.
- Removed, excluded, non-USD, income, and transfer records do not become budgeted expenses merely because a candidate exists. Refund candidates require matching signed amounts, not absolute amounts.
- Pending-to-posted replacement preserves the link or hold. If the bank changes the amount or currency, keep the duplicate suppressed and display Needs attention; never silently change the manual budget amount or its split totals.
- Removing a linked manual entry returns the import to review. Removed bank records do not remove manually recorded purchases. Invalidated candidate holds are reevaluated rather than left stuck forever.
- Existing categorized purchases and their current budget treatment are preserved at migration. The new default applies to future imports; no historical mass recategorization or deletion occurs.
- Budget totals, category drilldowns, dashboard activity, and assistant finance views use the same counting rules. Repeated bank sync and repeated CSV import remain idempotent.

## Implementation Boundaries

Extend the existing transaction ledger with explicit import budget/reconciliation state and a nullable manual-record link. Keep merchant rules private. Add a migration that preserves historical records, secures matching writes through the existing household RPC boundary, and updates server sync and assistant allocation views. Use database locking and uniqueness constraints, not browser-only checks, for one-to-one matching.

Extract the existing purchase editor into a reusable component used by Home, category entry, and Transactions. Add a focused matching helper and an import-review component. Extend existing snapshot, preview, and finance helpers together so preview behavior agrees with production. Keep unrelated SNAP, invitations, OAuth, and financial-plan behavior unchanged.

## Acceptance Checks

- A new ordinary bank expense remains Uncategorized and does not change category spending; remembering a merchant budgets a subsequent unmatched expense.
- Home purchase entry and category plus buttons work on phone and desktop and support past dates.
- Adding a manual purchase before or after its imported counterpart leads to a visible candidate and only one budget charge while held or matched.
- Confirm, reject-as-different, undo, remove-manual, and pending-to-posted paths preserve expected totals and split allocations.
- Competing matching requests cannot link one record twice; viewers cannot write reconciliation state.
- No likely match is visible and actionable; manually selecting a match remains possible without a suggestion.
- Existing finance, merchant rules, bank sync, assistant, and UI regression tests still pass. Phone, dark appearance, sheet scrolling, keyboard-safe entry, and horizontal overflow are visually checked.
- Apply the migration, publish to the existing GitHub/Vercel project, and verify signed-in production entry and review without exposing credentials or creating real test financial records.
