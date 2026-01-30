# Development Environment Configuration
terraform {
  required_version = ">= 1.5.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.85"
    }
  }

  # Uncomment after bootstrap
  # backend "azurerm" {
  #   resource_group_name  = "claude-swarm-tfstate-rg"
  #   storage_account_name = "claudeswarmtfstate"
  #   container_name       = "tfstate"
  #   key                  = "dev.terraform.tfstate"
  # }
}

provider "azurerm" {
  skip_provider_registration = true
  features {
    resource_group {
      prevent_deletion_if_contains_resources = false
    }
  }
}

# ============================================================================
# Resource Group (using existing)
# ============================================================================

data "azurerm_resource_group" "main" {
  name = "claude-swarm"
}

# ============================================================================
# Networking
# ============================================================================

resource "azurerm_virtual_network" "main" {
  name                = "${var.project_name}-${var.environment}-vnet"
  location            = data.azurerm_resource_group.main.location
  resource_group_name = data.azurerm_resource_group.main.name
  address_space       = ["10.0.0.0/16"]

  tags = local.tags
}

resource "azurerm_subnet" "agents" {
  name                 = "agents-subnet"
  resource_group_name  = data.azurerm_resource_group.main.name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = ["10.0.1.0/24"]

  delegation {
    name = "container-apps"
    service_delegation {
      name    = "Microsoft.App/environments"
      actions = ["Microsoft.Network/virtualNetworks/subnets/join/action"]
    }
  }
}

# ============================================================================
# Storage
# ============================================================================

resource "azurerm_storage_account" "main" {
  name                     = "${replace(var.project_name, "-", "")}${var.environment}sa"
  resource_group_name      = data.azurerm_resource_group.main.name
  location                 = data.azurerm_resource_group.main.location
  account_tier             = "Standard"
  account_replication_type = "LRS"

  blob_properties {
    versioning_enabled = true
  }

  tags = local.tags
}

resource "azurerm_storage_container" "agent_state" {
  name                  = "agent-state"
  storage_account_name  = azurerm_storage_account.main.name
  container_access_type = "private"
}

resource "azurerm_storage_container" "task_results" {
  name                  = "task-results"
  storage_account_name  = azurerm_storage_account.main.name
  container_access_type = "private"
}

# ============================================================================
# Log Analytics
# ============================================================================

resource "azurerm_log_analytics_workspace" "main" {
  name                = "${var.project_name}-${var.environment}-logs"
  location            = data.azurerm_resource_group.main.location
  resource_group_name = data.azurerm_resource_group.main.name
  sku                 = "PerGB2018"
  retention_in_days   = 30

  tags = local.tags
}

# ============================================================================
# Container Registry
# ============================================================================

resource "azurerm_container_registry" "main" {
  name                = "${replace(var.project_name, "-", "")}${var.environment}acr"
  resource_group_name = data.azurerm_resource_group.main.name
  location            = data.azurerm_resource_group.main.location
  sku                 = "Basic"
  admin_enabled       = true

  tags = local.tags
}

# ============================================================================
# Agent Orchestration Module
# ============================================================================

data "azurerm_subscription" "current" {}

module "agent_orchestration" {
  source = "../../modules/agent-orchestration"

  project_name        = var.project_name
  location            = var.location
  resource_group_name = data.azurerm_resource_group.main.name
  subscription_id     = data.azurerm_subscription.current.subscription_id

  subnet_id                   = azurerm_subnet.agents.id
  container_registry_url      = azurerm_container_registry.main.login_server
  container_registry_username = azurerm_container_registry.main.admin_username
  container_registry_password = azurerm_container_registry.main.admin_password
  log_analytics_workspace_id  = azurerm_log_analytics_workspace.main.id
  storage_account_id         = azurerm_storage_account.main.id
  storage_account_url        = azurerm_storage_account.main.primary_blob_endpoint

  max_parallel_agents = var.max_parallel_agents
  daily_budget_cents  = var.daily_budget_cents
  weekly_budget_cents = var.weekly_budget_cents

  anthropic_api_key = var.anthropic_api_key
  github_token      = var.github_token

  tags = local.tags
}

# ============================================================================
# Local Values
# ============================================================================

locals {
  tags = merge(var.tags, {
    Environment = var.environment
    Project     = var.project_name
    ManagedBy   = "terraform"
  })
}
