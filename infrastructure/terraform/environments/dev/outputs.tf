output "resource_group_name" {
  description = "Resource group name"
  value       = azurerm_resource_group.main.name
}

output "orchestrator_url" {
  description = "Orchestrator service URL"
  value       = module.agent_orchestration.orchestrator_url
}

output "container_registry_url" {
  description = "Container registry URL"
  value       = azurerm_container_registry.main.login_server
}

output "container_registry_admin_username" {
  description = "Container registry admin username"
  value       = azurerm_container_registry.main.admin_username
}

output "container_registry_admin_password" {
  description = "Container registry admin password"
  value       = azurerm_container_registry.main.admin_password
  sensitive   = true
}

output "storage_account_name" {
  description = "Storage account name"
  value       = azurerm_storage_account.main.name
}

output "service_bus_connection_string" {
  description = "Service Bus connection string"
  value       = module.agent_orchestration.service_bus_connection_string
  sensitive   = true
}
