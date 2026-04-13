# Master Specification: Standalone AI Copilot (Live-Fetch Agent)

This document defines the end-to-end architecture, technical flow, and infrastructure for the FluxNex Standalone AI Copilot. This product is a real-time Agentic Proxy that fetches live data directly from external SaaS applications (Salesforce, QuickBooks, etc.), bypassing internal database replicas to ensure 100% data freshness. :contentReference[oaicite:0]{index=0}

---

## 1. High-Level Architectural Layers

The system is architected to separate high-frequency user interactions from heavy reasoning and secure credential management.

### A. Interface Plane (Frontend)
- **Technology**: React, Refine, Shadcn UI  
- **AI SDK**: Vercel AI SDK (useChat)  
- **Reactivity**: InstantDB Hooks (useQuery)  
- **Role**: Captures user intent and renders Generative UI Business Cards. It observes the agent's "Thought Trace" in real-time via InstantDB without manual WebSocket plumbing.

### B. Reactive Orchestration Plane (InstantDB)
- **Technology**: InstantDB (Graph-based Reactive DB - Open Source)  
- **Role**:
  - Interaction State: Persists chat history and multi-session metadata  
  - Live Bus: Acts as the real-time bridge. When a background worker writes a "thought" or "result" to InstantDB, the UI updates instantly for the user  
  - Audit Vault: Stores the history of all AI reasoning steps  

### C. Reasoning Plane (Agentic Worker Fleet)
- **Technology**: BullMQ, Node.js Workers, Portkey AI Gateway  
- **AI Models**: Gemini 1.5 Flash (Intent) / Claude 3.5 Sonnet (Reasoning)  
- **Role**: The "Brain." It executes the tool-calling loops. It is asynchronous to prevent blocking the API Gateway during high-latency (2s–5s) external API calls  

### D. Execution Plane (Secure Kernel)
- **Technology**: Universal Trigger Proxy, AWS KMS, Redis Locks  
- **Role**: The "Hands." It retrieves encrypted tokens from the vault and executes the physical HTTPS calls to the SaaS vendors. It performs Context Pruning (stripping raw JSON down to essential fields) before passing data back to the LLM  

---

## 2. End-to-End Technical Flow

The following 6-step loop ensures maximum speed and minimum token consumption.

### Step 1: Request & Contextual JIT Filtering
- User Input: User asks "What is the ETA for Load #7721?"  
- InstantDB Mutation: The message is saved to the messages collection in InstantDB  
- JIT Tool Registry: The API Gateway queries the app_connection table  
- Discovery: The system generates an MCP tool definition only for Salesforce  

### Step 2: Intent Classification (Fast-Path)
- Inference: The prompt is sent to Gemini 1.5 Flash (via Portkey)  
- Classification: The LLM identifies the target connection and object (Salesforce Load)  
- Handoff: The API drops a job into the BullMQ Copilot Queue  

### Step 3: Thought Trace Initialization
- Worker Pickup: A Copilot Worker picks up the job  
- Status Pulse: The worker writes `status: 'IDENTIFYING_RECORD'` to the steps collection in InstantDB  
- UI Feedback: The ThoughtTrace component updates instantly  

### Step 4: Secure Live Fetch & Pruning
- Tool Execution: The worker calls the Universal Trigger Proxy for a live GET request  
- Auth Lock: The Kernel acquires a Redis lock, decrypts the Salesforce token via KMS, and hits the API  
- Context Pruning: Reduces raw JSON (~9KB) to only mapped fields  
- Token Save: Payload reduced from ~8,000 tokens to ~200 tokens  

### Step 5: LLM Synthesis (Heavy Reasoning)
- Reasoning: Pruned JSON is sent to Claude 3.5 Sonnet  
- Action: LLM formulates final answer  
- Step Update: Worker writes `status: 'SYNTHESIZING_RESPONSE'`  

### Step 6: Reactive Delivery
- Persistence: Final response saved to InstantDB  
- Streaming: UI streams response in real-time  
- Generative UI: Specialized UI card rendered (e.g., Load with ETA + map)  

---

## 3. UI Component: The Thought Trace (Reactive)

Using InstantDB, the ThoughtTrace observes the database state.

```tsx
import { db } from "@instantdb/react";

export function ThoughtTrace({ sessionId }) {
  const { data } = db.useQuery({
    steps: {
      $: { where: { sessionId: sessionId } }
    }
  });

  return (
    <div className="space-y-2 border-l-2 border-slate-100 ml-4 pl-4 py-2">
      {data?.steps?.map((step) => (
        <div key={step.id} className="flex items-center gap-2 text-xs font-medium text-slate-500 animate-in fade-in">
          {step.isComplete ? (
            <CheckCircle2 size={12} className="text-green-500" />
          ) : (
            <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
          )}
          <span>{step.message}</span>
        </div>
      ))}
    </div>
  );
}

## 4. Enterprise Scaling to Millions of Chats

### A. Compute Scaling: Distributed Worker Grid
To handle millions of messages, we utilize Hash-Based Queue Sharding and specialized fleets.

- **Logic**: `shard_id = hash(org_id) % total_shards`. Chat sessions are distributed across physical Redis clusters.

**Worker Groups:**
- **"Small" Workers (Fast Path)**: Optimized for high-concurrency intent classification  
- **"Heavy" Workers (Reasoning Path)**: Higher RAM/CPU for long-context tool-calling loops  
- **Dedicated Fleets**: Physically isolated compute for Tier-1 Enterprise customers  

### B. LLM Orchestration & Cost Efficiency
- **Semantic Cache Layer**: Uses pgvector. If a user asks a semantically similar question asked recently (e.g., "Status of Load #5502?"), the system returns the cached response in <100ms for $0 token cost  
- **LLM Load Balancing**: Portkey/LiteLLM rotates between providers (Gemini 1.5 Flash → GPT-4o-mini → Claude 3.5 Haiku) to handle failover and rate limits  

### C. The Shield: Protecting SaaS APIs
- **Connection-Level Throttling**: A Global Connection Governor in Redis uses "Leaky Bucket" logic. Background syncs always take priority over Copilot queries  
- **Truth Buffer**: Raw API responses are cached for 60 seconds in Redis. Multiple users in the same company asking for the same record only trigger one external API call  

## 5. Multi-Region Deployment Strategy

For global scale, the Copilot Runtime is deployed to multiple AWS Regions:

- **Local Ingestion**: A user in Europe hits `eu-central-1.api.fluxnex.com`  
- **Local Reasoning**: A worker in the EU VPC handles the AI logic to minimize cross-continent latency  
- **Data Sovereignty**: The Registry ensures that the PII involved in the "Reasoning" context stays within the required geographical boundary  

---

## 6. Token Optimization Summary (Goal: <1K)

| Component       | Process                                   | Token Impact |
|----------------|------------------------------------------|-------------|
| System Prompt  | Hardcoded logic narrow-scoped            | ~200        |
| Tool Registry  | JIT Filtering (Only connected apps)      | ~150        |
| Data Context   | Context Pruning (Only mapped fields)     | ~300 (Reduced from 8K) |
| Chat History   | Summarization of last 3 turns            | ~200        |
| **Total Input**|                                          | **~850 Tokens** |

---

## 7. Infrastructure Specification

| Component          | Technology              | Scaling Strategy                          |
|-------------------|------------------------|-------------------------------------------|
| API Pods          | AWS Fargate (NestJS)   | Horizontal Auto-scaling (Request Count)   |
| Agentic Workers   | AWS Fargate (Node.js)  | Scaled based on BullMQ Queue Depth        |
| Real-time Bus     | InstantDB              | Reactive State & WebSocket Hub            |
| Semantic Cache    | Aurora (pgvector)      | Vector similarity search                  |
| AI Gateway        | Portkey                | Multi-provider load balancing             |

---

## 8. Security & Privacy

- **Ephemeral Fetch**: No PII or business data from the SaaS apps is stored in the FluxNex database. It exists only in the volatile memory of the reasoning worker and the user's session  
- **KMS Encryption**: All OAuth tokens used by the AI are encrypted at rest  
- **RBAC Scoping**: The tool definitions provided to the LLM are strictly filtered by the user's connection permissions  