# Dsentr Admin Frontend

This directory contains the administrative frontend for Dsentr. It provides internal tools for managing workspaces, users, billing, integrations, run activity, and platform-level configuration.

The admin interface is not part of the public user application. It interacts with the same backend API but exposes administrative routes and controls used for operations and support.

## Features

- Workspace and user management views
- Billing and subscription inspection
- Integration and OAuth connection overview
- Run inspection and workflow metadata
- System configuration and diagnostics
- Session-based authentication through the backend

## Tech Stack

- Vite + React + TypeScript
- Tailwind CSS
- Zustand
- React Router v7
- React Hook Form
- Vitest and React Testing Library
- ESLint and Prettier

## Setup

```
npm install
cp .env.example .env
npm run dev
```

The `.env` file defines the API base URL and admin-specific settings.

## Environment Variables

Typical values:

```
VITE_API_BASE_URL=http://localhost:3000
VITE_ADMIN_APP_NAME=Dsentr Admin
```

## Authentication

The admin client uses the same session-based authentication as the primary frontend. Sessions are managed by the backend and stored in the database.

## Testing

```
npm run test
npm run coverage
```

## Structure

- `src/pages` admin views
- `src/components` shared UI pieces
- `src/stores` Zustand stores
- `src/lib` API wrappers and helpers
- `public/` static assets

## License

MIT. See `LICENSE` in this directory.
