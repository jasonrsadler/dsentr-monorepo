CI Path Filter Notes

- Purpose: Limit frontend/backend workflows to run only when relevant files change, avoiding unnecessary builds and deploys.
- What changed: Added `paths` filters to `push` and `pull_request` triggers in `frontend-deploy.yml` and `backend-deploy.yml`.
- Behavior:
  - Frontend workflow runs only on changes under `frontend/**` or when the workflow file itself changes.
  - Backend workflow runs only on changes under `backend/**` or when the workflow file itself changes.
  - If both areas change, both workflows run independently.
- Caveats:
  - Edits outside these paths (e.g., `docs/**`, repo root) won’t trigger these workflows. If a shared path is introduced later, include it in both workflows’ `paths`.
  - To force-run after only workflow file edits, the filter includes that workflow file path.

Change reason: Improve CI efficiency and correctness so frontend-only changes do not trigger backend builds/deploys and vice versa; reduce load and noise in pipeline results.
