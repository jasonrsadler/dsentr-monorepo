# Current Slack OAuth Behavior in Dsentr

## Purpose

This document describes the current state of Slack OAuth in Dsentr prior to the workspace-first refactor. It captures existing flows, storage patterns, execution behavior, and legacy semantics that conflict with the intended workspace-first Slack model.

This is reference documentation only. No changes are proposed here.

---

## Overview

Dsentr currently supports Slack OAuth using a mix of personal tokens, workspace connections, promotion flows, and incoming webhook shortcuts. Over time, Slack behavior diverged from other providers due to legacy webhook support and implicit identity inference.

As a result:
- Identity is inferred instead of explicitly selected
- Workspace and personal tokens can overwrite each other
- Webhooks can bypass OAuth identity rules
- Slack team identity is stored but not enforced

These behaviors conflict with the workspace-first Slack goals.

---

## Slack OAuth Flows

### Workspace Slack Install (Current)

1. User initiates OAuth via  
   /api/oauth/slack/start?workspace={workspace_id}

2. Backend redirects to Slack OAuth with bot and user scopes.

3. Slack redirects to callback with authorization code.

4. Backend exchanges code using:
   - oauth.v2.access
   - users.info

5. A personal OAuth token is first persisted, containing:
   - encrypted access token
   - encrypted refresh token
   - metadata including:
     - Slack team.id
     - bot_user_id
     - incoming_webhook_url

6. User may then explicitly promote this connection:
   - Promotion inserts a workspace connection
   - Workspace connection copies tokens and webhook metadata
   - Personal token is marked shared
   - Webhook metadata is cleared from the personal token

Notes:
- Promotion exists but is effectively dead code in several paths
- Workspace install is not strictly enforced as the first step

---

### Personal Slack Authorization (Current)

1. User initiates OAuth via  
   /api/oauth/slack/start (no workspace parameter)

2. OAuth exchange occurs as above.

3. Token is stored as a personal OAuth token.

4. Deduplication behavior:
   - First matches on provider_user_id
   - Falls back to normalized email
   - If multiple matches exist, the most recently updated token is used

5. If a workspace connection exists, refreshed tokens may propagate to it.

---

## Token Storage

### Personal Tokens

Stored in user_oauth_tokens.

Fields:
- encrypted access token
- encrypted refresh token
- expires_at
- account_email
- metadata (encrypted JSON):
  - slack team.id
  - bot_user_id
  - incoming_webhook_url
- is_shared flag

Personal tokens may be updated or deleted independently of workspace connections.

---

### Workspace Connections

Stored in workspace_connections.

Fields:
- encrypted access token
- encrypted refresh token
- expires_at
- account_email
- slack_team_id
- bot_user_id
- incoming_webhook_url

Workspace connections may exist without a corresponding personal token if the personal token is deleted.

---

## Execution Behavior

### Post as Workspace Bot

- Engine resolves workspace scope
- Workspace token is refreshed if expiring
- If incoming_webhook_url exists:
  - Message is sent via webhook
- Otherwise:
  - Message is sent via chat.postMessage using OAuth access token

Webhook presence implicitly overrides OAuth without user choice.

---

### Post as User

- Engine requires a personal connection id
- Access token is fetched via OAuthAccountService
- Message is sent via chat.postMessage

If UI allows postAsUser without selecting a personal connection, execution fails at runtime.

---

## Channel Listing

- Slack channels API only supports workspace scope
- Personal scope is always rejected
- UI may still attempt personal channel listing, causing errors

---

## Disconnect and Reconnect

### Disconnect Personal Token

- Deletes personal OAuth token
- Revokes provider tokens
- Does not automatically remove workspace connections

### Reconnect

- OAuth dedupe updates existing personal token
- If a workspace connection exists:
  - Tokens may propagate to it
  - No team.id enforcement occurs

---

## Legacy Behaviors Identified

The following behaviors conflict with a workspace-first Slack model:

- Personal → workspace promotion flow
- Incoming webhook short-circuiting OAuth execution
- Email-based deduplication fallback
- Implicit identity inference in execution
- Manual Slack token entry in UI
- Cross-team token reuse without validation
- UI allowing postAsUser without personal selection
- Disconnect relying on client-side cleanup

---

## Summary

Slack OAuth currently behaves differently from other providers due to accumulated legacy paths and implicit assumptions. Identity selection, team enforcement, and execution semantics are not explicit, leading to ambiguity and unsafe behavior.

This document establishes the baseline required to refactor Slack into a strict, workspace-first, explicit-identity model.
