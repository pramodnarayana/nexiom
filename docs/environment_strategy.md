# Environment Strategy: The "Config Hierarchy" 🔐

This document explains how we manage secrets and configuration across our 4 environments.

## The Golden Rule (12-Factor App)
**Code is the same. Config is different.**
We never build secrets into the Docker Image. We "inject" them at runtime.

---

## 1. Local Development (`pnpm dev`)
*   **Goal**: Speed & Convenience.
*   **Source**: `.env` file.
*   **Location**: `apps/api/.env`.
*   **Network**: Everything runs on `localhost`.

| Variable | Value | Why? |
| :--- | :--- | :--- |
| `DATABASE_URL` | `postgres://localhost:5432...` | Direct connection to DB. |
| `BETTER_AUTH_URL` | `http://localhost:3000` | Frontend talks to API on port 3000. |

---

## 2. Local Production (`docker-compose`)
*   **Goal**: Simulation of AWS networking.
*   **Source**: `.env` (Base) + `docker-compose.yml` (Overrides).
*   **Why Override?**:
    *   We want to reuse your Google Keys from `.env` (Don't repeat secrets!).
    *   BUT, the networking is different. Docker needs `http://localhost:3001` (Host) and internal Container IPs.

| Variable | Value | Source |
| :--- | :--- | :--- |
| `GOOGLE_SECRET` | `xxxx` | **Loaded from `.env`** (Reused) |
| `BETTER_AUTH_URL` | `http://localhost:3001` | **Overridden in `yaml`** (Docker specific) |

---

## 3. AWS Environments (Test & Prod)
*   **Goal**: Security & Zero-Trust.
*   **Source**: AWS Secrets Manager / Parameter Store.
*   **Mechanism**: ECS (Fargate) injects them as Environment Variables when the container starts.
*   **NO `.env` Files**: We do not copy `.env` files to AWS.

### Production Hierarchy
1.  **AWS Parameter Store**: Holds `DATABASE_URL`, `REDIS_URL`.
2.  **AWS Secrets Manager**: Holds `GOOGLE_CLIENT_SECRET`, `STRIPE_KEY`.
3.  **ECS Task Definition**: Maps these secrets to the container.

---

## Is there a "Better Way" for Local Docker?

You asked if using Overrides is the best way.

### Option A: The "Override" Pattern (Current) ✅
*   **Pros**: DRY (Don't Repeat Yourself). You only manage ONE `.env` file.
*   **Cons**: `docker-compose.yml` looks a bit messy with explicit overrides.
*   **Verdict**: Best for solo devs and small teams.

### Option B: The "Dual File" Pattern (`.env.docker`)
You create a separate file `apps/api/.env.docker`.
*   **Pros**: Explicit separation. No overrides in YAML.
*   **Cons**: **Drift**. You add a Google Key to `.env` but forget to add it to `.env.docker`. Your Docker build breaks.
*   **Verdict**: High maintenance. Not recommended unless necessary.

### Option C: The "Script" Pattern
A startup script generates the `.env` on the fly.
*   **Pros**: Flexible.
*   **Cons**: Complexity. "It works on my machine" issues.

---

## 4. Common Myth: "Is `localhost` baked into my Image?" 🚫

**NO.** This is the most important concept to understand.

### Build Time (The Image)
When you run `docker build`, we create the **Code Artifact**.
*   It contains: `dist/main.js`, `node_modules`, `package.json`.
*   It contains **ZERO CONFIG**.
*   `process.env.BETTER_AUTH_URL` is `undefined`.

### Runtime (The Container)
Configuration is injected **only when the container starts**.

| Environment | Who injects it? | Value Injected |
| :--- | :--- | :--- |
| **Local Docker** | `docker-compose.yml` | `http://localhost:3001` |
| **AWS Prod** | **AWS ECS Service** | `https://api.nexiom.com` |

**Conclusion:**
You can deploy the **EXACT SAME IMAGE** to both your laptop and AWS.
Your `docker-compose.yml` (with the localhost values) **STAYS on your laptop**. It is never sent to AWS.


---

## 5. Appendix: The Frontend "Client-Side" Trap 🕸️

You asked: *"Is there any other way than window.location.origin?"*

The Frontend is different because it runs in the **User's Browser**, not inside Docker.
The Browser **cannot** see your Server's Environment Variables.

### Strategy 1: Build-Time Baking (Hardcoded)
*   **How**: `VITE_API_URL=http://localhost:3000 pnpm build`
*   **Result**: The text `http://localhost:3000` is written into the JS file.
*   **Pros**: Simple.
*   **Cons**: **Not Portable**. You need a different Docker Image for Dev, Staging, and Prod.

### Strategy 2: Dynamic Resolution (Current Choice) ✅
*   **How**: `const url = window.location.origin + "/api"`
*   **Result**: "Use the API on the same domain as the website".
*   **Pros**: **Portable**. One Docker Image works everywhere (if using Nginx Proxy).
*   **Cons**: Relies on the "Reverse Proxy" pattern.

### Strategy 3: Runtime Injection (The "Enterprise" Way)
*   **How**:
    1.  Create an empty file `public/config.js`.
    2.  When Docker starts, a script **overwrites** this file: `window.ENV = { API_URL: "https://..." }`.
    3.  React reads `window.ENV.API_URL`.
*   **Pros**: Explicit. You can inject ANY variable at runtime.
*   **Cons**: **High Complexity**. Requires startup scripts and blocking the app until config loads.

**Recommendation**: Stick with **Strategy 2**. It is the standard for Modern Web Apps.
