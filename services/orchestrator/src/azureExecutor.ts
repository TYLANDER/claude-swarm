/**
 * Azure Container Apps Job executor for running Claude agents
 * Spawns real Azure Container Apps Jobs to execute tasks
 */

import { ContainerAppsAPIClient } from '@azure/arm-appcontainers';
import { DefaultAzureCredential } from '@azure/identity';
import type { AgentTask } from '@claude-swarm/types';

export interface AzureExecutorConfig {
  subscriptionId: string;
  resourceGroup: string;
  containerAppsEnvironment: string;
  agentJobName: string;
  anthropicApiKey: string;
  containerImage: string;
}

export interface ExecutionResult {
  jobExecutionId: string;
  agentId: string;
}

// Task type to resource tier mapping
type ResourceTier = 'light' | 'standard' | 'heavy';

const RESOURCE_TIERS: Record<ResourceTier, { cpu: number; memory: string }> = {
  light: { cpu: 0.5, memory: '1Gi' },
  standard: { cpu: 1.0, memory: '2Gi' },
  heavy: { cpu: 2.0, memory: '4Gi' },
};

function getResourceTier(task: AgentTask): ResourceTier {
  // Heavy: security scans, complex code with many dependencies
  if (task.type === 'security') return 'heavy';
  if (task.model === 'opus' && task.type === 'code') return 'heavy';

  // Light: documentation, simple reviews
  if (task.type === 'doc') return 'light';
  if (task.type === 'review' && (task.context.files?.length || 0) < 3) return 'light';

  // Standard: everything else
  return 'standard';
}

export class AzureExecutor {
  private client: ContainerAppsAPIClient;
  private config: AzureExecutorConfig;
  private activeJobs: Map<string, { taskId: string; startTime: Date }> = new Map();

  constructor(config: AzureExecutorConfig) {
    this.config = config;
    const credential = new DefaultAzureCredential();
    this.client = new ContainerAppsAPIClient(credential, config.subscriptionId);
  }

  /**
   * Spawn a new Container Apps Job execution for a task
   */
  async executeTask(task: AgentTask): Promise<ExecutionResult> {
    const tier = getResourceTier(task);
    const resources = RESOURCE_TIERS[tier];
    const agentId = `agent-${task.id.slice(0, 8)}`;

    console.log(`🚀 Spawning Azure job for task ${task.id} (${tier} tier)`);

    try {
      // Start job execution with task-specific configuration
      const execution = await this.client.jobs.beginStartAndWait(
        this.config.resourceGroup,
        this.config.agentJobName,
        {
          template: {
            containers: [
              {
                name: 'claude-agent',
                image: this.config.containerImage,
                env: [
                  { name: 'TASK_ID', value: task.id },
                  { name: 'TASK_JSON', value: JSON.stringify(task) },
                  { name: 'ANTHROPIC_API_KEY', value: this.config.anthropicApiKey },
                  { name: 'MODEL', value: task.model },
                  { name: 'AGENT_ID', value: agentId },
                ],
                resources: {
                  cpu: resources.cpu,
                  memory: resources.memory,
                },
              },
            ],
          },
        }
      );

      const executionId = execution.name || `exec-${Date.now()}`;

      // Track active job
      this.activeJobs.set(executionId, {
        taskId: task.id,
        startTime: new Date(),
      });

      console.log(`✓ Job started: ${executionId} for task ${task.id}`);

      return {
        jobExecutionId: executionId,
        agentId,
      };
    } catch (error) {
      console.error(`✗ Failed to spawn job for task ${task.id}:`, error);
      throw error;
    }
  }

  /**
   * Check the status of a running job execution
   */
  async getExecutionStatus(
    executionId: string
  ): Promise<'pending' | 'running' | 'completed' | 'failed'> {
    try {
      // List executions and find the one we're looking for
      const executions = this.client.jobsExecutions.list(
        this.config.resourceGroup,
        this.config.agentJobName
      );

      for await (const execution of executions) {
        if (execution.name === executionId) {
          const status = execution.status?.toLowerCase();
          if (status === 'succeeded') return 'completed';
          if (status === 'failed') return 'failed';
          if (status === 'running') return 'running';
          return 'pending';
        }
      }

      // Not found - assume completed (may have been cleaned up)
      return 'completed';
    } catch (error) {
      console.error(`Failed to get execution status for ${executionId}:`, error);
      return 'failed';
    }
  }

  /**
   * Poll for job completion (used when Service Bus is not available)
   */
  async waitForCompletion(
    executionId: string,
    timeoutMs: number = 30 * 60 * 1000 // 30 minutes default
  ): Promise<{ status: 'completed' | 'failed' | 'timeout' }> {
    const startTime = Date.now();
    const pollIntervalMs = 5000; // 5 seconds

    while (Date.now() - startTime < timeoutMs) {
      const status = await this.getExecutionStatus(executionId);

      if (status === 'completed') {
        this.activeJobs.delete(executionId);
        return { status: 'completed' };
      }

      if (status === 'failed') {
        this.activeJobs.delete(executionId);
        return { status: 'failed' };
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    return { status: 'timeout' };
  }

  /**
   * Cancel a running job execution
   */
  async cancelExecution(executionId: string): Promise<void> {
    try {
      // Container Apps Jobs don't have a direct cancel API
      // We would need to delete the execution or wait for timeout
      console.log(`⚠ Cancellation requested for ${executionId} (manual cleanup may be needed)`);
      this.activeJobs.delete(executionId);
    } catch (error) {
      console.error(`Failed to cancel execution ${executionId}:`, error);
    }
  }

  /**
   * Get count of currently active job executions
   */
  getActiveJobCount(): number {
    return this.activeJobs.size;
  }

  /**
   * List all active job executions
   */
  getActiveJobs(): Array<{ executionId: string; taskId: string; startTime: Date }> {
    return Array.from(this.activeJobs.entries()).map(([executionId, data]) => ({
      executionId,
      ...data,
    }));
  }
}

/**
 * Mock executor for testing without Azure (simulate mode)
 */
export class MockAzureExecutor {
  private activeJobs: Map<string, { taskId: string; startTime: Date; completeAt: Date }> =
    new Map();

  async executeTask(task: AgentTask): Promise<ExecutionResult> {
    const executionId = `mock-exec-${Date.now()}`;
    const agentId = `sim-agent-${task.id.slice(0, 8)}`;

    // Simulate variable execution time based on task type
    const durationMs =
      task.type === 'doc'
        ? 2000
        : task.type === 'test'
          ? 5000
          : task.type === 'security'
            ? 8000
            : 3000;

    this.activeJobs.set(executionId, {
      taskId: task.id,
      startTime: new Date(),
      completeAt: new Date(Date.now() + durationMs),
    });

    console.log(`🎭 [SIMULATE] Job started: ${executionId} for task ${task.id}`);

    return { jobExecutionId: executionId, agentId };
  }

  async getExecutionStatus(
    executionId: string
  ): Promise<'pending' | 'running' | 'completed' | 'failed'> {
    const job = this.activeJobs.get(executionId);
    if (!job) return 'completed';

    if (new Date() >= job.completeAt) {
      return 'completed';
    }
    return 'running';
  }

  async waitForCompletion(
    executionId: string,
    _timeoutMs?: number
  ): Promise<{ status: 'completed' | 'failed' | 'timeout' }> {
    const job = this.activeJobs.get(executionId);
    if (!job) return { status: 'completed' };

    const waitTime = job.completeAt.getTime() - Date.now();
    if (waitTime > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }

    this.activeJobs.delete(executionId);
    console.log(`🎭 [SIMULATE] Job completed: ${executionId}`);
    return { status: 'completed' };
  }

  async cancelExecution(executionId: string): Promise<void> {
    this.activeJobs.delete(executionId);
    console.log(`🎭 [SIMULATE] Job cancelled: ${executionId}`);
  }

  getActiveJobCount(): number {
    return this.activeJobs.size;
  }

  getActiveJobs(): Array<{ executionId: string; taskId: string; startTime: Date }> {
    return Array.from(this.activeJobs.entries()).map(([executionId, data]) => ({
      executionId,
      taskId: data.taskId,
      startTime: data.startTime,
    }));
  }
}

/**
 * Create the appropriate executor based on mode
 */
export function createExecutor(
  config: AzureExecutorConfig | null,
  simulateMode: boolean
): AzureExecutor | MockAzureExecutor {
  if (simulateMode || !config) {
    console.log('📋 Running in simulate mode (no Azure resources used)');
    return new MockAzureExecutor();
  }

  console.log('☁️ Running with Azure Container Apps Jobs');
  return new AzureExecutor(config);
}
