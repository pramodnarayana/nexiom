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

## 3. Docker Infrastructure 🐳

We use Docker to replicate the **Production Environment** locally. This ensures "It works on my machine" means it works on Cloud.

### The Stack (docker-compose.yml)
*   **`web`**: Nginx serving the Vite Frontend on `http://localhost:8080`.
*   **`api`**: The NestJS Backend on `http://localhost:3000`.
*   **`postgres`**: Main Database.
*   **`redis`**: Message Queue & Cache.

### How to Run
1.  **Start Everything**:
    ```bash
    docker-compose up --build
    ```
    *Use `--build` to force a re-compile of code changes.*

2.  **View Logs**:
    ```bash
    docker-compose logs -f api  # View Backend logs only
    ```

3.  **Stop & Clean**:
    ```bash
    docker-compose down -v      # -v deletes the Database Volume (Reset Data)
    ```

### Why use this instead of `pnpm dev`?
*   **Production Parity**: It runs the compiled code (`dist/main`), just like AWS.
*   **Network Isolation**: It tests if the API can actually talk to Redis/DB over a network bridge.
### Workflow Selection: Which one do I use?

| Scenario | Command | Why? |
| :--- | :--- | :--- |
| **Writing Code** | `pnpm dev` | **Speed**. Hot Reloading (HMR) updates screen instantly. Debugger works easily. |
| **Before Pushing** | `docker-compose up` | **Safety**. Verifies code works in "Production Mode" (Compiled JS, Nginx, Docker Network). |
| **Database Ops** | `docker-compose up -d postgres redis` | **Hybrid**. Run DB/Redis in Docker, but run API in `pnpm dev` for speed. |

**Summary**:
*   Use `pnpm dev` for **90%** of your day.
*   Use `docker-compose` to **Verify** before you merge to `development`.

