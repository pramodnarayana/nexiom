# Platform Dashboard Design

## 1. Architecture
- **Framework**: Next.js (React)
- **Styling**: Tailwind CSS (Shadcn/UI recommended for premium feel)
- **Data Access**:
    - **API Layer**: `apps/api` (Express/NestJS) serves as the backend.
    - **Multi-Tenancy**: Dashboard sends `x-tenant-id` header. API resolves to correct Tenant DB.

## 2. Key Modules

### 2.1 Integrations Hub
- **Goal**: Manage connections and configurations.
- **Views**:
    - **Card View**: Active Integrations (Revenova -> QuickBooks).
    - **Config Drawer**: Enter Credentials (OAuth/API Keys).
    - **Mapping UI**: Table to map Source Fields -> Destination Fields (e.g., `PayeeRef` -> `DocNumber`).

### 2.2 Pipeline Visualizer (`ActivityLogView`)
- **Visual**: Tabbed Interface (Support View) vs Simple Status (Customer View).
- **Tabs**: `Sync Overview`, `[Source] Gateway`, `Source Replica`, `Normalized Data`, `[Dest] Gateway`.
- **Logic**:
    - **Filter**: By Entity Type (e.g. `Customer Invoice`).
    - **Actions**: `Retry` (Support Only), `Fetch Latest` (Replica Layer).
    - **Trace View**: Detailed side-panel with Request/Response payloads and "AI Explain" button.

### 2.3 Configuration & Mapping (`MappingConfigurationView`)
- **Features**:
    - **AI Auto-Map**: "✨ AI Auto-Map" button triggers field analysis.
    - **Validation**: Visual warning for missing required fields.
    - **Custom Logic**: Support for custom transformation rules.

### 2.4 Initial Sync Wizard (`InitialSyncView`)
- **Steps**:
    1. **Fetch**: Pull entities from Source & Destination.
    2. **Analyze**: Compare based on unique keys (Name, Email).
    3. **Resolve**: UI to manual link, create new, or ignore conflicts.
    4. **Sync**: Bulk execute match strategy.

### 2.5 Notification Config (`NotificationsConfigView`)
- **Channels**: Email, Slack, Webhooks.
- **Triggers**: Toggle defaults like "Critical Auth Failures", "Sync Failures".
- **Status**: Pause/Resume specific channels.

## 3. User Experience (UX)
- **Theme**: Dark/Light mode support. High contrast for status (Green=Success, Red=Error).
- **Real-time**: use SWR/React-Query for polling pipeline status.
