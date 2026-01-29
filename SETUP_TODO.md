# Setup TODO

Personal checklist for completing Claude Swarm setup. Check off items as you complete them.

---

## Phase 1: Local Development (No Secrets Needed)

These work right now:

- [ ] `npm install` - Install dependencies
- [ ] `npm run build` - Build all packages
- [ ] `npm run type-check` - Verify TypeScript
- [ ] `npm run lint` - Check code quality

---

## Phase 2: Azure Infrastructure

### Prerequisites

- [ ] Azure subscription with Contributor access
- [ ] Azure CLI installed (`brew install azure-cli`)
- [ ] Logged in (`az login`)
- [ ] Terraform installed (`brew install terraform`)

### Configure Terraform Variables

```bash
cd infrastructure/terraform/environments/dev
cp terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars` and add:

```hcl
# From https://console.anthropic.com/settings/keys
anthropic_api_key = "sk-ant-api03-..."

# From https://github.com/settings/tokens (needs repo scope)
github_token = "ghp_..."
```

### Deploy Infrastructure

```bash
terraform init
terraform plan      # Review what will be created
terraform apply     # Deploy (type 'yes' to confirm)
```

### Save Outputs

After deploy, save these values (you'll need them for GitHub secrets):

```bash
terraform output orchestrator_url
terraform output container_registry_url
terraform output container_registry_admin_username
terraform output -raw container_registry_admin_password > /tmp/acr-password.txt
```

---

## Phase 3: GitHub Actions CI/CD

Go to: https://github.com/Ciaonet/claude-swarm/settings/secrets/actions

Add these repository secrets:

| Secret              | Value                          | How to Get                                                |
| ------------------- | ------------------------------ | --------------------------------------------------------- |
| `ANTHROPIC_API_KEY` | `sk-ant-api03-...`             | console.anthropic.com                                     |
| `GH_TOKEN`          | `ghp_...`                      | github.com/settings/tokens                                |
| `ACR_LOGIN_SERVER`  | `claudeswarmdevacr.azurecr.io` | `terraform output container_registry_url`                 |
| `ACR_USERNAME`      | `claudeswarmdevacr`            | `terraform output container_registry_admin_username`      |
| `ACR_PASSWORD`      | (long string)                  | `terraform output -raw container_registry_admin_password` |
| `AZURE_CREDENTIALS` | (JSON blob)                    | See below                                                 |

### Create Azure Service Principal

```bash
# Replace {subscription-id} with your actual subscription ID
az ad sp create-for-rbac \
  --name "claude-swarm-github" \
  --role contributor \
  --scopes /subscriptions/{subscription-id}/resourceGroups/claude-swarm-dev-rg \
  --sdk-auth
```

Copy the entire JSON output to the `AZURE_CREDENTIALS` secret.

---

## Phase 4: CLI Configuration

After infrastructure is deployed:

```bash
# Get the orchestrator URL
cd infrastructure/terraform/environments/dev
ORCH_URL=$(terraform output -raw orchestrator_url)

# Configure CLI
swarm config --set orchestratorUrl=$ORCH_URL

# Test connection
swarm budget
```

---

## Phase 5: Test End-to-End

```bash
# Submit a simple task
swarm submit -p "Add a hello world endpoint to the API" --branch test-swarm

# Watch progress
swarm watch

# Check results
swarm status <task-id>
```

---

## Quick Reference

### Terraform Commands

```bash
cd infrastructure/terraform/environments/dev
terraform init          # First time only
terraform plan          # Preview changes
terraform apply         # Deploy
terraform output        # Show outputs
terraform destroy       # Tear down (careful!)
```

### CLI Commands

```bash
swarm submit -p "prompt"     # Submit task
swarm submit -f file.json    # Submit from file
swarm status <id>            # Check task
swarm agents                 # List agents
swarm budget                 # Check budget
swarm watch                  # Live updates
swarm config --list          # View config
```

### Useful Azure CLI Commands

```bash
az login                                    # Login to Azure
az account show                             # Current subscription
az group list -o table                      # List resource groups
az containerapp job list -g claude-swarm-dev-rg  # List jobs
az containerapp logs show -n claude-swarm-orchestrator -g claude-swarm-dev-rg  # View logs
```

---

## Estimated Costs

| Resource             | Monthly Cost   |
| -------------------- | -------------- |
| Azure Container Apps | $50-150        |
| Azure Service Bus    | $10-25         |
| Azure Storage        | $5-15          |
| Azure Log Analytics  | $20-50         |
| **Claude API**       | **$800-2000**  |
| **Total**            | **~$900-2200** |

> Note: Claude API tokens are ~90% of the cost. Container compute is minimal.

---

## Troubleshooting

### Terraform state lock error

```bash
terraform force-unlock <lock-id>
```

### Can't connect to orchestrator

```bash
# Check if it's running
az containerapp show -n claude-swarm-orchestrator -g claude-swarm-dev-rg --query "properties.runningStatus"

# Check logs
az containerapp logs show -n claude-swarm-orchestrator -g claude-swarm-dev-rg
```

### GitHub Actions failing

- Check secrets are set correctly (no trailing whitespace)
- Verify AZURE_CREDENTIALS is valid JSON
- Check ACR credentials match terraform output
