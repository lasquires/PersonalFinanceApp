# Private ChatGPT Connection

The production MCP address is:

`https://squires-family-finance.vercel.app/api/mcp`

## Connect once

1. A Squires household administrator adds the MCP address as a custom ChatGPT app.
2. Sign in through the Squires Family Finance authorization page.
3. Review the verified client name and requested access, then approve once.
4. ChatGPT keeps the OAuth grant until it is revoked or expires. The finance app does not ask for a new weekly approval.

Only current household administrators may authorize the connector. Removing or demoting the administrator blocks the next MCP request immediately.

## Available actions

- Review the previous seven days and upcoming 90-day plan.
- List current budget status, recent transactions, tasks, and tips.
- Create a finance tip.
- Create a task in `Suggested` status.

The connector cannot move money, initiate transfers, read Plaid credentials, or retrieve Supabase service keys. Reads are bounded and writes are attributed to the signed-in administrator, OAuth client, and tool in the audit log.

ChatGPT controls its own confirmation prompts for write actions. The MCP server labels writes honestly and does not add a second approval step. For unattended weekly runs, use a scheduled ChatGPT Workspace Agent with this app connected and configure its action constraints according to the workspace's policy.

## Suggested weekly schedule

Run once each week:

> Review the Squires household's last seven days, current category balances, active tasks, and upcoming 90-day events. Post up to three concise tips supported by exact app data. Create suggested tasks only when a clear follow-up is needed. Never move money or invent amounts.

## Revoke access

Revoke the grant in Supabase Authentication under OAuth authorizations/apps. The next MCP request must fail. The app can be reconnected later through the same one-time consent flow.
