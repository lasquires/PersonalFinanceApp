import { z } from 'zod';

export const dashboardSections = [
  { id: 'spending', label: 'Spending categories' },
  { id: 'accounts', label: 'Account balances' },
  { id: 'reserve', label: 'Reserve & runway' },
  { id: 'snap', label: 'SNAP balance' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'tips', label: 'Weekly tips' },
  { id: 'upcoming', label: 'Upcoming events' },
  { id: 'activity', label: 'Recent transactions' },
] as const;

const sectionIds = ['spending', 'accounts', 'reserve', 'snap', 'tasks', 'tips', 'upcoming', 'activity'] as const;
const ids = z.array(z.string().min(1).max(300)).max(1000).refine(values => new Set(values).size === values.length);
export const dashboardPreferencesSchema = z.strictObject({
  sections: z.array(z.enum(sectionIds)).max(8).refine(values => new Set(values).size === values.length),
  account_ids: ids.nullable(),
  category_ids: ids.nullable(),
});
export type DashboardPreferences = z.infer<typeof dashboardPreferencesSchema>;
export type DashboardSection = DashboardPreferences['sections'][number];
export function defaultDashboardPreferences(): DashboardPreferences {
  return { sections: [...sectionIds], account_ids: null, category_ids: null };
}
export function parseDashboardPreferences(value: unknown): DashboardPreferences {
  const parsed = dashboardPreferencesSchema.safeParse(value);
  return parsed.success ? parsed.data : defaultDashboardPreferences();
}
