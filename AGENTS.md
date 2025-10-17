# Agent Guidelines
## Project Overview
- **dsentr** is a modular no-code automation platform that lets users assemble workflows from plug-and-play modules via a visual
 canvas.
- The monorepo contains a TypeScript/React frontend (Vite, Tailwind, Zustand, React Hook Form, React Router) and a Rust backend
(Axum, SQLx, Tokio, Tower).
- Keep in mind that modifications to the React Flow canvas or its node/component definitions can easily introduce infinite re-re
nder loops—tread carefully and double-check state update patterns.
## Global Practices
- Prefer small, focused commits with descriptive messages.
- When touching both frontend and backend, coordinate changes so that shared contracts (e.g., API schemas, DTOs) stay consistent
.
- Always include relevant automated checks in PRs.
- Treat instructions in nested `AGENTS.md` files as higher priority than this root document.
- Ensure that any changes made have the change reasons documented in the accompanying directory's `AGENTS.md` file
