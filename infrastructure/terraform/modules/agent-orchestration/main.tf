# Agent Orchestration Infrastructure
# Azure Container Apps Jobs for worker agents + Service Bus for task queue

terraform {
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.85"
    }
  }
}

# ============================================================================
# Container Apps Environment
# ============================================================================

resource "azurerm_container_app_environment" "agents" {
  name                       = "${var.project_name}-agents-env"
  location                   = var.location
  resource_group_name        = var.resource_group_name
  log_analytics_workspace_id = var.log_analytics_workspace_id

  infrastructure_subnet_id = var.subnet_id

  tags = var.tags
}

# ============================================================================
# Container Apps Job - Agent Worker
# ============================================================================

resource "azurerm_container_app_job" "agent_worker" {
  name                         = "${var.project_name}-agent-worker"
  location                     = var.location
  resource_group_name          = var.resource_group_name
  container_app_environment_id = azurerm_container_app_environment.agents.id

  replica_timeout_in_seconds = var.agent_timeout_seconds
  replica_retry_limit        = var.agent_retry_limit

  # Manual trigger - orchestrator spawns agents via API
  manual_trigger_config {
    parallelism              = var.max_parallel_agents
    replica_completion_count = 1
  }

  registry {
    server               = var.container_registry_url
    username             = var.container_registry_username
    password_secret_name = "acr-password"
  }

  template {
    container {
      name   = "claude-agent"
      image  = "${var.container_registry_url}/claude-agent-worker:${var.agent_image_tag}"
      cpu    = var.agent_cpu
      memory = var.agent_memory

      env {
        name        = "ANTHROPIC_API_KEY"
        secret_name = "anthropic-api-key"
      }

      env {
        name        = "GITHUB_TOKEN"
        secret_name = "github-token"
      }

      env {
        name  = "AZURE_SERVICE_BUS_CONNECTION"
        value = azurerm_servicebus_namespace.main.default_primary_connection_string
      }

      env {
        name  = "TASK_QUEUE_NAME"
        value = azurerm_servicebus_queue.tasks.name
      }

      env {
        name  = "RESULT_QUEUE_NAME"
        value = azurerm_servicebus_queue.results.name
      }

      env {
        name  = "STORAGE_ACCOUNT_URL"
        value = var.storage_account_url
      }

      env {
        name  = "LOG_LEVEL"
        value = var.log_level
      }

      env {
        name  = "APPLICATIONINSIGHTS_CONNECTION_STRING"
        value = azurerm_application_insights.main.connection_string
      }
    }
  }

  secret {
    name                = "anthropic-api-key"
    key_vault_secret_id = azurerm_key_vault_secret.anthropic_api_key.id
    identity            = azurerm_user_assigned_identity.agent.id
  }

  secret {
    name                = "github-token"
    key_vault_secret_id = azurerm_key_vault_secret.github_token.id
    identity            = azurerm_user_assigned_identity.agent.id
  }

  secret {
    name  = "acr-password"
    value = var.container_registry_password
  }

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.agent.id]
  }

  tags = var.tags
}

# ============================================================================
# Container App - Orchestrator Service
# ============================================================================

resource "azurerm_container_app" "orchestrator" {
  name                         = "${var.project_name}-orchestrator"
  resource_group_name          = var.resource_group_name
  container_app_environment_id = azurerm_container_app_environment.agents.id
  revision_mode                = "Single"

  registry {
    server               = var.container_registry_url
    username             = var.container_registry_username
    password_secret_name = "acr-password"
  }

  template {
    min_replicas = 1
    max_replicas = 3

    container {
      name   = "orchestrator"
      image  = "${var.container_registry_url}/claude-orchestrator:${var.orchestrator_image_tag}"
      cpu    = 1.0
      memory = "2Gi"

      env {
        name        = "ANTHROPIC_API_KEY"
        secret_name = "anthropic-api-key"
      }

      env {
        name        = "GITHUB_TOKEN"
        secret_name = "github-token"
      }

      env {
        name  = "AZURE_SERVICE_BUS_CONNECTION"
        value = azurerm_servicebus_namespace.main.default_primary_connection_string
      }

      env {
        name  = "REDIS_URL"
        value = var.redis_url
      }

      env {
        name  = "STORAGE_ACCOUNT_URL"
        value = var.storage_account_url
      }

      env {
        name  = "AGENT_JOB_NAME"
        value = azurerm_container_app_job.agent_worker.name
      }

      env {
        name  = "MAX_PARALLEL_AGENTS"
        value = tostring(var.max_parallel_agents)
      }

      env {
        name  = "DAILY_BUDGET_CENTS"
        value = tostring(var.daily_budget_cents)
      }

      env {
        name  = "WEEKLY_BUDGET_CENTS"
        value = tostring(var.weekly_budget_cents)
      }

      env {
        name  = "AZURE_SUBSCRIPTION_ID"
        value = var.subscription_id
      }

      env {
        name  = "AZURE_RESOURCE_GROUP"
        value = var.resource_group_name
      }

      env {
        name  = "AZURE_CLIENT_ID"
        value = azurerm_user_assigned_identity.orchestrator.client_id
      }

      env {
        name  = "CONTAINER_APPS_ENV"
        value = azurerm_container_app_environment.agents.name
      }

      env {
        name  = "CONTAINER_IMAGE"
        value = "${var.container_registry_url}/claude-agent-worker:${var.agent_image_tag}"
      }

      env {
        name        = "JWT_SECRET"
        secret_name = "jwt-secret"
      }

      env {
        name  = "APPLICATIONINSIGHTS_CONNECTION_STRING"
        value = azurerm_application_insights.main.connection_string
      }
    }
  }

  secret {
    name                = "anthropic-api-key"
    key_vault_secret_id = azurerm_key_vault_secret.anthropic_api_key.id
    identity            = azurerm_user_assigned_identity.orchestrator.id
  }

  secret {
    name                = "github-token"
    key_vault_secret_id = azurerm_key_vault_secret.github_token.id
    identity            = azurerm_user_assigned_identity.orchestrator.id
  }

  secret {
    name                = "jwt-secret"
    key_vault_secret_id = azurerm_key_vault_secret.jwt_secret.id
    identity            = azurerm_user_assigned_identity.orchestrator.id
  }

  secret {
    name  = "acr-password"
    value = var.container_registry_password
  }

  ingress {
    external_enabled = true
    target_port      = 3000

    traffic_weight {
      percentage      = 100
      latest_revision = true
    }
  }

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.orchestrator.id]
  }

  tags = var.tags
}

# ============================================================================
# Service Bus - Task Queue
# ============================================================================

resource "azurerm_servicebus_namespace" "main" {
  name                = "${var.project_name}-bus-${var.name_suffix}"
  location            = var.location
  resource_group_name = var.resource_group_name
  sku                 = "Standard"

  tags = var.tags
}

resource "azurerm_servicebus_queue" "tasks_high" {
  name         = "agent-tasks-high"
  namespace_id = azurerm_servicebus_namespace.main.id

  max_delivery_count        = 3
  default_message_ttl       = "P1D" # 1 day
  lock_duration             = "PT5M" # 5 minutes
  dead_lettering_on_message_expiration = true
}

resource "azurerm_servicebus_queue" "tasks" {
  name         = "agent-tasks"
  namespace_id = azurerm_servicebus_namespace.main.id

  max_delivery_count        = 3
  default_message_ttl       = "P1D"
  lock_duration             = "PT5M"
  dead_lettering_on_message_expiration = true
}

resource "azurerm_servicebus_queue" "tasks_low" {
  name         = "agent-tasks-low"
  namespace_id = azurerm_servicebus_namespace.main.id

  max_delivery_count        = 3
  default_message_ttl       = "P7D" # 7 days for low priority
  lock_duration             = "PT5M"
  dead_lettering_on_message_expiration = true
}

resource "azurerm_servicebus_queue" "results" {
  name         = "agent-results"
  namespace_id = azurerm_servicebus_namespace.main.id

  max_delivery_count  = 5
  default_message_ttl = "P7D"
  lock_duration       = "PT1M"
}

resource "azurerm_servicebus_queue" "deadletter" {
  name         = "agent-deadletter"
  namespace_id = azurerm_servicebus_namespace.main.id

  default_message_ttl = "P30D"
}

# ============================================================================
# Managed Identities
# ============================================================================

resource "azurerm_user_assigned_identity" "agent" {
  name                = "${var.project_name}-agent-identity"
  location            = var.location
  resource_group_name = var.resource_group_name

  tags = var.tags
}

resource "azurerm_user_assigned_identity" "orchestrator" {
  name                = "${var.project_name}-orchestrator-identity"
  location            = var.location
  resource_group_name = var.resource_group_name

  tags = var.tags
}

# ============================================================================
# Role Assignments
# ============================================================================

# Orchestrator can manage Container Apps Jobs
resource "azurerm_role_assignment" "orchestrator_contributor" {
  scope                = azurerm_container_app_job.agent_worker.id
  role_definition_name = "Contributor"
  principal_id         = azurerm_user_assigned_identity.orchestrator.principal_id
}

# Agents can read/write to storage
resource "azurerm_role_assignment" "agent_storage_contributor" {
  scope                = var.storage_account_id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azurerm_user_assigned_identity.agent.principal_id
}

# Orchestrator can read/write to storage
resource "azurerm_role_assignment" "orchestrator_storage_contributor" {
  scope                = var.storage_account_id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azurerm_user_assigned_identity.orchestrator.principal_id
}
