import { z } from 'zod';
import type { Category, Snapshot } from './types';

const name = z.string().trim().min(1).max(100);
const group = z.enum(['flexible', 'fixed', 'business']);
const amount = z.number().int().min(0).max(10000000000);
const add = z.strictObject({ action: z.literal('add'), name, group, monthly_cents: amount, rollover: z.boolean() });
const update = z.strictObject({ action: z.literal('update'), id: z.string().min(1).max(300), name: name.optional(), group: group.optional(), monthly_cents: amount.optional(), rollover: z.boolean().optional() });
const remove = z.strictObject({ action: z.literal('delete'), id: z.string().min(1).max(300), confirm_name: name, replacement_id: z.string().min(1).max(300), confirm_delete: z.literal(true), reason: z.string().trim().min(10).max(500) });
const schema = z.strictObject({ version: z.literal(1), changes: z.array(z.discriminatedUnion('action', [add, update, remove])).min(1).max(30) });
export type CategoryPlan = z.infer<typeof schema>;

export function expectedCategorySnapshot(categories: Category[]) {
  return Object.fromEntries(categories.map(({ id, name, group, monthly_cents, rollover }) => [id, { name, group, monthly_cents, rollover }]));
}

export function makeCategoryInstructions(categories: Category[]) {
  const settings = categories.map(({ id, name, group, monthly_cents, rollover }) => ({ id, name, group, monthly_cents, rollover }));
  return `Help me revise my family budget categories. Use only the category settings below; you have not been given bank accounts or purchases. Ask me about any ambiguous changes. Return ONLY one JSON object in a single \`\`\`json code block (the copyable text box in ChatGPT), without explanation, with this shape: {"version":1,"changes":[...]}. Do not include unchanged categories. Omitting a category does NOT delete it.\n\nEach change must be exactly one of:\n- {"action":"add","name":"Gifts","group":"flexible","monthly_cents":5000,"rollover":false}\n- {"action":"update","id":"gas","name":"Fuel","monthly_cents":22500} (include only fields to change)\n- {"action":"delete","id":"gas","confirm_name":"Gas","replacement_id":"dates","confirm_delete":true,"reason":"My explicit reason for merging this category"}\n\nOnly produce a delete when I expressly request that named category be deleted. Copy its exact existing id and name into id and confirm_name. replacement_id must name a DIFFERENT existing category that will remain; all historical purchases, splits, tasks, and remembered merchant assignments for the deleted category move there. Explain the deletion in reason. Never infer deletion from omission or rename. Values are whole cents, not dollars; groups are flexible, fixed, or business. Do not include account data, transactions, notes, or secrets.\n\nCurrent categories:\n${JSON.stringify(settings, null, 2)}`;
}

export function parseCategoryPlan(text: string, categories: Category[]): CategoryPlan {
  const trimmed = text.trim();
  const blocks = [...trimmed.matchAll(/```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```/gi)];
  if (blocks.length > 1) throw new Error('Paste one JSON code block only.');
  const cleaned = blocks.length === 1 ? blocks[0][1].trim() : trimmed;
  let raw: unknown;
  try { raw = JSON.parse(cleaned); } catch { throw new Error('Could not read the plan. Copy the entire JSON code box from ChatGPT and paste it here.'); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new Error('The JSON plan has missing or invalid fields. Ask ChatGPT to follow the copied instructions exactly.');
  const plan = parsed.data;
  const byId = new Map(categories.map(category => [category.id, category]));
  const touched = new Set<string>();
  const deleted = new Set(plan.changes.filter(change => change.action === 'delete').map(change => change.id));
  const names = new Map(categories.map(category => [category.id, category.name]));
  for (const change of plan.changes) {
    if (change.action === 'add') continue;
    const current = byId.get(change.id);
    if (!current) throw new Error(`Unknown category: ${change.id}. Refresh and copy new instructions.`);
    if (touched.has(change.id)) throw new Error(`The category ${current.name} appears more than once.`);
    touched.add(change.id);
    if (change.action === 'update') {
      if (Object.keys(change).length === 2) throw new Error(`No changes were supplied for ${current.name}.`);
      names.set(change.id, change.name ?? current.name);
    } else {
      if (change.confirm_name !== current.name) throw new Error(`Delete confirmation does not match ${current.name}.`);
      if (!byId.has(change.replacement_id) || deleted.has(change.replacement_id)) throw new Error(`Choose an existing replacement category that will not be deleted for ${current.name}.`);
      names.delete(change.id);
    }
  }
  const seen = new Set<string>();
  for (const value of [...names.values(), ...plan.changes.filter(change => change.action === 'add').map(change => change.name)]) {
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) throw new Error(`Duplicate category name: ${value}.`);
    seen.add(key);
  }
  return plan;
}

export function previewCategoryPlan(data: Snapshot, plan: CategoryPlan, month: string): Snapshot {
  const next = structuredClone(data);
  for (const change of plan.changes) {
    if (change.action === 'add') next.categories.push({ ...change, id: crypto.randomUUID(), start_month: month, color: '#548a78' });
    else if (change.action === 'update') next.categories = next.categories.map(category => category.id === change.id ? { ...category, ...change } : category);
    else {
      next.transactions = next.transactions.map(transaction => ({ ...transaction, category_id: transaction.category_id === change.id ? change.replacement_id : transaction.category_id, splits: transaction.splits.map(split => split.category_id === change.id ? { ...split, category_id: change.replacement_id } : split) }));
      next.tasks = next.tasks.map(task => task.category_id === change.id ? { ...task, category_id: change.replacement_id } : task);
      next.limits = next.limits.filter(limit => limit.category_id !== change.id);
      next.categories = next.categories.filter(category => category.id !== change.id);
    }
  }
  return next;
}
