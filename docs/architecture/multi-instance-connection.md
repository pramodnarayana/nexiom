# Strategy: Multi-Instance Connection Management (v4.0)

This document defines the architectural and UX pattern for allowing customers to connect and manage multiple instances of the same application (e.g., 3 separate QuickBooks accounts).

## 1. The "Catalog vs. Inventory" Pattern

To ensure an enterprise-grade experience, we separate the Discovery of apps from the Management of instances.

| Component | UI Location | Purpose | Primary Action |
| :--- | :--- | :--- | :--- |
| **App Marketplace** | Main View / Catalog | Discovery: Shows available integrations. | `+ New Connection` |
| **Active Connections** | Sidebar / Inventory | Management: Shows authenticated instances. | `Manage` / `Settings` |

## 2. Button Placement & Labeling Logic

To prevent confusion and maintain a clean UI, buttons are strictly scoped and labeled:

### A. The Marketplace Card

* **Standard Label:** Always shows `+ New Connection`.
* **Statelessness:** The card does not change its label even if an instance already exists. It remains a "factory" for creating additional connections.
* **Constraint:** Never show "Manage" here. The Marketplace is for acquisition, not operation.

### B. The Active Connections Inventory (Sidebar)

Each instance (e.g., "Salesforce - North America") is represented by its own card.

* **Recognition:** Identified by the user-defined `displayName`.
* **Actions Available:**
  * **Manage:** Opens specific instance settings (scopes, display names).
  * **Reconnect:** Triggers a fresh OAuth flow for that specific instance.
  * **Delete:** Permanently wipes the physical schema and credentials for that instance.

## 3. Recognition via Display Name

In a multi-instance environment, the App Logo is not enough.

* **Requirement:** Every connection must have a user-defined `displayName` stored in the `app_connection` table.
* **UI Rule:** The `displayName` is the primary header on the Connection Card in the inventory.
* **Recognition:** If a user connects three Salesforce instances, they identify them as "Sales," "Support," and "Sandbox" via these labels.

## 4. Multi-Instance Onboarding Flow

1. **Selection:** User clicks `+ New Connection` on an app card in the Marketplace.
2. **Configuration Modal:** Before the OAuth handshake, the user provides:
    * **Display Name:** (e.g., "Logistics US").
    * **Environment:** (Sandbox vs. Production).
3. **Authentication:** Standard OAuth flow.
4. **Registration:** System creates a unique `connection_id` and provisions the physical silo (schema).

## 5. Summary Verdict

By keeping the Marketplace label as `+ New Connection`:

* **Consistency:** The UI remains predictable. The Marketplace always looks the same regardless of what is connected.
* **Clarity:** It removes any ambiguity about "managing" an app from a place that doesn't show specific instances.
* **Simplicity:** It reduces the conditional logic required for the frontend Marketplace components.
