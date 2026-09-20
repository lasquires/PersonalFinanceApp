'use client';

import { useEffect, useState } from 'react';
import { Landmark } from 'lucide-react';
import { usePlaidLink } from 'react-plaid-link';

export async function api(path: string, body: unknown = {}) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'Request failed');
  return data;
}

function LinkSession({ token, itemId, done, reportError }: {
  token: string;
  itemId?: string;
  done: () => void;
  reportError: (message: string) => void;
}) {
  const { open, ready } = usePlaidLink({
    token,
    onSuccess: async (publicToken, metadata) => {
      try {
        if (itemId) await api('/api/plaid/sync', { item_id: itemId });
        else await api('/api/plaid/exchange', {
          public_token: publicToken,
          institution: metadata.institution?.name ?? 'Connected institution',
        });
        sessionStorage.removeItem('plaid-link-token');
        sessionStorage.removeItem('plaid-update-item');
        done();
      } catch (error) {
        reportError((error as Error).message);
      }
    },
    onExit: error => reportError(error?.display_message ?? ''),
  });

  useEffect(() => {
    if (ready) open();
  }, [open, ready]);

  return null;
}

export function PlaidConnect({ preview, refresh, itemId }: {
  preview: boolean;
  refresh: () => void;
  itemId?: string;
}) {
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const finish = () => {
    setToken(null);
    setBusy(false);
    refresh();
  };

  const reportError = (message: string) => {
    setError(message);
    setToken(null);
    setBusy(false);
  };

  const start = async () => {
    setError('');
    if (preview) {
      setError('Connect the private database and Plaid account to enable bank connections.');
      return;
    }
    setBusy(true);
    try {
      const data = await api('/api/plaid/link-token', itemId ? { item_id: itemId } : {});
      sessionStorage.setItem('plaid-link-token', data.link_token);
      if (itemId) sessionStorage.setItem('plaid-update-item', itemId);
      else sessionStorage.removeItem('plaid-update-item');
      setToken(data.link_token);
    } catch (reason) {
      reportError((reason as Error).message);
    }
  };

  return <>
    <button className={itemId ? 'secondary' : 'primary'} disabled={busy} onClick={start}>
      <Landmark size={16}/>
      {busy ? 'Opening...' : itemId ? 'Reconnect' : 'Connect an account'}
    </button>
    {token ? <LinkSession token={token} itemId={itemId} done={finish} reportError={reportError}/> : null}
    {error ? <p className="form-error" role="alert">{error}</p> : null}
  </>;
}
