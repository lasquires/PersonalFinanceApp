import { FinanceApp } from '@/components/finance-app';
export default function Page() { return <FinanceApp configured={Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)} allowPreview={process.env.NODE_ENV === 'development'} />; }
