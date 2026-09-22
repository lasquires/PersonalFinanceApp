# Household Access and ChatGPT Integration Design

## Status

Approved direction, pending written-spec review.

## Purpose

Extend Squires Family Finance without turning it into a public SaaS product. Luke and Samantha remain the initial household administrators. They can invite trusted people with explicit access levels, and they can connect normal ChatGPT web to a private MCP server that reviews household finances and creates useful tips or tasks. The app will not contain a GPT chat interface and will not call the OpenAI API.

The implementation must preserve the original brief's priorities: a private household app, correct financial accounting, no exposure of Plaid or Supabase secrets, auditable changes, and a $0/month default architecture.

## Scope

### Included

- Household roles: `admin`, `member`, and `viewer`.
- Luke and Samantha initialized as administrators.
- Admin-only invitation, role-change, resend, and removal controls in Settings.
- Email invitations through Supabase Auth's built-in invitation flow.
- A branded authorization/consent page for external clients.
- Supabase Auth OAuth 2.1 with PKCE for ChatGPT/MCP authentication.
- A remote MCP endpoint hosted with the existing application.
- Read tools for weekly financial review.
- Constrained write tools for tips and tasks.
- Confirmation-friendly tool descriptions and complete audit logging.
- Connection management in Settings, including revocation guidance.

### Deferred

- Public signup or household discovery.
- Multiple households, organizations, billing, or a generalized tenant model.
- GPT chat inside the app or use of the OpenAI API.
- Autonomous budget, transaction, event, or reservoir changes.
- Automatic scheduled ChatGPT runs. ChatGPT scheduling can be configured externally after the connector is working.
- Custom email vendors or other paid infrastructure.

## Roles and Authorization

The `members` table gains a role column:

- `admin`: full finance access plus member invitations, role changes, removal, and integration management.
- `member`: full finance read/write access, excluding household administration and integration management.
- `viewer`: read-only access to household finance data.

Luke and Samantha are migrated to `admin`. New invitations default to `viewer`; an admin must deliberately choose `member` or `admin` when broader access is needed. The interface explains the practical effect of each choice before the invitation is sent.

Authorization is enforced in Postgres and server routes, not only by hidden buttons. Existing broad authenticated write policies are replaced with role-aware policies. Viewers may select permitted household tables and assistant views but cannot execute write RPCs. Members retain finance-edit permissions. Only admins may execute member-management RPCs or call admin invitation routes.

The app remains one household. Roles control access within that household; they do not introduce organization or tenancy abstractions.

## Invitation Flow

Settings adds a **Household members** section visible to admins.

1. An admin enters an email address and selects `viewer`, `member`, or `admin`.
2. A server-only route verifies the caller's Supabase session and current admin role.
3. The route creates a pending invitation record with a random, single-use token hash and expiration.
4. The server invokes Supabase Auth's admin invitation API using the existing service-role credential.
5. The recipient follows the email link, signs in or creates the invited account, and returns to an invitation acceptance route.
6. The acceptance route atomically validates the invitation, inserts or updates the `members` row, marks the invitation accepted, and records an audit entry.

Pending invitations can be resent or revoked by an admin. Resending rotates the token and expiration. Removing a member immediately deletes their `members` row, which causes all RLS checks to fail for future requests. Removing the last admin is prohibited. An admin cannot accidentally demote the only remaining admin.

The invitation table stores email, intended role, status, expiration, inviter, and token hash. Plain invitation tokens are never stored. Email addresses are visible only to admins.

## ChatGPT/MCP Architecture

The selected approach is a remote MCP endpoint in the existing Next.js/Vercel app, protected by Supabase Auth acting as an OAuth 2.1 authorization server.

Supabase OAuth 2.1 is designed for MCP authentication, supports authorization-code flow with PKCE, dynamic client registration, refresh-token rotation, discovery metadata, and existing-user authentication. It is available on the existing Supabase plan without a separate OAuth charge. Official references:

- https://supabase.com/docs/guides/auth/oauth-server
- https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication

The flow is:

1. ChatGPT discovers the protected MCP resource and Supabase authorization server.
2. ChatGPT registers dynamically or uses a pre-registered client.
3. Supabase redirects Luke or Samantha to `/authorize`, the app's branded consent screen.
4. The signed-in administrator sees the client name and requested access, then approves or denies it.
5. Supabase issues a short-lived access token and rotating refresh token using PKCE.
6. ChatGPT calls `/api/mcp` with the access token.
7. The MCP route verifies the token through Supabase, requires an active `admin` member, and performs every database operation as that user so RLS remains authoritative.

The OAuth server will use asymmetric JWT signing keys so MCP clients can validate tokens from the public JWKS endpoint. Dynamic registration will require explicit user consent for every client. The MCP endpoint publishes the standard protected-resource metadata and `WWW-Authenticate` challenge required for OAuth discovery.

No Plaid token, Supabase service-role key, Google OAuth secret, bank credential, or raw MCP access token is returned by any tool or written to application logs.

## MCP Tools

Initial tools stay intentionally small.

### Read tools

- `review_week`: returns the current month/category status, seven-day spending summary, reservoir/floor/runway inputs, upcoming 90-day events, important tasks, and account-sync health.
- `list_budget_status`: returns monthly limits, spending, remaining amounts, and rollover status.
- `list_recent_transactions`: returns a bounded, redacted transaction list for a requested date range. It excludes Plaid identifiers and private sync metadata.
- `list_tasks`: returns active, suggested, waiting, or recently completed tasks.
- `list_tips`: returns current and historical household tips.

Read tools use the existing `assistant_*` views wherever possible. New views expose only the minimum additional fields required for weekly review.

### Write tools

- `create_tip`: publishes a concise weekly household tip with optional supporting facts and an expiration date.
- `create_task`: creates a `Suggested` task with title, assignee, priority, due date, estimated impact, related category/event, and notes.
- `update_tip`: edits or archives a tip created through the assistant.

Write tools are deliberately limited to advice and suggested work. They cannot change budget limits, recategorize transactions, alter reservoir balances, invite users, manage roles, connect banks, or initiate money movement in the first release. Those more consequential actions remain in the app until real use demonstrates a need for additional tools.

Tool names and descriptions state their side effects clearly so ChatGPT can request confirmation before a write. The MCP server still validates every argument and authorization independently; it never trusts model-generated identifiers or role claims.

## Tips in the App

A small **Weekly tips** section appears on Home beneath Needs Attention. It shows up to three current tips, their creation source, and the date created. Tips can be dismissed or archived by a member or admin. Viewers can only read them.

A `tips` table contains title, body, optional structured evidence, status, expiration, creator, origin, and timestamps. Content length is bounded. Evidence is stored as a compact JSON object containing display-safe values, not hidden chain-of-thought or raw account payloads.

## Audit and Safety

Every member-management and MCP write produces an `audit_log` entry with:

- the authenticated actor's user ID;
- origin (`member`, `assistant`, or `system`);
- action and affected record type/ID;
- before/after values where appropriate;
- OAuth client ID for assistant actions;
- timestamp.

The database sets the assistant origin from verified server context. Clients cannot choose their own audit origin. Audit entries never contain secrets, invitation tokens, bank credentials, or Plaid access tokens.

Rate limits apply per user and OAuth client to MCP calls and write tools. Input schemas enforce maximum lengths, enums, date bounds, and identifier ownership. Errors returned to clients are useful but generic; server logs contain safe error codes and request IDs only.

## Data Model Changes

- `members.role`: `admin | member | viewer`, default `viewer` for new rows.
- `household_invitations`: pending invitation metadata and hashed token.
- `tips`: assistant/member-authored weekly guidance.
- `assistant_action_log` or additional structured columns on `audit_log` for OAuth client ID and tool name. Prefer extending `audit_log` unless testing exposes an ownership or retention problem.
- Helper functions: `current_member_role()`, `is_admin()`, and role-aware safe write RPCs.
- Assistant views updated only where the weekly review requires data not already exposed.

Migration is backward compatible with existing data. It assigns both current members `admin` before tightening policies, preventing lockout during deployment.

## UI Changes

Settings gains two unframed sections consistent with the existing interface:

- **Household members**: active members, role selector, pending invitations, invite action, resend, and remove.
- **ChatGPT access**: connection status, a short privacy summary, connect instructions, and a link to revoke authorized clients.

Home gains the compact Weekly tips section. No marketing page, chatbot panel, or generalized admin portal is added.

All controls remain mobile-friendly. Destructive removal requires a clear confirmation. Role labels use plain language, and the current user's own role is visible.

## Error Handling

- Duplicate invitation: show the existing pending state and offer resend.
- Existing member invitation: show their current role instead of sending another invite.
- Expired/revoked invitation: reject acceptance and direct the recipient to request a new invitation.
- Last-admin change: reject atomically in the database.
- OAuth denial or expiration: return the standard OAuth error without creating a connection.
- Missing/invalid MCP token: return `401` with protected-resource discovery metadata.
- Insufficient role: return `403` without revealing household data.
- Tool validation error: return a structured, user-correctable error and make no write.
- Partial external failure: invitation creation and email dispatch expose a retryable pending/error state; acceptance remains single-use and idempotent.

## Testing

Database tests will prove:

- viewers cannot write finance data;
- members cannot administer users or integrations;
- admins can invite and manage roles;
- the last admin cannot be removed or demoted;
- unauthorized and removed users cannot read household data;
- assistant views expose no Plaid or service-role secrets;
- assistant writes create the intended tip/task and an audit record;
- invitations are single-use, expiring, and idempotent.

Route/unit tests will prove:

- admin checks occur before Supabase admin APIs are called;
- MCP bearer tokens are required and mapped to active admin members;
- each tool validates input, returns bounded data, and exposes no secret fields;
- write tools set assistant origin and OAuth client ID server-side;
- OAuth/protected-resource metadata is standards-compliant.

Browser tests will cover admin invitation UI, viewer read-only behavior, consent approval/denial, MCP connection, tip creation, and tip display. Production verification will use a test invitation and a real ChatGPT custom connector, while stopping before any unrelated financial changes.

## Rollout

1. Add schema, roles, policies, invitations, tips, and tests.
2. Deploy role-aware application changes and verify Luke/Samantha remain admins.
3. Add and verify invitation UI and acceptance flow.
4. Enable Supabase OAuth 2.1, asymmetric signing, authorization UI, and dynamic registration.
5. Deploy the MCP endpoint and metadata.
6. Connect ChatGPT as Luke, run `review_week`, create one test tip, and verify the audit trail and Home display.
7. Remove the test tip if requested and document the normal weekly workflow.

No new paid service is introduced. Any dashboard option that would add recurring cost requires fresh user approval before activation.

## Acceptance Criteria

- Luke and Samantha are verified administrators after migration.
- An admin can invite, resend, revoke, role-change, and remove users from Settings.
- A viewer can sign in and read but cannot change household finance data.
- A member can edit finances but cannot manage members or ChatGPT access.
- The last administrator cannot be removed or demoted.
- ChatGPT web can authenticate through Supabase OAuth and connect to the private MCP endpoint.
- ChatGPT can read a bounded weekly review and create a tip or suggested task only after user confirmation.
- The app displays the created tip and records the actor, OAuth client, tool, and before/after audit data.
- No OpenAI API call exists in the app.
- No Plaid credentials, Plaid access tokens, Supabase service-role key, Google OAuth secret, bank credentials, or MCP tokens are exposed to clients, tools, logs, or audit data.
- The production application, database policies, automated tests, and real connector flow all verify the feature end to end.
