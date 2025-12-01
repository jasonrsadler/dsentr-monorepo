# Agent Guidelines
## Project Overview
- **dsentr** is a modular no-code automation platform that lets users assemble workflows from plug-and-play modules via a visual
 canvas.
- The monorepo contains a TypeScript/React frontend (Vite, Tailwind, Zustand, React Hook Form, React Router) and a Rust backend
(Axum, SQLx, Tokio, Tower).
- Keep in mind that modifications to the React Flow canvas or its node/component definitions can easily introduce infinite re-re
nder loops—tread carefully and double-check state update patterns.
- Another important concept to keep in mind is the level of plans that a user can belong to. 
  - Solo plan: This is a free plan that is restricted and limited. This is basically a plan to allow a user to try out the app and decide if they want to upgrade.
  - Workspace plan: This is the paid plan that has no restrictions and allows other users to join, enjoying the benefits of a workspace plan
  - A user with a solo plan upgrades their plan, their plan becomes a workspace plan
  - When a user with a workspace plan downgrades their plan, their plan becomes a solo plan
  - If a user with a solo plan is invited to join a workspace plan, they keep their solo plan and they can switch back and forth between their personal solo plan and the workspace plan that they joined. The user's solo plan and joined workspace plan are both isolated and do not interact beyond the user being able to switch between their personal solo plan and the joined workspace plan
  - If a user with a workspace plan is invited to join another workspace plan, they keep their workspace plan and they can switch back and forth between their personal workspace plan and the workspace plan that they joined. The user's workspace plan and joined workspace plan are both isolated and do not interact beyond the user being able to switch between their personal workspace plan and the joined workspace plan
  - If a user with a workspace plan has joined one or more other workspace plans, they can still invite members to join their personal workspace plan
  - Whenever a user is no longer part of another joined workspace plan, the user will always retain their personal solo plan or personal workspace plan 
## Global Practices
- Prefer small, focused commits with descriptive messages.
- When touching both frontend and backend, coordinate changes so that shared contracts (e.g., API schemas, DTOs) stay consistent
.
- Always include relevant automated checks in PRs.
- Treat instructions in nested `AGENTS.md` files as higher priority than this root document.
- Ensure that any changes made have the change reasons documented in the accompanying directory's `AGENTS.md` file
- ensure `npm run build` always succeeds after any changes
- ensure `npm t` always succeeds after any changes
- ensure `npm run lint` always succeeds after any changes

## Change Reasons
- Added repository-wide secret handling policy and contributor documentation links so all teams follow consistent vault-based credential management.
- Approved Google Fonts CDN usage, expanded CSP allow lists to enumerate the domains explicitly, and added operations documentation so external dependencies stay compliant with ASVS 14.1.2 and STIG 5.10.
- Added a root README that introduces DSentr and documents local build and development workflows for the API and both React applications.
