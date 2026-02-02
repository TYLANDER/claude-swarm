# Claude Swarm - Fly.io Architecture & Deployment Plan

> Central reference document for Fly.io-based agent swarm infrastructure, CLI integration, and client applications.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Authentication & Credential Management](#authentication--credential-management)
3. [Fly.io Infrastructure](#flyio-infrastructure)
4. [Backend API Specification](#backend-api-specification)
5. [CLI Integration](#cli-integration)
6. [Claude Code Integration](#claude-code-integration)
7. [iOS/macOS App Requirements](#iosmacos-app-requirements)
8. [Deployment Guide](#deployment-guide)
9. [Development Workflow](#development-workflow)

---

## Architecture Overview

### System Components

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CLIENT LAYER                                 │
├─────────────────┬─────────────────┬─────────────────────────────────┤
│   iOS App       │   macOS App     │   Claude Code CLI               │
│   (SwiftUI)     │   (SwiftUI)     │   (/swarm command)              │
└────────┬────────┴────────┬────────┴────────────┬────────────────────┘
         │                 │                      │
         └─────────────────┼──────────────────────┘
                           │
                    HTTPS / WSS
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      ORCHESTRATOR                                    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌────────────┐ │
│  │  REST API   │  │  WebSocket  │  │  Scheduler  │  │  Executor  │ │
│  │  /api/*     │  │  /ws        │  │             │  │  Factory   │ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────┬──────┘ │
│                                                           │        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │        │
│  │  Auth/JWT   │  │  Conflict   │  │  Metrics    │       │        │
│  │  Middleware │  │  Monitor    │  │  Collector  │       │        │
│  └─────────────┘  └─────────────┘  └─────────────┘       │        │
└──────────────────────────────────────────────────────────┼────────┘
                                                           │
                    ┌──────────────────────────────────────┼──────┐
                    │                                      │      │
                    ▼                                      ▼      │
          ┌─────────────────┐                   ┌─────────────────┐
          │  Azure Executor │                   │  Fly.io Executor│
          │  (Container     │                   │  (Machines API) │
          │   Apps Jobs)    │                   │                 │
          └────────┬────────┘                   └────────┬────────┘
                   │                                     │
                   ▼                                     ▼
          ┌─────────────────┐                   ┌─────────────────┐
          │  Azure Worker   │                   │  Fly.io Machine │
          │  Containers     │                   │  (ephemeral)    │
          └─────────────────┘                   └─────────────────┘
                   │                                     │
                   └──────────────┬──────────────────────┘
                                  │
                                  ▼
                        ┌─────────────────┐
                        │  Claude Agent   │
                        │  (Agent SDK)    │
                        │                 │
                        │  - Git worktree │
                        │  - Task exec    │
                        │  - Result push  │
                        └─────────────────┘
```

### Data Flow

1. **Task Submission**: Client → Orchestrator REST API → Task Queue
2. **Task Execution**: Scheduler → Executor → Fly Machine → Claude Agent
3. **Result Delivery**: Agent stdout → Machine logs → Orchestrator → Client
4. **Real-time Updates**: Orchestrator → WebSocket → All connected clients

---

## Authentication & Credential Management

### Overview

The system requires secure handling of multiple credentials:
- **Anthropic API Key** — Used by agents to call Claude
- **Fly.io API Token** — Used by orchestrator to spawn machines
- **GitHub Token** — Used by agents for git operations
- **User JWT** — Used by clients to authenticate with orchestrator

### Credential Storage by Platform

#### macOS (CLI & App)

**Primary: macOS Keychain**

```typescript
// packages/cli/src/keychain.ts
import keytar from 'keytar';

const SERVICE_NAME = 'claude-swarm';

export async function setCredential(key: string, value: string): Promise<void> {
  await keytar.setPassword(SERVICE_NAME, key, value);
}

export async function getCredential(key: string): Promise<string | null> {
  return keytar.getPassword(SERVICE_NAME, key);
}

export async function deleteCredential(key: string): Promise<void> {
  await keytar.deletePassword(SERVICE_NAME, key);
}
```

**Keychain Items**:
| Key | Description |
|-----|-------------|
| `anthropic-api-key` | Anthropic API key |
| `fly-api-token` | Fly.io deploy token |
| `github-token` | GitHub PAT |
| `orchestrator-jwt` | Cached JWT for API calls |

**Fallback: Encrypted Config File**

For headless/CI environments where Keychain isn't available:

```typescript
// ~/.config/claude-swarm/credentials.enc
// Encrypted with machine-specific key derived from:
// - Hardware UUID (macOS: ioreg -d2 -c IOPlatformExpertDevice)
// - User ID

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';

function deriveKey(): Buffer {
  const machineId = getMachineId();  // Platform-specific
  const userId = process.env.USER || 'default';
  return scryptSync(`${machineId}:${userId}`, 'claude-swarm-salt', 32);
}

export function encryptCredentials(data: Record<string, string>): string {
  const key = deriveKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(data)), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}
```

#### iOS

**Keychain Services with iCloud Sync**

```swift
// SwarmCredentials.swift
import Security

class CredentialManager {
    static let shared = CredentialManager()

    private let service = "com.claudeswarm.credentials"

    func store(key: String, value: String, syncable: Bool = false) throws {
        let data = value.data(using: .utf8)!

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecValueData as String: data,
            kSecAttrSynchronizable as String: syncable ? kCFBooleanTrue! : kCFBooleanFalse!,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        ]

        SecItemDelete(query as CFDictionary)  // Remove existing
        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw CredentialError.storageFailed(status)
        }
    }

    func retrieve(key: String) throws -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        guard status == errSecSuccess, let data = result as? Data else {
            return nil
        }
        return String(data: data, encoding: .utf8)
    }
}
```

**Sync Strategy**:
- `anthropicApiKey`: **NOT synced** (iCloud sync disabled) — user enters on each device
- `orchestratorJwt`: **NOT synced** — device-specific session
- `userPreferences`: **Synced** — via iCloud key-value store

#### Linux/CI Headless

**Environment Variables (Recommended)**

```bash
export ANTHROPIC_API_KEY=sk-ant-xxx
export FLY_API_TOKEN=fo1_xxx
export GITHUB_TOKEN=ghp_xxx
export SWARM_JWT=eyJ...
```

**Credential File (Alternative)**

```bash
# ~/.config/claude-swarm/credentials
# Mode: 600 (owner read/write only)
ANTHROPIC_API_KEY=sk-ant-xxx
FLY_API_TOKEN=fo1_xxx
```

```typescript
// Load order:
// 1. Environment variables (highest priority)
// 2. Keychain (macOS only)
// 3. Encrypted config file
// 4. Plain config file (lowest priority, with warning)
```

### JWT Authentication Flow

#### Token Generation

```
┌─────────┐         ┌──────────────┐         ┌─────────────┐
│  Client │         │ Orchestrator │         │  Keychain   │
└────┬────┘         └──────┬───────┘         └──────┬──────┘
     │                     │                        │
     │  POST /api/auth/token                        │
     │  { apiKey: "..." }  │                        │
     │────────────────────>│                        │
     │                     │                        │
     │                     │  Validate API key      │
     │                     │  (check against        │
     │                     │   stored hashes)       │
     │                     │                        │
     │                     │  Generate JWT          │
     │                     │  (sign with JWT_SECRET)│
     │                     │                        │
     │  { token, expiresAt }                        │
     │<────────────────────│                        │
     │                     │                        │
     │  Store JWT          │                        │
     │─────────────────────────────────────────────>│
     │                     │                        │
```

#### Token Structure

```typescript
interface JwtPayload {
  sub: string;          // User/API key identifier
  iat: number;          // Issued at
  exp: number;          // Expiration (default: 7 days)
  scope: string[];      // Permissions: ['tasks:read', 'tasks:write', 'agents:read']
  device?: string;      // Device identifier for revocation
}
```

#### Token Refresh

```typescript
// Automatic refresh when token expires within 1 hour
async function getAuthToken(): Promise<string> {
  const stored = await getCredential('orchestrator-jwt');
  if (!stored) throw new AuthError('Not authenticated');

  const payload = decodeJwt(stored);
  const expiresIn = payload.exp * 1000 - Date.now();

  // Refresh if expiring within 1 hour
  if (expiresIn < 60 * 60 * 1000) {
    const newToken = await refreshToken(stored);
    await setCredential('orchestrator-jwt', newToken);
    return newToken;
  }

  return stored;
}
```

### API Key Management

#### User API Keys

For programmatic access (CI/CD, scripts), users can generate API keys:

```
POST /api/auth/api-keys
Authorization: Bearer <jwt>
{
  "name": "GitHub Actions",
  "scopes": ["tasks:write", "tasks:read"],
  "expiresInDays": 90
}

Response:
{
  "id": "key_abc123",
  "key": "sk_swarm_xxx...",  // Only shown once!
  "name": "GitHub Actions",
  "scopes": ["tasks:write", "tasks:read"],
  "expiresAt": "2024-05-01T00:00:00Z"
}
```

**Storage**:
- API keys are hashed (bcrypt) before storage
- Only key prefix stored for identification: `sk_swarm_xxx...`
- Full key only shown at creation time

#### Anthropic Key Handling

The Anthropic API key flows through the system:

1. **User Input**: Entered during `swarm setup` or in app settings
2. **CLI Storage**: Keychain (macOS) or encrypted file
3. **Orchestrator**: Passed via environment variable when starting
4. **Workers**: Injected as env var when spawning Fly machines

**Security Measures**:
- Never logged (redacted in all log output)
- Never returned in API responses
- Validated format before storage: `sk-ant-api03-*`
- Rate limiting on auth endpoints

### Headless CLI Mode

For CI/CD and automation without interactive prompts:

```bash
# Option 1: Environment variables
ANTHROPIC_API_KEY=sk-ant-xxx \
FLY_API_TOKEN=fo1_xxx \
swarm submit -p "Run tests"

# Option 2: Config from stdin
echo '{"anthropicApiKey":"sk-ant-xxx"}' | swarm setup --stdin

# Option 3: Pre-authenticated with JWT
SWARM_JWT=eyJ... swarm submit -p "Run tests"

# Option 4: API key auth (no JWT dance)
SWARM_API_KEY=sk_swarm_xxx swarm submit -p "Run tests"
```

### Security Checklist

- [ ] All credentials stored in Keychain (macOS) or Keychain Services (iOS)
- [ ] Fallback encrypted storage uses machine-bound key derivation
- [ ] JWT tokens expire (default 7 days, configurable)
- [ ] API keys can be revoked
- [ ] Anthropic key never in logs, responses, or error messages
- [ ] Config files have restrictive permissions (600)
- [ ] HTTPS enforced for all API communication
- [ ] Rate limiting on authentication endpoints
- [ ] Failed auth attempts logged for monitoring

---

## Fly.io Infrastructure

### Resources Required

| Resource | Purpose | Specs |
|----------|---------|-------|
| Fly App (orchestrator) | Runs orchestrator service | 1 shared CPU, 512MB |
| Fly App (workers) | Ephemeral agent machines | Variable (1-4 CPU, 1-4GB) |
| Fly Postgres (optional) | Persistent state storage | 1 shared CPU, 256MB |
| Upstash Redis (optional) | Session cache, pub/sub | Serverless tier |

### Machine Resource Tiers

```typescript
const RESOURCE_TIERS = {
  light:    { cpus: 1, memory_mb: 1024 },   // Docs, simple reviews
  standard: { cpus: 2, memory_mb: 2048 },   // Most code tasks
  heavy:    { cpus: 4, memory_mb: 4096 },   // Security scans, Opus + code
};
```

### Regions

Primary: `ord` (Chicago) — good latency to Anthropic API
Fallback: `iad` (Virginia), `sjc` (San Jose)

### Cost Estimate

| Scenario | Workers | Duration | Est. Cost |
|----------|---------|----------|-----------|
| Light usage | 5/day | 10 min each | ~$0.10/day |
| Medium usage | 20/day | 15 min each | ~$0.80/day |
| Heavy usage | 50/day | 20 min each | ~$3.00/day |

Fly.io bills per-second with no minimum, making it ideal for ephemeral workloads.

---

## Backend API Specification

### Authentication

**Method**: JWT Bearer Token

```
Authorization: Bearer <jwt_token>
```

**Token Generation**:
```
POST /api/auth/token
Content-Type: application/json

{
  "apiKey": "user-provided-api-key"
}

Response:
{
  "token": "eyJ...",
  "expiresAt": "2024-02-08T00:00:00Z"
}
```

### Core Endpoints

#### Tasks

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/tasks` | Submit new tasks |
| `GET` | `/api/tasks` | List all tasks |
| `GET` | `/api/tasks/:id` | Get task details |
| `POST` | `/api/tasks/:id/cancel` | Cancel a task |
| `GET` | `/api/tasks/:id/logs` | Stream task logs |

#### Execution

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/execute/:taskId` | Execute single task |
| `POST` | `/api/execute/batch` | Execute all ready tasks |

#### Agents

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/agents` | List active agents |
| `GET` | `/api/agents/:id` | Get agent details |

#### System

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/api/provider` | Current executor provider |
| `GET` | `/api/budget` | Budget status |
| `GET` | `/api/metrics` | Aggregate statistics |
| `GET` | `/api/queue` | Queue status |

### WebSocket Events

**Connection**: `wss://<host>/ws`

**Events (Server → Client)**:
```typescript
interface WsEvent {
  type: 'task_created' | 'task_started' | 'task_completed' | 'task_failed'
      | 'agent_spawned' | 'agent_completed' | 'conflict_detected';
  payload: any;
  timestamp: string;
}
```

**Example**:
```json
{
  "type": "task_completed",
  "payload": {
    "taskId": "abc-123",
    "agentId": "fly-agent-abc12345",
    "status": "success",
    "filesChanged": ["src/index.ts"],
    "costCents": 45
  },
  "timestamp": "2024-02-01T12:00:00Z"
}
```

---

## CLI Integration

### Commands

```bash
# Setup and configuration
swarm setup                      # Interactive setup (provider selection)
swarm setup --provider fly       # Direct Fly.io setup
swarm setup --check              # Verify configuration
swarm config --list              # Show all config
swarm provider                   # Show current provider
swarm provider fly               # Switch to Fly.io

# Orchestrator management
swarm orchestrator start         # Start local orchestrator
swarm orchestrator start --background
swarm orchestrator stop
swarm orchestrator status

# Task operations
swarm submit -p "Add login form" --model sonnet
swarm submit -f tasks.yaml
swarm status                     # Show recent tasks
swarm status <taskId>            # Show specific task
swarm watch                      # Real-time updates

# Agent monitoring
swarm agents                     # List active agents
swarm budget                     # Show budget status
```

### Configuration Storage

Location: `~/.config/claude-swarm/config.json` (via `conf` package)

```typescript
interface SwarmConfig {
  // Provider selection
  executorType: 'azure' | 'fly' | 'local';

  // Orchestrator
  orchestratorUrl: string;

  // Fly.io (when executorType === 'fly')
  flyApiToken?: string;
  flyAppName?: string;
  flyRegion?: string;
  flyContainerImage?: string;

  // Azure (when executorType === 'azure')
  azureSubscriptionId?: string;
  azureResourceGroup?: string;
  containerAppsEnvironment?: string;
  agentJobName?: string;

  // Common
  anthropicApiKey?: string;
  defaultModel: 'opus' | 'sonnet';
  defaultPriority: 'high' | 'normal' | 'low';
  defaultBudgetCents: number;
  defaultTimeoutMinutes: number;
}
```

---

## Claude Code Integration

### Slash Command: `/swarm`

The `/swarm` command in Claude Code provides direct access to the agent swarm.

**Usage**:
```
/swarm <prompt>                  # Submit task with prompt
/swarm status                    # Show task status
/swarm watch                     # Watch for updates
```

**Implementation**: `.claude/commands/swarm.md`

The slash command:
1. Reads configuration from CLI config
2. Submits to orchestrator via REST API
3. Watches for completion via WebSocket
4. Reports results inline

### Hook Integration

Claude Code hooks can trigger swarm operations:

```json
// .claude/settings.json
{
  "hooks": {
    "post-commit": "swarm submit -p 'Review commit ${GIT_COMMIT}' --type review"
  }
}
```

---

## iOS/macOS App Requirements

### Core Features

#### Dashboard
- Active task count with status breakdown
- Running agents with current task
- Cost tracking (daily/weekly)
- Recent activity feed

#### Task Management
- Submit new tasks (text input + voice)
- View task list with filters (status, type, date)
- Task detail view with:
  - Prompt and context
  - Execution logs (streaming)
  - Result summary
  - Files changed
  - Cost breakdown

#### Agent Monitoring
- Active agent list
- Per-agent status and progress
- Resource utilization
- Logs viewer

#### Configuration
- Provider selection (Azure/Fly.io)
- API credentials management (Keychain)
- Budget limits
- Default settings

### Platform-Specific

#### iOS
- Push notifications for task completion
- Widget for dashboard stats
- Shortcuts integration
- Share extension for quick task submission

#### macOS
- Menu bar app with status
- Keyboard shortcuts
- Notifications
- Handoff with iOS app

### API Requirements for Apps

The backend must provide:

1. **Authentication**
   - `POST /api/auth/token` — JWT generation
   - Token refresh mechanism

2. **Real-time Updates**
   - WebSocket connection with automatic reconnect
   - Event types for all state changes

3. **Pagination**
   - `GET /api/tasks?page=1&limit=20`
   - Cursor-based pagination for large lists

4. **Filtering**
   - `GET /api/tasks?status=running&type=code`

5. **Log Streaming**
   - `GET /api/tasks/:id/logs` — SSE or WebSocket
   - Historical log retrieval

6. **Metrics**
   - `GET /api/metrics?period=day|week|month`
   - Aggregated statistics

### Data Models (Swift)

```swift
struct Task: Codable, Identifiable {
    let id: String
    let type: TaskType
    let status: TaskStatus
    let prompt: String
    let model: Model
    let priority: Priority
    let createdAt: Date
    let assignedAgent: String?
    let result: TaskResult?
}

struct Agent: Codable, Identifiable {
    let id: String
    let status: AgentStatus
    let currentTask: String?
    let startedAt: Date
    let tokensUsed: TokenUsage
    let costCents: Int
}

struct DashboardMetrics: Codable {
    let activeTasks: Int
    let runningAgents: Int
    let completedToday: Int
    let costToday: Int
    let costThisWeek: Int
}
```

---

## Deployment Guide

### Prerequisites

```bash
# Install Fly CLI
brew install flyctl

# Authenticate
fly auth login
```

### Initial Setup

```bash
# 1. Create Fly apps
fly apps create claude-swarm-orchestrator
fly apps create claude-swarm-workers

# 2. Set secrets for orchestrator
fly secrets set -a claude-swarm-orchestrator \
  ANTHROPIC_API_KEY=sk-ant-xxx \
  JWT_SECRET=$(openssl rand -hex 32) \
  FLY_API_TOKEN=$(fly tokens create deploy -a claude-swarm-workers)

# 3. Deploy orchestrator
cd services/orchestrator
fly deploy -a claude-swarm-orchestrator

# 4. Push worker image
cd services/agent-worker
fly deploy -a claude-swarm-workers --build-only
```

### fly.toml (Orchestrator)

```toml
app = "claude-swarm-orchestrator"
primary_region = "ord"

[build]
  dockerfile = "Dockerfile"

[env]
  PORT = "3000"
  EXECUTOR_TYPE = "fly"
  FLY_APP_NAME = "claude-swarm-workers"
  FLY_REGION = "ord"
  MAX_PARALLEL_AGENTS = "20"
  DAILY_BUDGET_CENTS = "10000"

[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 1

[[vm]]
  cpu_kind = "shared"
  cpus = 1
  memory_mb = 512
```

### Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Claude API key |
| `JWT_SECRET` | Yes | Secret for JWT signing |
| `EXECUTOR_TYPE` | Yes | `fly` or `azure` |
| `FLY_API_TOKEN` | For Fly | Fly.io API token |
| `FLY_APP_NAME` | For Fly | Worker app name |
| `FLY_REGION` | No | Default: `ord` |
| `FLY_CONTAINER_IMAGE` | No | Worker image path |
| `MAX_PARALLEL_AGENTS` | No | Default: 20 |
| `DAILY_BUDGET_CENTS` | No | Default: 10000 |
| `WEEKLY_BUDGET_CENTS` | No | Default: 50000 |
| `ALLOWED_ORIGINS` | No | CORS origins for apps |

---

## Development Workflow

### Local Development

```bash
# 1. Start orchestrator in simulate mode
cd services/orchestrator
SIMULATE_MODE=true npm run dev

# 2. Use CLI to interact
swarm setup  # Configure local orchestrator URL
swarm submit -p "Test task" --model sonnet
swarm watch
```

### Testing with Real Fly.io

```bash
# 1. Set up Fly.io credentials locally
export EXECUTOR_TYPE=fly
export FLY_API_TOKEN=fo1_xxx
export FLY_APP_NAME=claude-swarm-workers
export ANTHROPIC_API_KEY=sk-ant-xxx

# 2. Start orchestrator
npm run dev --workspace=@claude-swarm/orchestrator

# 3. Submit real task
swarm submit -p "Add error handling to auth module" --model sonnet
```

### CI/CD

```yaml
# .github/workflows/deploy-fly.yml
name: Deploy to Fly.io

on:
  push:
    branches: [main]
    paths:
      - 'services/orchestrator/**'
      - 'services/agent-worker/**'

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: superfly/flyctl-actions/setup-flyctl@master

      - name: Deploy Orchestrator
        run: flyctl deploy -a claude-swarm-orchestrator
        working-directory: services/orchestrator
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}

      - name: Deploy Worker Image
        run: flyctl deploy -a claude-swarm-workers --build-only
        working-directory: services/agent-worker
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
```

---

## Version History

| Date | Version | Changes |
|------|---------|---------|
| 2026-02-01 | 1.0.0 | Initial architecture document |

---

## References

- [Fly Machines API](https://fly.io/docs/machines/api/)
- [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk)
- [Project README](../README.md)
- [Azure Architecture](./AZURE_ARCHITECTURE.md) (legacy)
