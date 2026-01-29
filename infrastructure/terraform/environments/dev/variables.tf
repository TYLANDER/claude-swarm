variable "project_name" {
  description = "Project name"
  type        = string
  default     = "claude-swarm"
}

variable "environment" {
  description = "Environment name"
  type        = string
  default     = "dev"
}

variable "location" {
  description = "Azure region"
  type        = string
  default     = "eastus2"
}

variable "tags" {
  description = "Additional tags"
  type        = map(string)
  default     = {}
}

variable "max_parallel_agents" {
  description = "Maximum parallel agents"
  type        = number
  default     = 10 # Lower for dev
}

variable "daily_budget_cents" {
  description = "Daily budget in cents"
  type        = number
  default     = 5000 # $50 for dev
}

variable "weekly_budget_cents" {
  description = "Weekly budget in cents"
  type        = number
  default     = 20000 # $200 for dev
}

variable "anthropic_api_key" {
  description = "Anthropic API key"
  type        = string
  sensitive   = true
}

variable "github_token" {
  description = "GitHub token"
  type        = string
  sensitive   = true
}
