'use client';
import { useEffect, useRef } from 'react';
import { X, ArrowRight, Inbox } from 'lucide-react';
export function Modal({ title, children, close }: { title: string; children: React.ReactNode; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current; d?.showModal(); return () => d?.close(); }, []);
  return <dialog ref={ref} onCancel={close} onClick={e => { if (e.target === ref.current) close(); }}><div className="dialog-head"><h2>{title}</h2><button className="icon-btn" aria-label="Close dialog" title="Close" onClick={close}><X size={20} /></button></div>{children}</dialog>;
}
export function Empty({ title, text, action, onAction }: { title: string; text?: string; action?: string; onAction?: () => void }) { return <div className="empty"><Inbox size={28} strokeWidth={1.4}/><strong>{title}</strong>{text && <p>{text}</p>}{action && <button className="text-btn" onClick={onAction}>{action}<ArrowRight size={16}/></button>}</div>; }
export function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="field"><span>{label}</span>{children}</label>; }
export function Submit({ busy, label = 'Save changes' }: { busy: boolean; label?: string }) { return <button className="primary" type="submit" disabled={busy}>{busy ? 'Saving...' : label}</button>; }
export function FormError({ error }: { error: string }) { return error ? <p className="form-error" role="alert">{error}</p> : null; }
