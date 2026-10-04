'use client';
import { useEffect, useRef, useState } from 'react';
import { browserDb } from './supabase/client';
import { dashboardPreferencesSchema, defaultDashboardPreferences, parseDashboardPreferences, type DashboardPreferences } from './dashboard-preferences';

export function useDashboardPreferences(userId: string | null, preview: boolean) {
  const [preferences, setPreferences] = useState(defaultDashboardPreferences);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const version = useRef(0);
  const request = useRef(0);
  const saving = useRef(false);
  useEffect(() => {
    const current = ++version.current;
    setPreferences(defaultDashboardPreferences());
    setError('');
    if (preview) {
      try { setPreferences(parseDashboardPreferences(JSON.parse(localStorage.getItem('squires-dashboard-preview-v1') ?? 'null'))); } catch {}
      setLoading(false);
      return;
    }
    if (!userId) { setLoading(false); return; }
    let active = true;
    const load = async () => {
      if (saving.current) return;
      const latest = ++request.current;
      setLoading(true);
      try {
        const { data, error: loadError } = await browserDb().from('dashboard_preferences').select('sections,account_ids,category_ids').eq('user_id', userId).maybeSingle();
        if (!active || current !== version.current || latest !== request.current) return;
        if (loadError) throw loadError;
        setPreferences(parseDashboardPreferences(data));
        setError('');
      } catch {
        if (active && current === version.current && latest === request.current) setError('Your dashboard choices could not be loaded. Please try again.');
      } finally {
        if (active && current === version.current && latest === request.current) setLoading(false);
      }
    };
    void load();
    window.addEventListener('focus', load);
    return () => { active = false; window.removeEventListener('focus', load); };
  }, [userId, preview]);

  async function savePreferences(value: DashboardPreferences) {
    const valid = dashboardPreferencesSchema.parse(value);
    const current = version.current;
    ++request.current;
    saving.current = true;
    setLoading(false);
    try {
      if (preview) localStorage.setItem('squires-dashboard-preview-v1', JSON.stringify(valid));
      else {
        if (!userId) throw new Error('Sign in to save your dashboard.');
        const { error: saveError } = await browserDb().from('dashboard_preferences').upsert({ user_id: userId, ...valid, updated_at: new Date().toISOString() });
        if (saveError) throw new Error('Your dashboard could not be saved. Please try again.');
      }
      if (current === version.current) { setPreferences(valid); setError(''); }
    } finally {
      saving.current = false;
    }
  }
  return { preferences, savePreferences, loading, error };
}
