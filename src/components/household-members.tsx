"use client";
import { useState, type FormEvent } from "react";
import { UserPlus, Trash2, RotateCw } from "lucide-react";
import type { Invitation, Member, MemberRole } from "@/lib/types";
import { Field, Modal, FormError } from "./ui";

const labels: Record<MemberRole, string> = {
  admin: "Administrator",
  member: "Full access",
  viewer: "Read-only",
};
async function request(path: string, init: RequestInit) {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(body.error ?? "The change could not be saved.");
  return body;
}
export function HouseholdMembers({
  members,
  invitations,
  preview,
  refresh,
}: {
  members: Member[];
  invitations: Invitation[];
  preview: boolean;
  refresh: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (preview) {
      setOpen(false);
      return;
    }
    setBusy(true);
    setError("");
    const form = new FormData(e.currentTarget);
    try {
      await request("/api/household/invitations", {
        method: "POST",
        body: JSON.stringify({
          email: form.get("email"),
          role: form.get("role"),
        }),
      });
      setOpen(false);
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const mutate = async (path: string, method: string, body?: unknown) => {
    if (preview) return;
    setError("");
    try {
      await request(path, {
        method,
        body: body ? JSON.stringify(body) : undefined,
      });
      refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <section className="settings-section">
      <div className="section-heading">
        <div>
          <h3>Household members</h3>
          <p className="muted small">
            Choose exactly what each person can access.
          </p>
        </div>
        <button className="secondary" onClick={() => setOpen(true)}>
          <UserPlus size={16} />
          Invite member
        </button>
      </div>
      <FormError error={error} />
      <div className="member-list">
        {members.map((member) => (
          <div className="account-row" key={member.id}>
            <span>
              <strong>{member.name}</strong>
              <small>{member.email ?? "Approved household account"}</small>
            </span>
            <select
              aria-label={`${member.name} access`}
              value={member.role}
              disabled={preview}
              onChange={(e) =>
                void mutate(`/api/household/members/${member.id}`, "PATCH", {
                  role: e.target.value,
                })
              }
            >
              {Object.entries(labels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <button
              className="icon-btn danger"
              aria-label={`Remove ${member.name}`}
              disabled={preview}
              onClick={() => {
                if (confirm(`Remove ${member.name} from the household?`))
                  void mutate(`/api/household/members/${member.id}`, "DELETE");
              }}
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>
      {invitations
        .filter((x) => ["pending", "error"].includes(x.status))
        .map((invite) => (
          <div className="account-row" key={invite.id}>
            <span>
              <strong>{invite.email}</strong>
              <small>
                {labels[invite.role]} · {invite.status}
              </small>
            </span>
            <button
              className="icon-btn"
              title="Resend"
              aria-label={`Resend ${invite.email}`}
              onClick={() =>
                void mutate(
                  `/api/household/invitations/${invite.id}`,
                  "PATCH",
                  { action: "resend" },
                )
              }
            >
              <RotateCw size={15} />
            </button>
            <button
              className="icon-btn danger"
              aria-label={`Revoke ${invite.email}`}
              onClick={() =>
                void mutate(`/api/household/invitations/${invite.id}`, "DELETE")
              }
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      {open && (
        <Modal title="Invite member" close={() => !busy && setOpen(false)}>
          <form onSubmit={submit}>
            <Field label="Email">
              <input name="email" type="email" required autoFocus />
            </Field>
            <Field label="Access">
            <select name="role" aria-label="Access" defaultValue="viewer">
                <option value="viewer">Read-only</option>
                <option value="member">Full access</option>
                <option value="admin">Administrator</option>
              </select>
            </Field>
            <p className="small muted">
              Read-only is the safest starting point. Administrators can invite
              and remove people.
            </p>
            <FormError error={error} />
            <button className="primary" disabled={busy}>
              {busy ? "Sending..." : "Send invitation"}
            </button>
          </form>
        </Modal>
      )}
    </section>
  );
}
