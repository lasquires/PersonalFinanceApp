# Household Access and ChatGPT Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add secure household invitations with admin/member/viewer roles and a private OAuth-protected MCP connector that lets ChatGPT review finances and create audited tips or suggested tasks.

**Architecture:** A new additive Supabase migration makes roles and RLS authoritative, adds invitations/tips, and exposes constrained assistant RPCs. Existing Next.js server routes use the signed-in session for administration, while `/api/mcp` validates Supabase OAuth bearer tokens and executes MCP tools as the authenticated admin. The client adds focused Settings sections and a compact Home tips view.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase Auth/Postgres/RLS, `@modelcontextprotocol/sdk`, Zod 4, Node test runner, PGlite, Playwright, Vercel.

**Spec:** `docs/superpowers/specs/2026-09-22-household-access-chatgpt-design.md`

## Global Constraints

- Keep one household; do not add organizations, tenancy, billing, or public signup.
- Luke and Samantha must remain administrators throughout migration and rollout.
- Default a new invitation to `viewer`; broader roles require an explicit admin choice.
- ChatGPT may read assistant-safe finance data and write tips or `Suggested` tasks only.
- Do not add an in-app GPT chat or any OpenAI API call/key.
- Never expose or log Plaid tokens, Supabase service-role credentials, Google OAuth secrets, bank credentials, invitation tokens, or MCP access/refresh tokens.
- Preserve the $0/month architecture; stop before enabling any paid service.
- Use database policies and server checks for authorization; UI visibility is not a security boundary.
- Follow TDD for every product change and commit after each independently verified task.

## Review Focus

- **Email canonicalization:** `Luke@Example.com` and `luke@example.com` must map to one pending invitation; Task 3 tests trim/lowercase behavior and duplicate handling.
- **Concurrent last-admin changes:** two simultaneous demotion/removal requests must not leave zero admins; Task 1 tests the database lock and invariant.
- **Removed OAuth user:** an access token issued before member removal must immediately fail MCP authorization; Task 6 tests membership on every request.
- **Oversized assistant output:** broad date ranges or large tables must remain bounded; Task 5 tests limits and server-side caps.
- **Retry after partial invitation failure:** a failed email send must leave a retryable record without granting membership; Task 3 tests pending/error/resend behavior.

---

### Task 1: Role-Aware Database Foundation

**Files:**
- Create: `supabase/migrations/002_household_access.sql`
- Modify: `tests/database.test.ts`

**Interfaces:**
- Produces: `public.member_role` enum; `members.email`, `members.role`; `current_member_role()`, `is_admin()`, and `can_write_household()`; role-aware RLS and `household_action` checks.
- Consumes: existing `members`, household tables, `is_member()`, and `household_action(text,jsonb,text)` from migration 001.

- [ ] **Step 1: Write failing role and invariant tests**

Add tests that seed three auth users, insert Luke/Samantha as existing members, apply migration 002, and assert:

```ts
assert.deepEqual(
  (await db.query(`select name,role from public.members order by name`)).rows,
  [{ name: 'Luke', role: 'admin' }, { name: 'Samantha', role: 'admin' }],
);

await db.exec(`set request.jwt.claim.sub='33333333-3333-3333-3333-333333333333'`);
await assert.rejects(
  db.query(`select public.household_action('task',$1,'member')`, [JSON.stringify(task)]),
  /Household write access required/,
);

await db.exec(`set request.jwt.claim.sub='11111111-1111-1111-1111-111111111111'`);
await assert.rejects(
  db.query(`update public.members set role='viewer' where role='admin'`),
  /Household must retain an admin/,
);
```

Also assert a viewer can select `assistant_monthly_budget` but cannot execute `household_action`, while a member can execute it and cannot update `members`.

- [ ] **Step 2: Run the database tests and verify the new tests fail**

Run: `npm test -- --test-name-pattern="role|admin|viewer"`

Expected: FAIL because migration 002 and role helpers do not exist.

- [ ] **Step 3: Add the role migration**

Implement the migration with these exact invariants:

```sql
begin;
create type public.member_role as enum ('admin','member','viewer');
alter table public.members add column email text;
alter table public.members add column role public.member_role not null default 'viewer';
update public.members set role='admin' where name in ('Luke','Samantha');

create function public.current_member_role() returns public.member_role
language sql stable security definer set search_path=''
as $$ select role from public.members where id=auth.uid() $$;

create function public.is_admin() returns boolean language sql stable security definer set search_path=''
as $$ select coalesce(public.current_member_role()='admin',false) $$;

create function public.can_write_household() returns boolean language sql stable security definer set search_path=''
as $$ select coalesce(public.current_member_role() in ('admin','member'),false) $$;

create function private.require_remaining_admin() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op='DELETE' and old.role='admin' then
    perform 1 from public.members where role='admin' for update;
    if (select count(*) from public.members where role='admin' and id<>old.id)=0 then
      raise exception 'Household must retain an admin';
    end if;
  elsif tg_op='UPDATE' and old.role='admin' and new.role<>'admin' then
    perform 1 from public.members where role='admin' for update;
    if (select count(*) from public.members where role='admin' and id<>old.id)=0 then
      raise exception 'Household must retain an admin';
    end if;
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
create trigger retain_admin before update of role or delete on public.members
for each row execute function private.require_remaining_admin();
```

Recreate household read policies with `is_member()`. Keep reads for all roles. Change `household_action` to require `can_write_household()` and ignore any client-supplied `origin` other than `member`; assistant writes will use dedicated functions in Task 5. Grant helper execution only to `authenticated`.

- [ ] **Step 4: Run database and accounting tests**

Run: `npm test`

Expected: all existing tests plus role tests PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/002_household_access.sql tests/database.test.ts
git commit -m "Add household roles and write authorization"
```

### Task 2: Invitation and Tips Schema

**Files:**
- Modify: `supabase/migrations/002_household_access.sql`
- Modify: `tests/database.test.ts`

**Interfaces:**
- Produces: `household_invitations`, `tips`, `server_accept_invitation`, `server_set_member_role`, `server_remove_member`, and role-protected policies.
- Consumes: role helpers from Task 1 and existing audit infrastructure.

- [ ] **Step 1: Write failing invitation/tip database tests**

Cover single-use acceptance, expiration, revoked invitations, viewer read-only tips, member archive permission, admin-only role changes, and the last-admin invariant. Use hashes rather than plaintext tokens:

```ts
const accepted = await db.query<{server_accept_invitation:boolean}>(
  `select public.server_accept_invitation($1,$2,$3)`,
  ['33333333-3333-3333-3333-333333333333','guest@example.com','token-sha256'],
);
assert.equal(accepted.rows[0].server_accept_invitation, true);
const replay = await db.query<{server_accept_invitation:boolean}>(
  `select public.server_accept_invitation($1,$2,$3)`,
  ['33333333-3333-3333-3333-333333333333','guest@example.com','token-sha256'],
);
assert.equal(replay.rows[0].server_accept_invitation, false);
```

- [ ] **Step 2: Run the new tests and verify failure**

Run: `npm test -- --test-name-pattern="invitation|tip"`

Expected: FAIL because the tables/functions are missing.

- [ ] **Step 3: Add invitation and tips objects**

Create:

```sql
create table public.household_invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null check(email=lower(trim(email))),
  role public.member_role not null default 'viewer',
  status text not null default 'pending' check(status in ('pending','accepted','revoked','error')),
  token_hash text not null unique check(length(token_hash)=64),
  invited_by uuid not null references public.members(id),
  expires_at timestamptz not null,
  accepted_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index one_pending_invitation_per_email
on public.household_invitations(email) where status='pending';

create table public.tips (
  id uuid primary key default gen_random_uuid(),
  title text not null check(length(title) between 1 and 120),
  body text not null check(length(body) between 1 and 800),
  evidence jsonb not null default '{}' check(jsonb_typeof(evidence)='object'),
  status text not null default 'active' check(status in ('active','archived','dismissed')),
  expires_at date,
  created_by uuid references public.members(id),
  origin text not null default 'member' check(origin in ('member','assistant')),
  oauth_client_id text,
  tool_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

Admin-only policies expose invitations; member reads expose tips; only admin/member users may archive/dismiss tips. Add audited, service-role-only invitation RPCs and ensure acceptance compares normalized email plus token hash and atomically flips `pending` to `accepted`.

- [ ] **Step 4: Run all tests**

Run: `npm test`

Expected: PASS, including replay/expiration/role tests.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/002_household_access.sql tests/database.test.ts
git commit -m "Add invitations and household tips"
```

### Task 3: Admin Invitation API

**Files:**
- Create: `src/lib/server/household-admin.ts`
- Create: `src/app/api/household/invitations/route.ts`
- Create: `src/app/api/household/invitations/[id]/route.ts`
- Create: `src/app/api/household/members/[id]/route.ts`
- Create: `src/app/invite/accept/route.ts`
- Modify: `src/lib/server/auth.ts`
- Create: `tests/household-admin.test.ts`

**Interfaces:**
- Produces: `requireRole(request, roles)`, `normalizeEmail(email)`, `createInvitation`, `resendInvitation`, `revokeInvitation`, `setMemberRole`, and `removeMember`.
- Consumes: `adminDb()`, Supabase Admin Auth invite API, and Task 2 RPCs/tables.

- [ ] **Step 1: Write failing server-helper tests**

Extract pure validation and injectable dependencies so Node tests do not require live Supabase:

```ts
assert.equal(normalizeEmail('  Luke@Example.COM '), 'luke@example.com');
await assert.rejects(
  createInvitation({ email:'bad', role:'viewer' }, nonAdminContext),
  /Administrator access required/,
);
assert.equal(await createInvitation(
  { email:'guest@example.com', role:'viewer' }, adminContext,
), 'pending');
assert.equal(fakeMailer.calls.length, 1);
```

Test duplicate canonical email, existing member, failed email send -> `error`, and resend -> new token hash/expiry.

- [ ] **Step 2: Run helper tests and verify failure**

Run: `npm test -- --test-name-pattern="invitation API|normalize email"`

Expected: FAIL because the helper module does not exist.

- [ ] **Step 3: Implement role-aware server auth and invitation services**

Change `requireMember` to select `id,name,email,role`, then add:

```ts
export async function requireRole(request: Request, roles: MemberRole[]) {
  const context = await requireMember(request);
  if (!roles.includes(context.member.role)) throw new Error('Administrator access required');
  return context;
}

export const normalizeEmail = (value: string) => value.trim().toLowerCase();
export const hashToken = (value: string) =>
  createHash('sha256').update(value, 'utf8').digest('hex');
```

Generate invitation tokens with `randomBytes(32).toString('base64url')`. Store only `hashToken(token)`. Call `auth.admin.inviteUserByEmail(email, { redirectTo: APP_URL + '/invite/accept?token=' + encodeURIComponent(token) })`. Return stable response shapes without returning the token.

- [ ] **Step 4: Implement routes with Zod validation**

POST `/api/household/invitations` accepts `{email,role}`. PATCH/DELETE routes accept only enum actions. Member mutation accepts `{role}` or DELETE. Map unauthenticated/admin errors to `401/403`, conflicts to `409`, validation to `400`, and provider failures to retryable `503`.

- [ ] **Step 5: Run unit tests and typecheck**

Run: `npm test && npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/auth.ts src/lib/server/household-admin.ts src/app/api/household src/app/invite tests/household-admin.test.ts
git commit -m "Add secure household invitation APIs"
```

### Task 4: Household Administration UI

**Files:**
- Create: `src/components/household-members.tsx`
- Modify: `src/components/settings.tsx`
- Modify: `src/components/finance-app.tsx`
- Modify: `src/lib/store.ts`
- Modify: `src/lib/types.ts`
- Modify: `src/app/globals.css`
- Modify: `e2e/app.spec.ts`

**Interfaces:**
- Produces: `HouseholdMembers` Settings section and role-aware read-only client behavior.
- Consumes: Task 3 JSON APIs and member role from the authenticated snapshot.

- [ ] **Step 1: Write failing Playwright tests**

Extend preview fixtures with an admin, member, viewer, and pending invitation. Assert admins see Invite, role, resend, and remove controls; viewers see no finance mutation controls:

```ts
await page.getByRole('button', { name: /Luke.*Squires household/ }).click();
await expect(page.getByRole('heading', { name: 'Household members' })).toBeVisible();
await page.getByRole('button', { name: 'Invite member' }).click();
await page.getByLabel('Email').fill('guest@example.com');
await page.getByLabel('Access').selectOption('viewer');
await expect(page.getByRole('button', { name: 'Send invitation' })).toBeEnabled();
```

Add a 390x844 assertion that member rows and invite modal do not overflow.

- [ ] **Step 2: Run E2E and verify failure**

Run: `npm run test:e2e -- --grep "Household members"`

Expected: FAIL because the section is absent.

- [ ] **Step 3: Extend client types and snapshot reads**

Add:

```ts
export type MemberRole = 'admin'|'member'|'viewer';
export type Member = { id:string; name:string; email:string|null; role:MemberRole };
export type Invitation = { id:string; email:string; role:MemberRole; status:string; expires_at:string };
export type Tip = { id:string; title:string; body:string; evidence:Record<string,unknown>; status:'active'|'archived'|'dismissed'; expires_at:string|null; origin:'member'|'assistant'; created_at:string };
```

Add `members`, `invitations`, and `tips` to `Snapshot`. Read invitations only for admins; treat `42501` as an empty list for non-admins. Store the current member separately so FinanceApp can suppress `save` for viewers before the RPC still rejects it server-side.

- [ ] **Step 4: Build the focused Settings UI**

Use a table/list with role select and compact icon actions. Default Invite Access to Read-only. Require a confirmation for removal and admin promotion. Disable self-removal and any last-admin action surfaced by API response. Keep Connected accounts unchanged.

- [ ] **Step 5: Run browser, type, and unit tests**

Run: `npm run typecheck && npm test && npm run test:e2e`

Expected: PASS with no desktop/mobile console errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/household-members.tsx src/components/settings.tsx src/components/finance-app.tsx src/lib/store.ts src/lib/types.ts src/app/globals.css e2e/app.spec.ts
git commit -m "Add household member administration"
```

### Task 5: Assistant Read and Write Boundary

**Files:**
- Modify: `supabase/migrations/002_household_access.sql`
- Create: `src/lib/server/assistant.ts`
- Create: `tests/assistant.test.ts`
- Modify: `tests/database.test.ts`

**Interfaces:**
- Produces: `reviewWeek(db, now)`, `listBudgetStatus(db)`, `listRecentTransactions(db,input)`, `listTasks(db,input)`, `listTips(db)`, `createTip(db,input,context)`, `createSuggestedTask(db,input,context)`.
- Consumes: assistant views, tips/tasks tables, authenticated user ID, OAuth client ID.

- [ ] **Step 1: Write failing bounded-output and audited-write tests**

```ts
const recent = await listRecentTransactions(fakeDb, { days: 5000, limit: 5000 });
assert.equal(recent.query.days, 90);
assert.equal(recent.query.limit, 100);

await createTip(fakeDb, {
  title: 'Protect the date budget',
  body: 'You have $24 left this month.',
  evidence: { category: 'Dates', remaining_cents: 2400 },
  expires_at: '2026-10-01',
}, { actorId: LUKE_ID, clientId: 'chatgpt', toolName: 'create_tip' });
assert.equal(fakeDb.lastRpc, 'assistant_create_tip');
assert.equal(fakeDb.lastArgs.oauth_client_id, 'chatgpt');
```

Assert evidence rejects nested arrays, secret-looking keys, more than 20 keys, title >120, body >800, non-Suggested task status, and unknown category/event IDs.

- [ ] **Step 2: Run assistant tests and verify failure**

Run: `npm test -- --test-name-pattern="assistant"`

Expected: FAIL because the assistant service/RPCs are absent.

- [ ] **Step 3: Add constrained assistant RPCs**

Add `assistant_create_tip(payload jsonb, oauth_client_id text)` and `assistant_create_suggested_task(payload jsonb, oauth_client_id text)`. Both require `is_admin()`, derive actor from `auth.uid()`, force origin `assistant`, validate IDs, set `app.origin`, insert the record, and write `oauth_client_id` plus `tool_name` into the audit record. Revoke public access and grant only `authenticated`.

- [ ] **Step 4: Implement Zod schemas and service functions**

Cap transactions to `days <= 90` and `limit <= 100`; tasks/tips to 100 rows; weekly review to seven spending days and 90 event days. Select explicit columns from assistant views. Never use `select('*')` in assistant code.

- [ ] **Step 5: Run all tests**

Run: `npm test && npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/002_household_access.sql src/lib/server/assistant.ts tests/assistant.test.ts tests/database.test.ts
git commit -m "Add constrained assistant data boundary"
```

### Task 6: OAuth-Protected MCP Server

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/lib/server/oauth.ts`
- Create: `src/lib/server/mcp-tools.ts`
- Create: `src/app/api/mcp/route.ts`
- Create: `src/app/.well-known/oauth-protected-resource/route.ts`
- Modify: `src/proxy.ts`
- Create: `tests/oauth.test.ts`
- Create: `tests/mcp.test.ts`

**Interfaces:**
- Produces: `authenticateBearer(request): Promise<AssistantContext>`; MCP POST endpoint; protected resource metadata; seven MCP tools.
- Consumes: Task 5 assistant service functions and Supabase OAuth JWTs.

- [ ] **Step 1: Install the MCP SDK**

Run: `npm install @modelcontextprotocol/sdk`

Expected: package and lockfile include the SDK; no unrelated dependency upgrades.

- [ ] **Step 2: Write failing OAuth tests**

Test missing/malformed bearer -> `401`, valid token for admin -> context, valid token for viewer -> `403`, and token for a member removed after issuance -> `403` on the next request. Mock `auth.getUser(token)` and the membership query independently.

```ts
await assert.rejects(authenticateBearer(requestWith(token), removedMemberDeps), /Administrator access required/);
assert.deepEqual(protectedResourceMetadata(APP_URL, SUPABASE_URL), {
  resource: `${APP_URL}/api/mcp`,
  authorization_servers: [`${SUPABASE_URL}/auth/v1`],
  bearer_methods_supported: ['header'],
});
```

- [ ] **Step 3: Write failing MCP protocol/tool tests**

Send MCP `initialize`, `tools/list`, and `tools/call` JSON-RPC requests. Assert tool list is exact, read outputs are bounded, writes call Task 5 services, malformed arguments return tool errors, and no output contains `access_token`, `service_role`, `plaid`, or bearer token values.

- [ ] **Step 4: Implement bearer authentication and metadata**

Use a Supabase client configured with the publishable key and no persisted session. Pass the bearer token directly to `auth.getUser(token)`, then query `members(id,name,email,role)` with the token-authenticated client and require `role='admin'`. Extract the verified `client_id` claim from `auth.getClaims(token)`; reject if absent.

The metadata route returns `application/json` and points to `https://tcrbcqrsafuckhsknfoy.supabase.co/auth/v1`. A `401` response includes:

```http
WWW-Authenticate: Bearer resource_metadata="https://squires-family-finance.vercel.app/.well-known/oauth-protected-resource"
```

- [ ] **Step 5: Implement a stateless Streamable HTTP MCP route**

Register only:

```ts
const toolNames = [
  'review_week', 'list_budget_status', 'list_recent_transactions',
  'list_tasks', 'list_tips', 'create_tip', 'create_task',
] as const;
```

Descriptions for `create_tip` and `create_task` must begin with `Creates` and state that the action writes to the household app. Use strict Zod input schemas and the authenticated context from Step 4. Support POST for MCP messages; return `405` for unsupported methods unless required by the SDK transport.

- [ ] **Step 6: Exclude MCP discovery from cookie-session proxy work**

Update the proxy matcher to exclude `api/mcp` and `.well-known/oauth-protected-resource`; bearer auth remains entirely in the route.

- [ ] **Step 7: Run unit, type, and production build checks**

Run: `npm test && npm run typecheck && npm run build`

Expected: PASS; build lists `/api/mcp` and `/.well-known/oauth-protected-resource`.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json src/lib/server/oauth.ts src/lib/server/mcp-tools.ts src/app/api/mcp src/app/.well-known src/proxy.ts tests/oauth.test.ts tests/mcp.test.ts
git commit -m "Add OAuth-protected finance MCP server"
```

### Task 7: OAuth Authorization and Consent UI

**Files:**
- Create: `src/app/authorize/page.tsx`
- Create: `src/components/oauth-consent.tsx`
- Create: `src/lib/oauth-consent.ts`
- Modify: `src/app/globals.css`
- Create: `tests/oauth-consent.test.ts`
- Modify: `e2e/app.spec.ts`

**Interfaces:**
- Produces: branded `/authorize` page that calls Supabase `oauth.getAuthorizationDetails`, `approveAuthorization`, and `denyAuthorization`.
- Consumes: existing Supabase browser session and OAuth request query parameters.

- [ ] **Step 1: Write failing consent-state tests**

Test signed-out -> return URL preserving the OAuth request, non-admin -> denial screen, malformed/expired request -> safe error, valid admin -> client name plus Approve/Deny. Ensure the renderer never prints client secrets, access tokens, or raw query contents.

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- --test-name-pattern="OAuth consent"`

Expected: FAIL because consent helpers are absent.

- [ ] **Step 3: Implement authorization details and decisions**

Use the current `supabase-js` OAuth Server APIs. Load authorization details, require a signed-in admin member, show the verified client name and requested scopes, then call the SDK approval/denial methods. Keep the decision buttons as explicit commands; no auto-approval.

- [ ] **Step 4: Add browser tests**

Mock the OAuth SDK boundary and assert Approve redirects to the supplied verified redirect URL, Deny returns an OAuth denial, and the page remains usable at 390x844 without overflow.

- [ ] **Step 5: Run all tests**

Run: `npm test && npm run typecheck && npm run test:e2e`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/authorize src/components/oauth-consent.tsx src/lib/oauth-consent.ts src/app/globals.css tests/oauth-consent.test.ts e2e/app.spec.ts
git commit -m "Add OAuth consent flow for ChatGPT"
```

### Task 8: Weekly Tips UI and Connector Guidance

**Files:**
- Create: `src/components/weekly-tips.tsx`
- Modify: `src/components/home.tsx`
- Modify: `src/components/settings.tsx`
- Modify: `src/lib/store.ts`
- Modify: `src/app/globals.css`
- Modify: `e2e/app.spec.ts`

**Interfaces:**
- Produces: Home Weekly tips section; Settings ChatGPT access section; member/admin archive/dismiss actions.
- Consumes: `Snapshot.tips`, `household_action` or dedicated tip-status RPC, and OAuth/MCP production URL.

- [ ] **Step 1: Write failing Home and Settings browser tests**

```ts
await expect(page.getByRole('heading', { name: 'Weekly tips' })).toBeVisible();
await expect(page.getByText('Protect the date budget')).toBeVisible();
await page.getByRole('button', { name: 'Dismiss Protect the date budget' }).click();
await expect(page.getByText('Protect the date budget')).toBeHidden();

await page.getByRole('button', { name: /Squires household/ }).click();
await expect(page.getByRole('heading', { name: 'ChatGPT access' })).toBeVisible();
await expect(page.getByText('/api/mcp')).toBeVisible();
```

- [ ] **Step 2: Run E2E and verify failure**

Run: `npm run test:e2e -- --grep "Weekly tips|ChatGPT access"`

Expected: FAIL.

- [ ] **Step 3: Build the tips and connector sections**

Show up to three active, unexpired tips sorted newest first. Display title, body, source (`ChatGPT` for assistant origin), and date. Members/admins get dismiss controls; viewers do not. Settings explains that ChatGPT can review and create tips/tasks but cannot move money or access bank credentials, and shows the MCP URL in a read-only field.

- [ ] **Step 4: Run full browser and type verification**

Run: `npm run typecheck && npm run test:e2e`

Expected: PASS at desktop and phone viewports with no console errors or horizontal overflow.

- [ ] **Step 5: Commit**

```bash
git add src/components/weekly-tips.tsx src/components/home.tsx src/components/settings.tsx src/lib/store.ts src/app/globals.css e2e/app.spec.ts
git commit -m "Show ChatGPT tips and connection guidance"
```

### Task 9: Production Migration and OAuth Configuration

**Files:**
- Modify: `README.md`
- Create: `docs/chatgpt-connection.md`

**Interfaces:**
- Produces: live role/invitation/tips schema, enabled Supabase OAuth server, asymmetric signing, dynamic registration, `/authorize` configuration, and operator instructions.
- Consumes: verified Tasks 1-8 application build.

- [ ] **Step 1: Capture a pre-migration production check**

Verify current members and migration state in Supabase without displaying secrets. Confirm exactly Luke and Samantha exist before applying migration 002.

- [ ] **Step 2: Apply migration 002 transactionally**

Run it in Supabase SQL Editor. Verify both existing users are `admin`, role policies exist, and no household row count changes unexpectedly. Abort deployment if either current user is missing or non-admin.

- [ ] **Step 3: Deploy the application and verify routes**

Run: `npx vercel@latest --prod --yes`

Expected: READY and aliased to `https://squires-family-finance.vercel.app`; `/api/mcp`, `/authorize`, and protected-resource metadata appear in the build route list.

- [ ] **Step 4: Enable Supabase OAuth 2.1 securely**

In Supabase Authentication:

1. migrate JWT signing to an asymmetric key supported by OAuth;
2. enable OAuth 2.1 Server;
3. set authorization path to `https://squires-family-finance.vercel.app/authorize`;
4. enable dynamic client registration with mandatory user consent;
5. keep all existing Google login URLs intact.

Each persistent-access/dashboard save requires action-time user confirmation. Do not enable a paid option.

- [ ] **Step 5: Verify discovery and authorization without secrets**

Fetch Supabase OAuth discovery, application protected-resource metadata, and MCP unauthenticated response. Assert HTTPS endpoints, PKCE support, and a correct `WWW-Authenticate` challenge. Sign in as Luke and verify the consent page names the requesting client and requires a click.

- [ ] **Step 6: Document the normal connection workflow**

Write `docs/chatgpt-connection.md` with the production MCP URL, who may authorize, available tools, revocation steps, and the rule that ChatGPT writes only tips/suggested tasks after confirmation. Do not include keys or tokens.

- [ ] **Step 7: Commit operator documentation**

```bash
git add README.md docs/chatgpt-connection.md
git commit -m "Document private ChatGPT connection"
git push
```

### Task 10: End-to-End Acceptance and Production Proof

**Files:**
- Modify: `e2e/app.spec.ts` only if a verified production gap requires a regression test.

**Interfaces:**
- Produces: authoritative acceptance evidence for invitations, roles, MCP, tips, audit, and secret isolation.
- Consumes: production app and Supabase configuration from Task 9.

- [ ] **Step 1: Run the complete automated suite from a clean state**

Run:

```bash
npm test
npm run typecheck
npm run build
npm run test:e2e
git status --short
```

Expected: all pass; worktree clean except intentional documentation evidence, if any.

- [ ] **Step 2: Verify an invitation safely**

Invite a user-selected test email as `viewer`, complete sign-in with the user, prove finance data is visible, and prove mutation APIs return `403`. Promote to `member`, prove a task can be edited, and prove member administration still returns `403`. Remove the test member and prove access stops immediately.

- [ ] **Step 3: Connect ChatGPT web through the MCP URL**

Add the private connector in ChatGPT, authenticate as Luke through Supabase OAuth, inspect the consent page, and approve only after action-time user confirmation. Do not paste or reveal OAuth tokens.

- [ ] **Step 4: Run the weekly review and one confirmed write**

Call `review_week`, inspect the bounded response, then ask ChatGPT to create one clearly labeled test tip. Confirm the ChatGPT write action, verify the tip appears on Home, and verify the audit row contains Luke's actor ID, assistant origin, OAuth client ID, tool name, and no secrets.

- [ ] **Step 5: Verify revocation**

Revoke the connector from Supabase OAuth Apps/authorizations and prove the next MCP request fails. Reconnect only if the user wants the connector left active.

- [ ] **Step 6: Run a completion audit against the specification**

Check every acceptance criterion in `docs/superpowers/specs/2026-09-22-household-access-chatgpt-design.md` against database state, live UI, route responses, tests, and audit evidence. Record any unmet criterion as unfinished work; do not mark the goal complete until all are proven.

- [ ] **Step 7: Final commit and push if acceptance produced fixes**

```bash
git add e2e/app.spec.ts
git commit -m "Fix production acceptance findings"
git push
```

Skip this commit only when Task 10 required no source changes and `git status --short` is clean.
