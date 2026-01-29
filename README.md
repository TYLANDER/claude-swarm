# Claude Swarm

Cloud-based orchestration system for running multiple Claude Code agents in parallel. Scale from 4-6 local agents to 20+ cloud agents for large feature implementations, refactors, and complex multi-file tasks.

## What It Does

Claude Swarm lets you fan out coding tasks to a fleet of AI agents running in the cloud:

- **Submit tasks** via CLI or API - describe what you want done
- **Agents work in parallel** - each on isolated git worktrees
- **Results merge back** - with conflict detection and resolution
- **Cost controls** - per-task, daily, and weekly budget limits

### Example Workflow

```bash
# Submit 5 tasks for a new feature - they run in parallel
swarm submit -f tasks/payment-feature.json

# Watch progress in real-time
swarm watch

# Check budget usage
swarm budget
```

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  LOCAL OVERSEER (Your Machine)                                   │
│  • Decompose large tasks    • Submit to cloud                    │
│  • Review results           • Resolve conflicts                  │
└───────────────────────────┬──────────────────────────────────────┘
                            │ REST API / WebSocket
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│  CLOUD ORCHESTRATOR (Azure Container App)                        │
│  • Task queue management    • Agent lifecycle                    │
│  • Git coordination         • Cost tracking                      │
└───────────────────────────┬──────────────────────────────────────┘
                            │
          ┌─────────────────┼─────────────────┐
          ▼                 ▼                 ▼
┌──────────────────────────────────────────────────────────────────┐
│  WORKER AGENTS (Azure Container App Jobs, 0-25)                  │
│  • Claude Agent SDK         • Isolated git worktrees             │
│  • Scale-to-zero            • Ephemeral containers               │
└──────────────────────────────────────────────────────────────────┘
```

## Key Capabilities

### Task Types

| Type       | Use Case                               |
| ---------- | -------------------------------------- |
| `code`     | Implement features, fix bugs, refactor |
| `test`     | Write unit tests, integration tests    |
| `review`   | Security review, code quality analysis |
| `doc`      | API docs, README updates, comments     |
| `security` | Vulnerability scanning, audit          |

### Cost Optimization

- **Model selection**: Sonnet ($3/$15 per MTok) vs Opus ($5/$25 per MTok)
- **Prompt caching**: 90% cost reduction on repeated context
- **Budget limits**: Per-task, daily ($100 default), weekly ($500 default)
- **Scale-to-zero**: Only pay for compute when agents are active

### Git Workflow

Each agent works on an isolated branch:

```
feature/parent-task-abc123
├── agent/task-abc123-agent-1  ← Agent 1's changes
├── agent/task-abc123-agent-2  ← Agent 2's changes
└── agent/task-abc123-agent-3  ← Agent 3's changes
```

Results merge back with automatic conflict detection.

## CLI Commands

```bash
swarm submit -p "Fix the auth bug"     # Submit single task
swarm submit -f tasks.json             # Submit batch of tasks
swarm status <task-id>                 # Check task status
swarm agents                           # List active agents
swarm budget                           # View budget/usage
swarm watch                            # Real-time event stream
swarm config --list                    # View configuration
```

## Project Structure

```
claude-swarm/
├── packages/
│   ├── cli/           # Command-line interface
│   ├── types/         # Shared TypeScript types
│   └── shared/        # Utilities (cost calc, formatting)
├── services/
│   ├── agent-worker/  # Claude Agent SDK container
│   └── orchestrator/  # REST API + task queue management
├── infrastructure/
│   └── terraform/     # Azure infrastructure as code
├── docs/              # Setup guide, CLI reference
└── examples/          # Sample task files
```

## Tech Stack

| Layer          | Technology                        |
| -------------- | --------------------------------- |
| Runtime        | Node.js 22, TypeScript 5          |
| Build          | Turborepo, npm workspaces         |
| Infrastructure | Azure Container Apps, Service Bus |
| IaC            | Terraform 1.6+                    |
| Agent SDK      | @anthropic-ai/claude-agent-sdk    |
| CI/CD          | GitHub Actions                    |

## Getting Started

See [SETUP_TODO.md](SETUP_TODO.md) for the complete setup checklist.

Quick local development:

```bash
npm install
npm run build
npm run type-check
```

## Documentation

- [Setup Guide](docs/SETUP.md) - Full infrastructure setup
- [CLI Reference](docs/CLI.md) - All commands and options
- [Example Tasks](examples/tasks/) - Sample configurations

## Cost Estimates

For 20 parallel agents at moderate usage:

- **Claude API**: $800 - $2,000/month (tokens dominate)
- **Azure infrastructure**: $85 - $240/month
- **Total**: ~$900 - $2,200/month

## License

MIT
