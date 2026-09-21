'use client';
import { useState, type FormEvent } from 'react';
import { LockKeyhole, ArrowRight } from 'lucide-react';
import { browserDb } from '@/lib/supabase/client';
import { googleSignInOptions } from '@/lib/auth';
import { Field, FormError } from './ui';
import styles from './auth-screen.module.css';

export function AuthScreen({ configured, allowPreview, preview }: { configured: boolean; allowPreview: boolean; preview: () => void }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const googleSignIn = async () => {
    setBusy(true);
    setError('');
    try {
      const { error: authError } = await browserDb().auth.signInWithOAuth(googleSignInOptions(window.location.origin));
      if (authError) setError('Google sign-in could not be started.');
    } catch {
      setError('Could not connect. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const passwordSignIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      const { error: authError } = await browserDb().auth.signInWithPassword({
        email: String(form.get('email')),
        password: String(form.get('password')),
      });
      if (authError) setError('Email or password was not recognized.');
    } catch {
      setError('Could not connect. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return <main className="auth-page">
    <div className="auth-brand"><img src="/icons/icon-192.png" width="48" height="48" alt=""/><span>Squires<span className="brand-sub">FAMILY FINANCE</span></span></div>
    <section className="auth-content">
      <div className="eyebrow"><LockKeyhole size={16}/> JUST OUR HOUSEHOLD</div>
      <h1>A little clarity.<br/>More room for life.</h1>
      {configured ? <>
        <button className={`secondary ${styles.google}`} type="button" disabled={busy} onClick={googleSignIn}>Continue with Google</button>
        <div className={styles.divider}><span>or use your password</span></div>
        <form onSubmit={passwordSignIn}>
          <Field label="Email"><input name="email" type="email" autoComplete="username" required/></Field>
          <Field label="Password"><input name="password" type="password" autoComplete="current-password" required/></Field>
          <FormError error={error}/>
          <button className="primary" disabled={busy}>{busy ? 'Signing in...' : 'Sign in'}<ArrowRight size={18}/></button>
          <p className="muted small">Private access for approved household members.</p>
        </form>
      </> : <div>
        <h2>Your household is getting ready.</h2>
        <p className="muted">Private sign-in and shared data will be available once account setup is finished.</p>
        {allowPreview && <button className="primary" onClick={preview}>Open local preview<ArrowRight size={18}/></button>}
      </div>}
    </section>
    <footer className="auth-footer">Squires family &middot; One month at a time.</footer>
  </main>;
}
