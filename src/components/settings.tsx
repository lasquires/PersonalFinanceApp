"use client";
import { useState } from "react";
import {
  RefreshCw,
  LogOut,
  Sun,
  Moon,
  ShieldCheck,
  Download,
  Bot,
} from "lucide-react";
import type { Snapshot } from "@/lib/types";
import { PlaidConnect, api } from "./plaid-connect";
import { Empty } from "./ui";
import { money } from "@/lib/finance";
import { HouseholdMembers } from "./household-members";
export function Settings({
  data,
  preview,
  refresh,
  signOut,
  theme,
  toggleTheme,
  role,
}: {
  data: Snapshot;
  preview: boolean;
  refresh: () => void;
  signOut: () => void;
  theme: string;
  toggleTheme: () => void;
  role: "admin" | "member" | "viewer";
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const unique = [
    ...new Set(data.accounts.map((a) => a.item_id).filter(Boolean)),
  ];
  return (
    <>
      <div className="section-heading">
        <div>
          <h2>Our household</h2>
          <p className="muted">
            Luke & Samantha ·{" "}
            {role === "admin"
              ? "Administrator"
              : role === "member"
                ? "Full access"
                : "Read-only"}
          </p>
        </div>
        <button className="secondary" onClick={signOut}>
          <LogOut size={16} />
          {preview ? "Exit preview" : "Sign out"}
        </button>
      </div>
      {role === "admin" && (
        <HouseholdMembers
          members={data.members}
          invitations={data.invitations}
          preview={preview}
          refresh={refresh}
        />
      )}
      <section className="settings-section">
        <h3><Bot size={17}/>ChatGPT access</h3>
        <p className="muted">Connect once, then a scheduled ChatGPT Workspace Agent can review the week automatically. ChatGPT can read the household plan and create tips or suggested tasks, but it cannot move money or access bank credentials. ChatGPT may still require confirmation according to your workspace policy.</p>
        <label className="field"><span>Private connector address</span><input readOnly value="https://squires-family-finance.vercel.app/api/mcp" onFocus={event=>event.currentTarget.select()}/></label>
      </section>
      <section className="settings-section">
        <div className="section-heading">
          <h3>Connected accounts</h3>
          {role !== "viewer" && (
            <PlaidConnect preview={preview} refresh={refresh} />
          )}
        </div>
        <p className="muted small">
          Updates arrive when the bank reports them. Purchases may take a few
          days to appear.
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {!data.accounts.length ? (
          <Empty
            title="No accounts connected"
            text="Manual entries and CSV imports work without a bank connection."
          />
        ) : (
          unique.map((item) => (
            <div className="institution" key={item}>
              <div className="section-heading">
                <h4>
                  {data.accounts.find((a) => a.item_id === item)?.institution}
                </h4>
                {role !== "viewer" && (
                  <button
                    className="secondary"
                    disabled={busy === item}
                    onClick={async () => {
                      setBusy(item);
                      setError("");
                      try {
                        await api("/api/plaid/sync", { item_id: item });
                        refresh();
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setBusy(null);
                      }
                    }}
                  >
                    <RefreshCw
                      size={14}
                      className={busy === item ? "spin" : ""}
                    />
                    {busy === item ? "Syncing" : "Sync"}
                  </button>
                )}
              </div>
              {data.accounts
                .filter((a) => a.item_id === item)
                .map((a) => (
                  <div className="account-row" key={a.id}>
                    <span>
                      <strong>
                        {a.name} {a.mask ? "••" + a.mask : ""}
                      </strong>
                      <small>
                        {a.member} · {a.type}
                      </small>
                      <small>
                        {a.last_synced_at
                          ? "Updated " +
                            new Date(a.last_synced_at).toLocaleString()
                          : "Waiting for first sync"}
                      </small>
                    </span>
                    <strong>
                      {a.balance_cents === null
                        ? "--"
                        : money(a.balance_cents, true)}
                    </strong>
                  </div>
                ))}
            </div>
          ))
        )}
      </section>
      <section className="settings-section">
        <div className="section-heading">
          <h3>Appearance</h3>
          <button className="secondary" onClick={toggleTheme}>
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}{" "}
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </button>
        </div>
      </section>
      <section className="settings-section">
        <h3>
          <ShieldCheck size={17} />
          Private by design
        </h3>
        <p className="muted">
          Only the household's approved accounts can access shared finances.
          Bank connections read activity; the app cannot move money.
        </p>
        <button
          className="secondary"
          onClick={() => {
            const blob = new Blob([JSON.stringify(data, null, 2)], {
              type: "application/json",
            });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download =
              "squires-household-" +
              new Date().toISOString().slice(0, 10) +
              ".json";
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}
        >
          <Download size={16} />
          Export household data
        </button>
      </section>
    </>
  );
}
