output "environment_id" {
  description = "Container Apps environment ID"
  value       = azurerm_container_app_environment.agents.id
}

output "orchestrator_url" {
  description = "Orchestrator service URL"
  value       = "https://${azurerm_container_app.orchestrator.ingress[0].fqdn}"
}

output "agent_job_id" {
  description = "Agent worker job ID"
  value       = azurerm_container_app_job.agent_worker.id
}

output "agent_job_name" {
  description = "Agent worker job name"
  value       = azurerm_container_app_job.agent_worker.name
}

output "service_bus_namespace" {
  description = "Service Bus namespace name"
  value       = azurerm_servicebus_namespace.main.name
}

output "service_bus_connection_string" {
  description = "Service Bus connection string"
  value       = azurerm_servicebus_namespace.main.default_primary_connection_string
  sensitive   = true
}

output "task_queue_name" {
  description = "Task queue name"
  value       = azurerm_servicebus_queue.tasks.name
}

output "result_queue_name" {
  description = "Result queue name"
  value       = azurerm_servicebus_queue.results.name
}

output "agent_identity_id" {
  description = "Agent managed identity ID"
  value       = azurerm_user_assigned_identity.agent.id
}

output "agent_identity_principal_id" {
  description = "Agent managed identity principal ID"
  value       = azurerm_user_assigned_identity.agent.principal_id
}

output "orchestrator_identity_id" {
  description = "Orchestrator managed identity ID"
  value       = azurerm_user_assigned_identity.orchestrator.id
}

output "orchestrator_identity_principal_id" {
  description = "Orchestrator managed identity principal ID"
  value       = azurerm_user_assigned_identity.orchestrator.principal_id
}
