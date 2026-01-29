# Claude Swarm

Cloud-based Claude Code agent orchestration system. Scale from a single local agent to 20+ parallel cloud agents for large feature implementations.

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  LOCAL OVERSEER (Developer Machine)                              │
│  • Task decomposition • Work distribution • Conflict resolution  │
└───────────────────────────┬──────────────────────────────────────┘
                            │ REST API / WebSocket
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│  CLOUD ORCHESTRATOR (Azure Container App)                        │
│  • Task queue (Service Bus) • Agent lifecycle • Git coordination │
└───────────────────────────┬──────────────────────────────────────┘
                            │
          ┌─────────────────┼─────────────────┐
          ▼                 ▼                 ▼
┌──────────────────────────────────────────────────────────────────┐
│  WORKER AGENTS (Azure Container App Jobs, 0-25)                  │
│  • Claude Agent SDK • Isolated Git worktrees • Scale-to-zero     │
└──────────────────────────────────────────────────────────────────┘
```

## Quick Start

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Initialize Terraform (dev environment)
npm run tf:init

# Deploy infrastructure
npm run tf:apply
```

## Project Structure

```
claude-swarm/
├── infrastructure/
│   └── terraform/
│       ├── modules/
│       │   ├── agent-orchestration/  # Container Apps Jobs, Service Bus
│       │   ├── networking/           # VNet, subnets, NSG
│       │   └── storage/              # Blob, Key Vault
│       └── environments/
│           ├── dev/
│           └── production/
├── services/
│   ├── agent-worker/                 # Claude Agent SDK container
│   └── orchestrator/                 # Task queue & coordination service
├── packages/
│   ├── types/                        # Shared TypeScript types
│   ├── cli/                          # Local CLI for task submission
│   └── shared/                       # Shared utilities
└── .github/workflows/                # CI/CD pipelines
```

## Features

- **Parallel Execution**: Run 20+ Claude agents simultaneously
- **Git Isolation**: Each agent works on isolated worktrees
- **Cost Controls**: Per-task budgets, daily/weekly limits
- **Prompt Caching**: 90% cost reduction on repeated context
- **Auto-Scaling**: Scale-to-zero when idle

## Configuration

### Environment Variables

| Variable                | Description         |
| ----------------------- | ------------------- |
| `ANTHROPIC_API_KEY`     | Claude API key      |
| `AZURE_SUBSCRIPTION_ID` | Azure subscription  |
| `AZURE_RESOURCE_GROUP`  | Resource group name |
| `GITHUB_TOKEN`          | GitHub access token |

## License

MIT
