# dsentr

**dsentr** is a modular no-code automation platform. Users can create powerful workflows using plug-and-play modules connected in a visual editor.

## Features

- 🔌 Pluggable module system
- 🧩 Visual workflow builder
- ⚙️ Execution engine with error handling and retries
- 🧪 Frontend and backend test coverage
- ☁️ Hosted architecture with future support for third-party plugins

---

## Tech Stack

### Frontend

- Vite + React + TypeScript
- Tailwind CSS
- Zustand
- React Hook Form
- React Router v7
- Vitest + React Testing Library
- ESLint + Prettier
- GitHub Actions for CI/CD

### Backend

- Rust (Axum)
- SQLx + PostgreSQL
- Tokio + Tower + Serde
- JWT authentication
- Tracing for logging
- dotenv for configuration

---

## Getting Started

### Prerequisites

- Node.js (>= 18)
- Rust (latest stable)
- PostgreSQL (>= 14)
- Git

---

### Frontend Setup

```bash
cd dsentr-frontend
npm install
cp .env.example .env
npm run dev    # starts the Vite dev server
```

### Backend Setup

```bash
cd dsentr-backend
cp .env.example .env
cargo run       # start backend
```

## Environment Variables
Create `.env` files as needed. Backend expects:
```ini
DATABASE_URL=postgres://user:pass@localhost:5432/dsentr
JWT_SECRET=base64-encoded-48-byte-secret
```

`JWT_SECRET` must be at least 32 bytes of high-entropy data (eight or more
unique bytes). Generate a random secret with `openssl rand -base64 48` or a
similar secure tool.

## Testing
Run tests for frontend:
```bash
npm run test
```
Run backend tests:
```bash
cargo test
```
Coverage (frontend):
```bash
npm run coverage
```

## License
MIT

## 🚀 Feature Roadmap

### MVP
- [x] Monorepo with frontend (Vite + React + Tailwind) and backend (Rust + Axum)
- [x] Basic Vitest + RTL setup with coverage thresholds
- [x] GitHub version control + initial README
- [x] Tailwind base styles and custom theme system
- [x] Workflow Builder UI (drag & drop or sequential layout)
- [x] Core Modules:
  - [x] Webhook Trigger
  - [x] Email Action
- [x] Step-by-step Execution Engine
- ~~[x] JWT-based Auth (login/register)~~
- [x] Session-based Auth (login, registration)
- [x] Workflow persistence in PostgreSQL
- [x] Basic error handling and logs

### Post-MVP
- [x] User dashboard with execution history
- [x] Scheduling + event triggers
- [ ] Plugin registry for 3rd-party modules
- [ ] Module versioning and compatibility checks
- [x] Live collaboration or multi-user workflow editing
- [x] Billing + subscription management
