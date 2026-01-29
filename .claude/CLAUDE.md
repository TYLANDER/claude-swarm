# Claude Swarm - Claude Context

## Project Overview

Claude Swarm is a cloud-based orchestration system for running multiple Claude Code agents in parallel. It enables scaling from 4-6 local agents to 20+ cloud agents for large feature implementations.

## Architecture

- **Three-Tier Design**: Local overseer → Cloud orchestrator → Worker agents
- **Infrastructure**: Azure Container Apps Jobs (workers), Container App (orchestrator), Service Bus (queue)
- **Isolation**: Git worktrees per agent prevent merge conflicts

## Key Technologies

| Component       | Technology                     |
| --------------- | ------------------------------ |
| Package Manager | npm workspaces                 |
| Build System    | Turborepo 2.x                  |
| Language        | TypeScript 5.x                 |
| Runtime         | Node.js 22.x                   |
| Infrastructure  | Terraform 1.6+                 |
| Cloud           | Azure Container Apps           |
| Agent SDK       | @anthropic-ai/claude-agent-sdk |

## Directory Structure

```
/
├── infrastructure/terraform/    # IaC for Azure resources
├── services/
│   ├── agent-worker/           # Claude Agent SDK container
│   └── orchestrator/           # Task queue & coordination
├── packages/
│   ├── types/                  # Shared TypeScript types
│   ├── cli/                    # Local CLI for submissions
│   └── shared/                 # Utilities
└── .github/workflows/          # CI/CD
```

## Commands

```bash
npm run build          # Build all packages
npm run dev            # Development mode
npm run test           # Run tests
npm run lint           # Lint code
npm run tf:plan        # Terraform plan
npm run tf:apply       # Terraform apply
```

## Code Conventions

### Commit Messages

Use conventional commits:

- `feat:` - New features
- `fix:` - Bug fixes
- `infra:` - Infrastructure changes
- `docs:` - Documentation
- `test:` - Tests
- `refactor:` - Code refactoring

### Branch Naming

- `feature/description` - New features
- `fix/description` - Bug fixes
- `infra/description` - Infrastructure changes

## Important Patterns

### Task Schema

Tasks submitted to agents follow this structure:

```typescript
interface AgentTask {
  id: string;
  type: "code" | "test" | "review" | "doc" | "security";
  priority: "high" | "normal" | "low";
  model: "opus" | "sonnet";
  prompt: string;
  context: {
    branch: string;
    files: string[];
    dependencies: string[];
  };
  budgetCents: number;
  timeoutMinutes: number;
}
```

### Git Workflow

Agents work on isolated branches:

```
feature/parent-task-{id}
├── agent/task-{id}-agent-1
├── agent/task-{id}-agent-2
└── ...
```

## Security

- Agents run in private subnet (no public IP)
- Credentials injected via proxy pattern
- Non-root containers with read-only rootfs
- All actions logged to Log Analytics

## Cost Controls

- Per-task budget limits (default: $0.50-$1.00)
- Daily limit: $100
- Weekly limit: $500
- Model routing prefers Sonnet (40% cheaper than Opus)
