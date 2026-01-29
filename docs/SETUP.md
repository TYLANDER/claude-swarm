# Claude Swarm Setup Guide

This guide walks you through setting up Claude Swarm for development and production.

## Prerequisites

- Node.js 22+
- npm 10+
- Terraform 1.6+
- Azure CLI (for deployment)
- GitHub CLI (for repository access)

## Local Development Setup

### 1. Clone and Install

```bash
git clone https://github.com/Ciaonet/claude-swarm.git
cd claude-swarm
npm install
```

### 2. Build Packages

```bash
npm run build
```

### 3. Run Type Checks

```bash
npm run type-check
```

## Azure Infrastructure Setup

### 1. Prerequisites

1. Azure subscription with Contributor access
2. Azure CLI installed and logged in (`az login`)
3. Terraform 1.6+ installed

### 2. Configure Secrets

Create `infrastructure/terraform/environments/dev/terraform.tfvars`:

```hcl
project_name = "claude-swarm"
environment  = "dev"
location     = "eastus2"

# Get from https://console.anthropic.com
anthropic_api_key = "sk-ant-..."

# GitHub personal access token with repo scope
github_token = "ghp_..."

# Optional: Adjust limits
max_parallel_agents = 10
daily_budget_cents  = 5000   # $50
weekly_budget_cents = 20000  # $200
```

### 3. Initialize Terraform

```bash
cd infrastructure/terraform/environments/dev
terraform init
```

### 4. Review Plan

```bash
terraform plan
```

### 5. Deploy Infrastructure

```bash
terraform apply
```

### 6. Note Outputs

After deployment, note these outputs:

- `orchestrator_url` - URL for the orchestrator API
- `container_registry_url` - ACR URL for pushing images

## GitHub Actions CI/CD Setup

### Required Secrets

Add these secrets to your GitHub repository (Settings → Secrets and variables → Actions):

| Secret              | Description                  | How to Get                   |
| ------------------- | ---------------------------- | ---------------------------- |
| `AZURE_CREDENTIALS` | Azure service principal JSON | See below                    |
| `ACR_LOGIN_SERVER`  | Container registry URL       | Terraform output             |
| `ACR_USERNAME`      | ACR admin username           | Terraform output             |
| `ACR_PASSWORD`      | ACR admin password           | Terraform output (sensitive) |
| `ANTHROPIC_API_KEY` | Claude API key               | console.anthropic.com        |
| `GH_TOKEN`          | GitHub PAT with repo scope   | github.com/settings/tokens   |

### Creating Azure Service Principal

```bash
az ad sp create-for-rbac \
  --name "claude-swarm-github" \
  --role contributor \
  --scopes /subscriptions/{subscription-id}/resourceGroups/claude-swarm-dev-rg \
  --sdk-auth
```

Copy the JSON output to `AZURE_CREDENTIALS` secret.

### Getting ACR Credentials

```bash
# After terraform apply
cd infrastructure/terraform/environments/dev

terraform output container_registry_url
terraform output container_registry_admin_username
terraform output -raw container_registry_admin_password
```

## CLI Configuration

After infrastructure is deployed, configure the CLI:

```bash
# Install CLI globally (from repo root)
npm run build
npm link packages/cli

# Configure orchestrator URL
swarm config --set orchestratorUrl=https://your-orchestrator-url.azurecontainerapps.io

# Verify connection
swarm budget
```

## Production Deployment

### 1. Create Production Environment

```bash
cp -r infrastructure/terraform/environments/dev infrastructure/terraform/environments/production
```

### 2. Update Production Variables

Edit `infrastructure/terraform/environments/production/variables.tf`:

- Increase `max_parallel_agents` to 25
- Adjust budget limits as needed

### 3. Enable Remote State

Uncomment the backend configuration in `main.tf` and run:

```bash
terraform init -migrate-state
```

### 4. Deploy

```bash
terraform apply
```

## Troubleshooting

### Terraform State Lock

If you see state lock errors:

```bash
terraform force-unlock <lock-id>
```

### Container Apps Job Not Starting

Check logs:

```bash
az containerapp job logs show \
  --name claude-swarm-agent-worker \
  --resource-group claude-swarm-dev-rg
```

### Service Bus Connection Issues

Verify connection string:

```bash
az servicebus namespace authorization-rule keys list \
  --resource-group claude-swarm-dev-rg \
  --namespace-name claude-swarm-sb \
  --name RootManageSharedAccessKey
```

## Next Steps

- Read the [Architecture Guide](./ARCHITECTURE.md)
- See [CLI Usage](./CLI.md) for submitting tasks
- Check [Cost Management](./COSTS.md) for budget optimization
