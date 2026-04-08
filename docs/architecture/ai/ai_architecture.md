# Architecture: Standalone AI Copilot (Real-time Agentic Proxy)

This document defines the consolidated architecture for the Standalone AI Copilot. Unlike the background sync pipeline, this product operates as a real-time bridge to external applications, fetching live data directly from SaaS applications (Salesforce, QuickBooks, etc.) to provide "Zero-Stale" live answers via the Model Context Protocol (MCP).

## 1. Core Philosophy: The Proxy Model

The Standalone Copilot is designed for customers who want immediate intelligence across their SaaS stack without setting up complex sync routes or physical data silos.

| Feature | Sync-Linked AI (Option 1) | Standalone Copilot (Option 2) |
| --- | --- | --- |
| **Data Source** | Internal PostgreSQL Replicas | External SaaS APIs (Live) |
| **Latency** | Sub-millisecond (Database) | 1–3 Seconds (Network Proxy) |
| **Accuracy** | Historical (Last Sync) | Real-time (Current State) |
| **Dependency** | Requires active Sync Routes | Requires only Connection Auth |
| **Future Capability**| Read-Only | Read & Write (Create Records) |

## 2. Backend Architecture: The Agentic Kernel

The backend acts as a Functional Proxy. It translates user intent into API calls using the Model Context Protocol (MCP) and the existing Connector Pieces. We utilize the **Vercel AI SDK** to manage tool execution flows rather than purely detached background worker loops.

### A. The Orchestrator (NestJS)
- **Intent Classifier**: Uses a high-speed LLM (e.g., Gemini 1.5 Flash) to identify the target app and object.
- **MCP Server**: Dynamically exposes "Tools" to the LLM based on the user's active `app_connection` records, mapping universal piece triggers/actions into JSON schemas.
- **Connector Proxy Service**: A specialized service that executes the `run()` function of an Activepieces Piece in "Live Mode," injecting credentials on-the-fly.

### B. Security & Identity Layer
- **Auth Resolver**: The Copilot fetches encrypted OAuth tokens from the `public.app_connection` table.
- **Token Guard**: Uses standard refresh-lock mechanisms to ensure the token is active before tool execution.
- **Context Isolation**: Strict ABAC/RBAC validation ensures the LLM only "sees" and "calls" tools for apps the specific organization has authenticated.

## 3. Frontend Architecture: Generative Business UI

The frontend transforms raw JSON responses from external APIs into structured, interactive business cards using modern React tools.

### A. The Generative UI Layer
Instead of simple markdown, the Copilot uses **Dynamic Component Injection**:
- **JSON Payload**: The backend returns a raw JSON stream from the source app via the Vercel AI SDK.
- **Component Selection**: The UI identifies the `objectType` and mounts an interactive Business Card Template. 
  - *Example 1*: `LoadCard` showing map, weight, carrier, and ETA.
  - *Example 2*: `InvoiceCard` showing amount, due date, and "Paid/Unpaid" toggle.
- **Skeleton States**: The UI automatically animates skeletons per-tool call while the backend proxies the live SaaS APIs.

### B. Actionable Intelligence (Future Plan)
Provides suggested subsequent actions inline:
- *Data*: "Invoice is overdue."
- *Action Chip*: `[ Create Reminder in Slack ]` or `[ Mark as Paid ]`.

## 4. End-to-End Execution Flow (Real-time)

1. **User Query**: *"Where is Load #5501 right now and who is driving it?"*
2. **Identify Intent**: Backend recognizes a query for Salesforce object `rtms__Load__c`.
3. **Resolve Connection**: System locates the active Salesforce connection within the user's Vault.
4. **Discovery (JIT)**: Backend queries the Salesforce Discovery adapter to validate field labels.
5. **Execute Tool**: 
   - LLM triggers: `get_source_record(object: "rtms__Load__c", filter: "Name=5501")`
   - The Connector Proxy safely executes this against the live API.
6. **Format & Stream**: 
   - Salesforce returns live JSON.
   - The Vercel AI SDK streams the text response combined with specialized JSON tool-call markers.
   - The UI intercepts the payload and intelligently renders the `LoadCard`.

## 5. Technical Stack Summary

- **LLM Interface**: Vercel AI SDK (Server-side & Client-side runtime hooks).
- **Protocol**: Model Context Protocol (MCP) mapping LLM actions.
- **Handshake**: FluxNex connections (OAuth/KMS Vault).
- **Execution**: FluxNex PieceExecutor evaluating code dynamically.
- **UI**: React + TailwindCSS + Lucide (Generative/Dynamic components).

## 6. Strategic Value as a Standalone Product

Entering the market as a "Zero-Stale" AI Agent appeals to:
- **Data Residency Fears**: Customers who refuse data warehousing replicas.
- **Instant Actions**: Customers looking for direct "Create record" capabilities without pipeline setup.
- **Unified Search**: Small teams needing unified command-line-style search capabilities over multiple disjointed apps.