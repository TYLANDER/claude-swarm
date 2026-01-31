# ============================================================================
# Azure Application Insights for Observability
# ============================================================================

resource "azurerm_application_insights" "main" {
  name                = "${var.project_name}-insights"
  location            = var.location
  resource_group_name = var.resource_group_name
  workspace_id        = var.log_analytics_workspace_id
  application_type    = "Node.JS"

  # Sampling for cost control in high-volume scenarios
  sampling_percentage = var.app_insights_sampling_percentage

  # Disable IP masking to see full client IPs (optional)
  disable_ip_masking = false

  tags = var.tags
}

# ============================================================================
# Outputs for connecting services
# ============================================================================

output "app_insights_connection_string" {
  description = "Application Insights connection string"
  value       = azurerm_application_insights.main.connection_string
  sensitive   = true
}

output "app_insights_instrumentation_key" {
  description = "Application Insights instrumentation key (deprecated, use connection string)"
  value       = azurerm_application_insights.main.instrumentation_key
  sensitive   = true
}
