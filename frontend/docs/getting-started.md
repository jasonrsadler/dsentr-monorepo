# Getting Started with DSentr

Use this guide to go from first visit to an active workspace. It walks through account creation, verification, invite handling, and the onboarding wizard that prepares your workspace.

## Create an Account

1. Navigate to **Get Started → Sign Up**. The signup screen accepts first/last name, email, password, and optional company details. Inline validation enforces alphabetic names, standard email formatting, and an 8+ character password with strength feedback before submission.【F:src/Signup.tsx†L37-L87】【F:src/Signup.tsx†L102-L149】
2. Choose a signup method:
   - **Email & password** – Complete the form and submit. DSentr will create the account and send a verification message.
   - **Google or GitHub** – Use the OAuth buttons to authenticate with those providers. OAuth signups skip manual password entry.【F:src/Signup.tsx†L6-L13】【F:src/Signup.tsx†L150-L169】
3. If you arrived via an invitation link, the signup page automatically looks up the token, displays workspace details, and asks whether you want to join that workspace during account creation. Invalid or expired invites are surfaced immediately so you can request a new link.【F:src/Signup.tsx†L39-L106】【F:src/Signup.tsx†L170-L232】

## Verify Your Email

After submitting the signup form, DSentr directs you to the **Check Email** screen and waits for verification. Clicking the link in your inbox calls the `/verify-email` route, which confirms the token and signs you in when successful.【F:src/CheckEmail.tsx†L8-L48】【F:src/VerifyEmail.tsx†L12-L86】

If the verification link expires, return to the login screen and request a fresh message using the resend action.

## Sign In and Handle Invites

1. Visit **/login** and sign in with email/password, Google, or GitHub. A “Remember me” toggle controls whether the session persists across browser restarts.【F:src/Login.tsx†L1-L56】【F:src/Login.tsx†L87-L143】
2. If the URL contains an invite token, the login page preloads the invitation, shows workspace information, and opens a confirmation modal after authentication. You can accept, decline, or leave the invite pending without blocking your own solo workspace access.【F:src/Login.tsx†L19-L54】【F:src/Login.tsx†L97-L195】
3. Declined invites remain visible so you can change your mind, while accepted invites immediately add the workspace to your account context.【F:src/Login.tsx†L143-L195】

## Recover Access

Forgot your password? Use the **Forgot Password** link on the login screen to request a reset email. After receiving the message, follow the `/reset-password/:token` link to set a new password. Both forms validate input and surface errors such as invalid email addresses or expired tokens.【F:src/ForgotPassword.tsx†L9-L116】【F:src/ResetPassword.tsx†L11-L111】

## Complete Workspace Onboarding

First-time users land in the onboarding wizard after verification or login. The wizard pulls personalized context from the API, including recommended plan tiers and any personal workflows you might want to share.【F:src/WorkspaceOnboarding.tsx†L1-L88】

1. **Pick a plan** – Choose between the Solo plan (personal workspace) and the Workspace plan (shared team space). The wizard normalizes backend plan tiers and defaults to the plan associated with your invite or account.【F:src/WorkspaceOnboarding.tsx†L31-L88】【F:src/WorkspaceOnboarding.tsx†L118-L150】
2. **Name your workspace** – For Workspace plans, provide the shared workspace name. DSentr suggests a company-based default when available.【F:src/WorkspaceOnboarding.tsx†L19-L29】【F:src/WorkspaceOnboarding.tsx†L90-L118】
3. **Share starter workflows** – Toggle which of your personal workflows become shared assets in the new workspace. This step is optional for Solo plans.【F:src/WorkspaceOnboarding.tsx†L52-L87】【F:src/WorkspaceOnboarding.tsx†L150-L178】
4. **Submit** – The wizard posts your selections with CSRF protection, creates or updates the workspace, and redirects you into the dashboard once complete.【F:src/WorkspaceOnboarding.tsx†L178-L238】

After onboarding you can immediately switch between your personal Solo workspace and any team workspaces you joined from invitations.
