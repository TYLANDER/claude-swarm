# Claude Swarm - Setup Guide

## Quick Start (Local Development)

### 1. Install Dependencies

```bash
npm install
npm run build
```

### 2. Set JWT Secret

```bash
# Generate a random secret
export JWT_SECRET=$(openssl rand -hex 32)
echo "JWT_SECRET=$JWT_SECRET"
```

### 3. Start Development Server

```bash
npx tsx scripts/dev-server.ts
```

### 4. Generate Auth Token

In another terminal:

```bash
export JWT_SECRET=<same secret from step 2>
npx tsx scripts/generate-jwt.ts
```

Copy the token and set it:

```bash
export SWARM_TOKEN=<your-token>
```

### 5. Test the API

```bash
# Health check (no auth required)
curl http://localhost:3000/health

# Submit a task (requires auth)
curl -X POST http://localhost:3000/api/tasks \
  -H "Authorization: Bearer $SWARM_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "tasks": [{
      "type": "code",
      "model": "sonnet",
      "priority": "normal",
      "prompt": "Add a hello world function",
      "context": {
        "branch": "main",
        "files": ["src/index.ts"],
        "dependencies": []
      },
      "budgetCents": 100,
      "timeoutMinutes": 30
    }]
  }'

# Check task status
curl http://localhost:3000/api/tasks/<task-id> \
  -H "Authorization: Bearer $SWARM_TOKEN"

# List agents
curl http://localhost:3000/api/agents \
  -H "Authorization: Bearer $SWARM_TOKEN"
```

### 6. Use the CLI

```bash
# Configure CLI with token
npx swarm config --set authToken=$SWARM_TOKEN

# Or use environment variable
export SWARM_TOKEN=<your-token>

# Submit a task
npx swarm submit -p "Add a hello world function" -t code -m sonnet

# Check status
npx swarm status

# Watch for updates
npx swarm watch
```

---

## Production Deployment (Azure)

### Prerequisites

- Azure subscription
- Terraform 1.6+
- Azure CLI (`az login`)
- Docker (for building images)

### 1. Create Environment File

```bash
cp .env.example .env
# Edit .env with your values
```

### Required Secrets

| Variable | Description | How to Get |
|----------|-------------|------------|
| `ANTHROPIC_API_KEY` | Anthropic API key | [console.anthropic.com](https://console.anthropic.com/) |
| `GITHUB_TOKEN` | GitHub PAT with repo access | GitHub Settings → Developer settings → PATs |
| `JWT_SECRET` | API auth secret | `openssl rand -hex 32` |

### 2. Initialize Terraform

```bash
cd infrastructure/terraform/environments/dev

# Create terraform.tfvars
cat > terraform.tfvars << EOF
anthropic_api_key = "sk-ant-api03-..."
github_token      = "ghp_..."
jwt_secret        = "$(openssl rand -hex 32)"
EOF

terraform init
terraform plan
terraform apply
```

### 3. Build and Push Container Images

```bash
# Login to ACR
az acr login --name claudeswarmdevacr

# Build and push orchestrator
docker build -t claudeswarmdevacr.azurecr.io/claude-orchestrator:latest -f services/orchestrator/Dockerfile .
docker push claudeswarmdevacr.azurecr.io/claude-orchestrator:latest

# Build and push agent worker
docker build -t claudeswarmdevacr.azurecr.io/claude-agent-worker:latest -f services/agent-worker/Dockerfile .
docker push claudeswarmdevacr.azurecr.io/claude-agent-worker:latest
```

### 4. Configure CLI for Production

```bash
# Get orchestrator URL from Azure
ORCH_URL=$(az containerapp show -n claude-swarm-orchestrator -g claude-swarm --query "properties.configuration.ingress.fqdn" -o tsv)

npx swarm config --set orchestratorUrl=https://$ORCH_URL
npx swarm config --set authToken=<your-jwt-token>
```

---

## Environment Variables Reference

### Orchestrator

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `JWT_SECRET` | Yes | - | JWT signing secret |
| `AZURE_SERVICE_BUS_CONNECTION` | Yes* | - | Service Bus connection string |
| `AZURE_SUBSCRIPTION_ID` | Yes* | - | Azure subscription ID |
| `AZURE_RESOURCE_GROUP` | Yes* | - | Resource group name |
| `AZURE_CLIENT_ID` | Yes* | - | Managed identity client ID |
| `AGENT_JOB_NAME` | Yes* | - | Container Apps job name |
| `PORT` | No | 3000 | Server port |
| `REDIS_URL` | No | - | Redis for state persistence |
| `DAILY_BUDGET_CENTS` | No | 10000 | Daily budget limit |
| `WEEKLY_BUDGET_CENTS` | No | 50000 | Weekly budget limit |
| `MAX_PARALLEL_AGENTS` | No | 25 | Max concurrent agents |

*Required for production, not needed for dev server

### Agent Worker

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | Yes | - | Anthropic API key |
| `GITHUB_TOKEN` | Yes | - | GitHub access token |
| `AZURE_SERVICE_BUS_CONNECTION` | Yes | - | Service Bus connection |
| `STORAGE_ACCOUNT_URL` | Yes | - | Azure Storage URL |
| `TASK_JSON` | No | - | Task to execute (injected) |
| `AGENT_ID` | No | auto | Agent identifier |

---

## Architecture

```
┌─────────────┐      ┌──────────────────┐      ┌─────────────────┐
│   CLI       │─────▶│   Orchestrator   │─────▶│  Service Bus    │
│  (swarm)    │      │   (API + WS)     │      │  (Task Queue)   │
└─────────────┘      └──────────────────┘      └────────┬────────┘
                              │                          │
                              │                          ▼
                              │               ┌─────────────────┐
                              │               │  Agent Workers  │
                              │               │ (Container Jobs)│
                              │               └────────┬────────┘
                              │                        │
                              ▼                        ▼
                     ┌──────────────┐        ┌─────────────────┐
                     │    Redis     │        │  Blob Storage   │
                     │   (State)    │        │   (Results)     │
                     └──────────────┘        └─────────────────┘
```

## Troubleshooting

### "Authorization header required"
- Ensure you've set `SWARM_TOKEN` or configured `authToken` in CLI
- Verify token hasn't expired (default: 24h)

### "Invalid token"
- Ensure `JWT_SECRET` matches between token generation and server

### Tasks stuck in "pending"
- In production: Check Service Bus queues and Container Apps logs
- In dev mode: Check server console for errors
