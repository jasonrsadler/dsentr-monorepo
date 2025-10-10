# Frontend Agent Notes

## Context
- The frontend is built with Vite + React + TypeScript, using Tailwind CSS, Zustand for state, and a React Flow-powered visual a
utomation canvas.
- Many components are memoized and rely on stable references; inadvertent prop or context changes can trigger runaway re-render
loops, especially in the React Flow canvas.

## Required Practices
- Always run `npm run lint` and `npm test` before submitting frontend changes. Keep in mind that linting and tests take quite a
few moments so patience is required for them to finish
- When altering canvas nodes, edges, or shared hooks, audit for dependency cycles and ensure state setters are wrapped (e.g., `u
seCallback`, `useMemo`) to prevent infinite renders.
- Follow the established ESLint + Prettier formatting rules; avoid disabling lint rules unless necessary and documented.
