# Database Strategy: The Migration Guide 🐘

This document explains how we manage database schema changes safely across environments (Local, Docker, AWS Prod).

## 1. The Lifecycle: From Code to Database 🔄

You asked: *"We have the SQL query in the code... So we use that?"*

Here is the exact flow:

1.  **The Source (TypeScript)**
    *   You write: `export const users = pgTable(...)` in `src/schema/users.ts`.
    *   *This is just a definition. It does nothing yet.*

2.  **The Artifact (SQL File)** (`db:generate`)
    *   We run a command. It looks at your TypeScript.
    *   It creates a file: `drizzle/0000_init.sql`.
    *   Content: `CREATE TABLE IF NOT EXISTS "users" (...);`
    *   *Now we have the SQL query in a file.*

3.  **The Action (`db:migrate`)**
    *   We decide what to do with that SQL file.

---

## 2. Scenarios: "How will it work in Case X?"

This is how we handle the "Action" step in different situations.

### Case A: Brand New Database (Local Docker) ✨
*   **State**: Empty.
*   **Action**: **RUN** the SQL file.
*   **Result**: Tables created.

### Case B: Existing Production Data (Baselining) ⚠️
*   **State**: Your AWS DB *already* has the `users` table (because you created it manually or via `db:push` previously).
*   **Problem**: If we run `CREATE TABLE users`, it might error or duplicate.
*   **Action**: **FAKE** the SQL run (`--fake`).
    *   We tell the DB: *"Trust me, you already have this schema. Just mark 0000 as Done in your history."*
    *   We do **NOT** execute the SQL query.
*   **Result**: DB history is synced. Data is safe. Future migrations (0001) will run normally.


### Case B: Ongoing Development (e.g., Adding a Feature) 🚀
**Situation**: Prod has Users. You added a `phone_number` field locally.
**Workflow**:
1.  Local: You run `db:generate`. It creates `0002_add_phone.sql`.
2.  Review: You verify the SQL is `ALTER TABLE users ADD COLUMN phone...`.
3.  Deploy: Push code to AWS.
4.  Prod DB: Checks `drizzle_migrations`. "I have done 0001. I need 0002."
5.  **Action**: Runs `0002_add_phone.sql`.
6.  **Result**: Users kept their data. New column added.

### Case C: "I already have Prod Data, but no Migrations" (Baselining) ⚠️
**Situation**: You hacked together a Prod DB using `db:push` or raw SQL, and now you want to switch to "Proper Migrations".
**Problem**: If you run `0001_create_users.sql`, it will fail because "Table users already exists".
**The Solution: Baselining**.
1.  Generate `0000_initial.sql` (matches current Prod).
2.  **Tell Drizzle it's already done**:
    *   Command: `drizzle-kit migrate --fake` (or manually insert into `drizzle_migrations` table).
    *   This tells the DB: "Pretend you ran script 0000".
3.  Now you are synced. Future changes (0001, 0002) will apply normally.

---

## 3. Our Plan for Nexiom 🗺️

1.  **Local Docker (Now)**:
    *   It is empty.
    *   We will generate `0000_init.sql`.
    *   We will run `db:migrate`.
    *   Result: Tables created safely.

2.  **Future AWS Prod**:
    *   We will configure our CI/CD (GitHub Actions) to run `db:migrate` on deployment.
    *   It will automatically track history.

## 4. Enforcement: Preventing "Hacks" 🛡️

You asked: *"How can we enforce production standards?"*

We have implemented 3 Layers of Defense:

### Layer 1: The "Scary Name" (Active)
*   We renamed `db:push` to `db:push:unsafe` in `package.json`.
*   **Effect**: Developers cannot accidentally run it. They must explicitly type "unsafe".

### Layer 2: Drift Detection (CI/CD)
*   We will add `drizzle-kit check` to our GitHub Actions.
*   **Effect**: If a developer changes `users.ts` but forgets to run `db:generate`, the Build Fails.

### Layer 3: Code Review Policy
*   Rule: "Any PR that changes `src/schema` MUST include a corresponding `.sql` file in `drizzle/`."
*   **Effect**: Humans verify the history.

---

## 5. The Network View: "Where does the data go?" 🌐

You asked: *"Are we connecting from our local Mac to the DB?"*

**YES.** Here is the physical path:

```mermaid
graph LR
  Mac[Your Mac (Terminal)] -->|"runs db:migrate"| Bridge[Port 5432]
  Bridge -->|"forwards to"| Docker[Docker Container (Postgres)]
  Docker -->|"writes to"| Volume[Docker Volume (Data)]
```

*   **Source**: Your Mac has the SQL file (`0000_init.sql`).
*   **Transport**: It connects to `localhost:5432`.
*   **Destination**: Docker accepts the connection and applies the SQL to the database table.
*   **Result**: The tables live inside Docker.

## Summary
Yes, "Proper Migrations" is the correct, industry-standard choice. It protects your data from accidental deletion.



---

## 6. Appendix 2: Automation (The "Migrator" Service) 🤖

You asked: *"Can't we put this in docker-compose? Is it production grade?"*

**Answer: Conceptually Yes, Mechanically No.**

### 1. Local / Simple Deployments (Docker Compose) ✅
*   **Pattern**: We add a `migrator` service to `docker-compose.yml`.
*   **How it works**: It starts -> Runs `db:migrate` -> Dies.
*   **The App**: Waits for `migrator` to exit successfully (`service_completed_successfully`).
*   **Verdict**: Excellent for self-contained environments.

### 2. Enterprise Production (AWS ECS) 🏢
*   **Pattern**: We do **not** use `docker-compose` in AWS.
*   **How it works**: The CI/CD Pipeline (GitHub Actions) handles the orchestration.
    1.  **Build**: Create Docker Image.
    2.  **Release Phase**: Run a "One-Off Task" using that image to execute `db:migrate`.
    3.  **Deploy**: Only if step 2 succeeds, update the Main Service.
*   **Why**: This decouples the migration risk from the application startup.

**Summary**:
We will implement the `migrator` service in `docker-compose.yml` for **Local Convenience**.
Ideally, for AWS, we will map this to a **GitHub Actions Step**.
