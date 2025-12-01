# DSentr

DSentr is a modular no-code automation platform where teams assemble workflows from plug-and-play modules on a visual canvas. This monorepo houses the Rust API/worker, the customer-facing React app, and an internal admin console.

## Repository Layout
- `backend/` - Axum-based API and worker runtime backed by SQLx/PostgreSQL and Tokio.
- `frontend/` - Customer UI built with Vite + React, Tailwind, Zustand, React Hook Form, and React Router.
- `frontend-admin/` - Admin and support console built with Vite + React (server listens on port 4173 during dev).
- `docs/` - Security, operations, and release documentation (see `docs/README.md`).

## Prerequisites
- Node.js 20+ and npm 10+ (install packages from each project directory; there is no root workspace).
- Rust stable toolchain (edition 2021) and Cargo.
- PostgreSQL 14+ reachable via `DATABASE_URL`.
- Optional: `sqlx-cli` for database creation and migrations (`cargo install sqlx-cli --no-default-features --features rustls,postgres`).
- OpenSSL (or similar) to generate secrets referenced in the `.env` files.

## Environment Setup
1. Backend: copy `backend/.env.template` to `backend/.env` and replace `CHANGEME_...` placeholders with vault-issued values per `SECURITY.md`. Point `DATABASE_URL` at your local Postgres instance and set `FRONTEND_ORIGIN` to the dev frontend origin (`http://localhost:5173` or `https://localhost:5173` if you have local certs).
2. Frontend app: create/update `frontend/.env` with non-sensitive `VITE_` variables (see `docs/README.md` for the public env whitelist process). Example:
   ```bash
   VITE_API_BASE_URL=http://localhost:3000
   VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...
   ```
3. Admin console: set `frontend-admin/.env` (default) to:
   ```bash
   VITE_API_BASE_URL=http://localhost:3000
   ```
4. Start PostgreSQL and create the database referenced by `DATABASE_URL` (for example, `createdb dsentr_dev`).

## Database Migrations
With `DATABASE_URL` exported or present in `backend/.env`:
```bash
cd backend
sqlx database create           # if the database does not yet exist
sqlx migrate run               # applies files in backend/migrations
```
If you prefer not to install `sqlx-cli`, use `cargo sqlx database setup` with the same connection string.

## Running Locally
- Backend API/worker (port 3000):
  ```bash
  cd backend
  cargo run          # use `cargo watch -x run` for live reload
  ```
- Frontend app (Vite, defaults to 5173 and enables HTTPS when local certs are present in ../certs):
  ```bash
  cd frontend
  npm install
  npm run dev
  ```
- Admin console (Vite on port 4173):
  ```bash
  cd frontend-admin
  npm install
  npm run dev
  ```

Visit the frontend at `http(s)://localhost:5173` and the admin console at `http://localhost:4173`. Both target the API at `http://localhost:3000`.

## Building for Production
- Frontend app:
  ```bash
  cd frontend
  npm run build
  ```
- Admin console:
  ```bash
  cd frontend-admin
  npm run build
  ```
- Backend:
  ```bash
  cd backend
  cargo build --release
  ```

## Tests and Quality Checks
- Frontend: `npm test`, `npm run lint`, `npm run build`.
- Admin console: `npm run lint`, `npm run build` (tests are not yet implemented).
- Backend: `cargo fmt`, `SQLX_OFFLINE=true cargo clippy --all-targets --all-features`, `SQLX_OFFLINE=true cargo test`.

Ensure these checks and the GitHub workflows pass before opening pull requests.

## Additional References
- Secret handling and credential management: `SECURITY.md` and `docs/README.md`.
- Workflow-specific manual QA guidance: `TESTING.md`.
- Operations, security, and migration notes: files under `docs/` and `backend/docs/`.
