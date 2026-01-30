variable "project_name" {
  description = "Project name used for resource naming"
  type        = string
  default     = "claude-swarm"
}

variable "location" {
  description = "Azure region for resources"
  type        = string
  default     = "eastus2"
}

variable "resource_group_name" {
  description = "Name of the resource group"
  type        = string
}

variable "subscription_id" {
  description = "Azure subscription ID"
  type        = string
}

variable "tags" {
  description = "Tags to apply to resources"
  type        = map(string)
  default     = {}
}

# Networking
variable "subnet_id" {
  description = "Subnet ID for Container Apps environment"
  type        = string
}

# Container Registry
variable "container_registry_url" {
  description = "URL of the container registry"
  type        = string
}

variable "container_registry_username" {
  description = "Container registry admin username"
  type        = string
}

variable "container_registry_password" {
  description = "Container registry admin password"
  type        = string
  sensitive   = true
}

variable "agent_image_tag" {
  description = "Tag for the agent worker image"
  type        = string
  default     = "latest"
}

variable "orchestrator_image_tag" {
  description = "Tag for the orchestrator image"
  type        = string
  default     = "latest"
}

# Agent Configuration
variable "max_parallel_agents" {
  description = "Maximum number of parallel agents"
  type        = number
  default     = 25
}

variable "agent_cpu" {
  description = "CPU allocation per agent (cores)"
  type        = number
  default     = 2.0
}

variable "agent_memory" {
  description = "Memory allocation per agent"
  type        = string
  default     = "4Gi"
}

variable "agent_timeout_seconds" {
  description = "Maximum execution time per agent in seconds"
  type        = number
  default     = 1800 # 30 minutes
}

variable "agent_retry_limit" {
  description = "Number of retry attempts for failed agents"
  type        = number
  default     = 2
}

# Budget Configuration
variable "daily_budget_cents" {
  description = "Daily budget limit in cents"
  type        = number
  default     = 10000 # $100
}

variable "weekly_budget_cents" {
  description = "Weekly budget limit in cents"
  type        = number
  default     = 50000 # $500
}

# Secrets (sensitive)
variable "anthropic_api_key" {
  description = "Anthropic API key"
  type        = string
  sensitive   = true
}

variable "github_token" {
  description = "GitHub personal access token"
  type        = string
  sensitive   = true
}

# External Resources
variable "log_analytics_workspace_id" {
  description = "Log Analytics workspace ID for monitoring"
  type        = string
}

variable "storage_account_id" {
  description = "Storage account ID for state storage"
  type        = string
}

variable "storage_account_url" {
  description = "Storage account blob URL"
  type        = string
}

variable "redis_url" {
  description = "Redis connection URL for coordination"
  type        = string
  default     = ""
}

# Logging
variable "log_level" {
  description = "Log level for agents"
  type        = string
  default     = "info"
}
