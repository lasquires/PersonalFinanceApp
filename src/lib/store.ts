"use client";
import { browserDb } from "./supabase/client";
import { defaults } from "./defaults";
import type { Snapshot, MatchRejection, Transaction } from "./types";
import { sortedCategories, validateSplits } from "./finance";
import { reconcilePreview,savePreviewPurchase } from './reconciliation';
import type { ReviewSummary } from './reviews/contracts';
import { expectedCategorySnapshot, type CategoryPlan } from './category-plan';
const tables = {
  categories: "categories",
  limits: "monthly_limits",
  transactions: "transactions",
  accounts: "accounts",
  tasks: "tasks",
  events: "financial_events",
  reservoir: "reservoir_entries",
  snap_balances: "snap_balance_snapshots",
  snap_public_observations: "snap_public_observations",
  members: "members",
  invitations: "household_invitations",
  tips: "tips",
} as const;
export async function readSnapshot(): Promise<Snapshot> {
  const db = browserDb();
  const result = defaults();
  await Promise.all(
    Object.entries(tables).map(async ([key, table]) => {
      const rows: unknown[] = [];
      let page = 0;
      while (true) {
        let query = db
          .from(table)
          .select("*")
          .order(table === "monthly_limits" ? "category_id" : "id");
        if (table === "monthly_limits") query = query.order("month");
        const { data, error } = await query.range(
          page * 1000,
          page * 1000 + 999,
        );
        if (error && (table === "household_invitations" || (["snap_balance_snapshots", "snap_public_observations"].includes(table) && ["42P01", "PGRST205"].includes(error.code ?? "")))) break;
        if (error)
          throw new Error(
            "Could not load household data. Check your connection and database setup.",
          );
        rows.push(...data);
        if (data.length < 1000) break;
        page++;
      }
      Object.assign(result, { [key]: rows });
    }),
  );
  result.categories = sortedCategories(result.categories);
  const { data, error } = await db
    .from("settings")
    .select("*")
    .eq("id", 1)
    .single();
  if (error)
    throw new Error("Household settings are missing. Finish database setup.");
  result.settings = data;
  result.reviews=[];
  for(let page=0;;page++){
    const {data: reviews,error: reviewError}=await db.from('financial_reviews').select('id,report_key,revision,kind,period_start,period_end,title,overview,generated_at,saved_at,snapshot_generated_at,warnings').order('id').range(page*1000,page*1000+999);
    if(reviewError&&['42P01','PGRST205'].includes(reviewError.code??'')){result.review_setup_missing=true;break;}
    if(reviewError)throw new Error('Financial reviews could not be loaded. Please try again.');
    result.reviews.push(...(reviews??[]) as ReviewSummary[]);if((reviews??[]).length<1000)break;
  }
  result.match_rejections=[];
  let last: MatchRejection | undefined;
  while (true) {
    const {data: rows,error: rejectionError}=await db.rpc('list_import_match_rejections',{after_import_id:last?.import_id ?? null,after_manual_id:last?.manual_id ?? null,page_size:1000});
    if(rejectionError) throw new Error('Could not load purchase matching decisions. Please try again.');
    const page=(rows ?? []) as MatchRejection[];
    result.match_rejections.push(...page);
    if(page.length<1000) break;
    last=page[page.length-1];
  }
  return result;
}
export async function writeAction(action: string, payload: unknown) {
  if (action === 'approve_snap_refill') {
    const value = payload as { benefit_month: string; balance_cents: number; observed_at: string };
    const { error } = await browserDb().rpc('approve_snap_refill', {
      month_start: value.benefit_month,
      expected_amount: value.balance_cents,
      expected_seen_at: value.observed_at,
    });
    if (error) throw new Error(error.code === 'PGRST202' ? 'SNAP deposit confirmation needs a database update.' : error.message);
    return;
  }
  if (action === 'resolve_removed_import') {
    const value = payload as { import_id: string; resolution: 'keep'|'dismiss'; category_id?: string|null };
    const { error } = await browserDb().rpc('resolve_removed_import', {
      import_id: value.import_id,
      resolution: value.resolution,
      chosen_category_id: value.category_id ?? null,
    });
    if (error) throw new Error(error.code === 'PGRST202' ? 'Feed changes need a database update. Please try again later.' : error.message);
    return;
  }
  if (action === "delete_category") {
    const value = payload as { id: string; replacement_id: string | null };
    const { error } = await browserDb().rpc("delete_household_category", {
      category_id: value.id,
      replacement_id: value.replacement_id,
    });
    if (error) throw new Error(error.message.includes('split') ? 'Choose another category for split purchases before deleting.' : 'This category could not be deleted. Please refresh and try again.');
    return;
  }
  if (action === "tip_status") {
    const value = payload as { id: string; status: "archived" | "dismissed" };
    const { error } = await browserDb().rpc("set_tip_status", {
      tip_id: value.id,
      next_status: value.status,
    });
    if (error) throw new Error("This tip could not be updated.");
    return;
  }
  const { error } = await browserDb().rpc("household_action", {
    action,
    payload,
    origin: "member",
  });
  if (error)
    throw new Error(
      error.message.includes("split")
        ? "Split amounts must add up exactly."
        : "This change could not be saved. Check the values and try again.",
    );
}
export async function writeCategoryPlan(plan: CategoryPlan, categories: Snapshot['categories'], month: string) {
  const { error } = await browserDb().rpc('apply_category_plan', {
    changes: plan.changes,
    expected_categories: expectedCategorySnapshot(categories),
    start_month: month,
  });
  if (error) throw new Error(error.message.includes('Categories changed')
    ? 'Categories changed on another device. Refresh and copy new instructions.'
    : error.code === 'PGRST202' ? 'Category plans need a database update before they can be used.'
    : `The plan was not applied: ${error.message}`);
}
export function previewAction(
  data: Snapshot,
  action: string,
  payload: Record<string, unknown>,
): Snapshot {
  const next = structuredClone(data);
  if (['match_import','unmatch_import','separate_import'].includes(action)) return reconcilePreview(data,action,payload);
  if(action==='transaction') {
    validateSplits(Number(payload.amount_cents),payload.splits as {amount_cents:number}[]);
    return savePreviewPurchase(data,payload as unknown as Transaction,payload.remember_category===true);
  }
  if (action === "settings")
    next.settings = payload as unknown as Snapshot["settings"];
  else if (action === "tip_status")
    next.tips = next.tips.map((tip) =>
      tip.id === payload.id
        ? {
            ...tip,
            status: payload.status as "archived" | "dismissed",
          }
        : tip,
    );
  else if (action === "budget") {
    next.limits = next.limits.filter(
      (x) =>
        !(x.category_id === payload.category_id && x.month === payload.month),
    );
    next.limits.push(payload as unknown as Snapshot["limits"][number]);
  } else if (action === 'delete_category') {
    const id = String(payload.id);
    const replacement = payload.replacement_id ? String(payload.replacement_id) : null;
    if (!next.categories.some(c => c.id === id)) throw new Error('Category no longer exists.');
    if (replacement && !next.categories.some(c => c.id === replacement && c.id !== id)) throw new Error('Choose another category.');
    if (!replacement && next.transactions.some(t => t.splits.some(s => s.category_id === id))) throw new Error('Choose another category for split purchases.');
    next.transactions = next.transactions.map(t => {
      if (t.category_id !== id && !t.splits.some(s => s.category_id === id)) return t;
      const category_id = t.category_id === id ? replacement : t.category_id;
      const splits = t.splits.map(s => s.category_id === id ? { ...s, category_id: replacement! } : s);
      return { ...t, category_id, splits,
        budget_state: !replacement && t.category_id === id && t.budget_state !== 'matched' ? 'unbudgeted' as const : t.budget_state,
        needs_review: !replacement && t.category_id === id && t.kind === 'expense' && !t.excluded ? true : t.needs_review };
    });
    next.tasks = next.tasks.map(t => t.category_id === id ? { ...t, category_id: replacement } : t);
    next.limits = next.limits.filter(l => l.category_id !== id);
    if (next.preview_merchant_rules) next.preview_merchant_rules = Object.fromEntries(Object.entries(next.preview_merchant_rules).flatMap(([key, value]) => value === id ? replacement ? [[key, replacement]] : [] : [[key, value]]));
    next.categories = next.categories.filter(c => c.id !== id);
  } else if (action === "delete_event")
    next.events = next.events.filter((x) => x.id !== payload.id);
  else if (action === "delete_transaction")
    next.transactions = next.transactions.map((t) =>
      t.id === payload.id ? { ...t, removed: true } : t,
    );
  else {
    const key = (
      {
        category: "categories",
        task: "tasks",
        event: "events",
        reservoir: "reservoir",
        transaction: "transactions",
      } as const
    )[action as "category"];
    if (!key) throw new Error("Unknown change");
    if (key === 'categories') next.categories = sortedCategories([...next.categories.filter(x => x.id !== payload.id), payload as unknown as Snapshot['categories'][number]]);
    else Object.assign(next, { [key]: [...(next[key] as {id:string}[]).filter(x => x.id !== payload.id), payload] });
  }
  return action==='delete_transaction' ? reconcilePreview(next,action,payload) : next;
}

