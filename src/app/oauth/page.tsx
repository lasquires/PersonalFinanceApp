'use client';

import { useEffect, useState } from 'react';
import { usePlaidLink } from 'react-plaid-link';
import { api } from '@/components/plaid-connect';

function Resume({ token }: { token: string }) {
  const [error, setError] = useState('');
  const { open, ready } = usePlaidLink({
    token,
    receivedRedirectUri: window.location.href,
    onSuccess: async (publicToken, metadata) => {
      try {
        const item = sessionStorage.getItem('plaid-update-item');
        await api(item ? '/api/plaid/sync' : '/api/plaid/exchange', item ? { item_id: item } : {
          public_token: publicToken,
          institution: metadata.institution?.name ?? 'Connected institution',
        });
        sessionStorage.removeItem('plaid-link-token');
        sessionStorage.removeItem('plaid-update-item');
        window.location.replace('/');
      } catch (reason) {
        setError((reason as Error).message);
      }
    },
    onExit: () => window.location.replace('/'),
  });

  useEffect(() => {
    if (ready) open();
  }, [open, ready]);

  return <main className="auth-page">
    <h1>Finishing your connection</h1>
    {error ? <p role="alert">{error}</p> : null}
    <a href="/">Return to Squires</a>
  </main>;
}

export default function OAuth() {
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => setToken(sessionStorage.getItem('plaid-link-token')), []);
  return token ? <Resume token={token}/> : <main className="auth-page">
    <h1>Return to your household</h1>
    <a href="/">Continue</a>
  </main>;
}
