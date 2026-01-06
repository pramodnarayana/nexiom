# Development Cheatsheet & Workflow

## 1. The "Nexiom Flow" (Git Workflow)

We follow a structured branching model to ensure stability.

### The Branches
*   **`master`**: Production-ready code. **Never push here directly.**
*   **`development`**: The integration branch. All new features land here first.
*   **`feat/name`**: Your working branch (e.g., `feat/auth-system`, `fix/login-bug`).

### The Process
1.  **Start Task**: Create a new branch.
    ```bash
    git checkout -b feat/invite-system
    ```
2.  **Work**: Code, commit, and test.
    ```bash
    git add .
    git commit -m "feat: add invite email template"
    ```
3.  **Merge Request (PR)**: Open a PR from `feat/invite-system` -> `development`.
    *   *CI runs Tests*.
    *   *AI reviews Code*.
4.  **Integration**: Merge into `development`.
5.  **Release**: Periodically merge `development` -> `master` to ship to production.

---

## 2. Common Commands

### Database
*   **Studio (UI)**: `pnpm --filter api db:studio`
*   **Push Schema**: `pnpm --filter api db:push`
*   **Migration**: `pnpm --filter api db:generate`

### Testing
*   **Run All Tests**: `pnpm test`
*   **Coverage Report**: `pnpm test:cov`

### Docker / Deployment
*   **Build Images**: `docker compose build`
*   **Run Locally**: `docker compose up`
