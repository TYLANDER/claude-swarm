/**
 * Fly.io Machines executor for running Claude agents
 * Spawns ephemeral Fly Machines via REST API (~300ms boot time)
 *
 * @see https://fly.io/docs/machines/api/
 */

import type { AgentTask } from '@claude-swarm/types';
import type {
  Executor,
  ExecutionResult,
  ExecutionStatus,
  ExecutorResult,
  ActiveJob,
  ResourceTier,
} from './types.js';
import { RESOURCE_TIERS, getResourceTier } from './types.js';

/** Configuration for Fly.io executor */
export interface FlyExecutorConfig {
  /** Fly.io API token (from `fly tokens create deploy`) */
  apiToken: string;
  /** Fly App name for worker machines */
  appName: string;
  /** Container image path (e.g., registry.fly.io/myapp:latest) */
  containerImage: string;
  /** Anthropic API key to inject into workers */
  anthropicApiKey: string;
  /** GitHub token for git operations (optional) */
  githubToken?: string;
  /** Preferred region (default: ord - Chicago) */
  region?: string;
  /** API base URL (default: https://api.machines.dev) */
  apiBaseUrl?: string;
}

/** Fly Machine state from API */
type FlyMachineState =
  | 'created'
  | 'starting'
  | 'started'
  | 'stopping'
  | 'stopped'
  | 'replacing'
  | 'destroying'
  | 'destroyed';

/** Fly Machine API response */
interface FlyMachine {
  id: string;
  name: string;
  state: FlyMachineState;
  region: string;
  created_at: string;
  updated_at: string;
}

/** Fly.io resource specs format */
interface FlyGuestConfig {
  cpus: number;
  memory_mb: number;
  cpu_kind?: 'shared' | 'performance';
}

/**
 * Convert our resource tier to Fly.io guest config
 */
function toFlyGuest(tier: ResourceTier): FlyGuestConfig {
  const spec = RESOURCE_TIERS[tier];
  return {
    cpus: spec.cpu,
    memory_mb: spec.memoryMb,
    cpu_kind: tier === 'heavy' ? 'performance' : 'shared',
  };
}

/**
 * Fly.io Machines executor implementation
 */
export class FlyExecutor implements Executor {
  private config: FlyExecutorConfig;
  private activeJobs: Map<string, { taskId: string; startTime: Date }> = new Map();
  private baseUrl: string;

  constructor(config: FlyExecutorConfig) {
    this.config = config;
    this.baseUrl = config.apiBaseUrl || 'https://api.machines.dev';
  }

  /**
   * Make authenticated request to Fly Machines API
   */
  private async flyApi<T = unknown>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: object
  ): Promise<T> {
    const url = `${this.baseUrl}/v1/apps/${this.config.appName}${path}`;

    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.config.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Fly API error ${response.status}: ${errorText}`);
    }

    // Some endpoints return no content
    const text = await response.text();
    return text ? JSON.parse(text) : ({} as T);
  }

  /**
   * Spawn a Fly Machine to execute a task
   */
  async executeTask(task: AgentTask): Promise<ExecutionResult> {
    const tier = getResourceTier(task);
    const guest = toFlyGuest(tier);
    const agentId = `fly-agent-${task.id.slice(0, 8)}`;
    const machineName = `task-${task.id.slice(0, 8)}-${Date.now()}`;

    console.log(
      `🪰 Spawning Fly Machine for task ${task.id} (${tier} tier, ${this.config.region || 'ord'})`
    );

    const machine = await this.flyApi<FlyMachine>('POST', '/machines', {
      name: machineName,
      region: this.config.region || 'ord',
      config: {
        image: this.config.containerImage,
        env: {
          // Task configuration
          TASK_ID: task.id,
          TASK_JSON: JSON.stringify(task),
          AGENT_ID: agentId,
          MODEL: task.model,
          // Credentials
          ANTHROPIC_API_KEY: this.config.anthropicApiKey,
          GITHUB_TOKEN: this.config.githubToken || '',
          // Disable Azure services (worker will use stdout mode)
          AZURE_SERVICE_BUS_CONNECTION: '',
          STORAGE_ACCOUNT_URL: '',
        },
        guest,
        auto_destroy: true, // Clean up after process exits
        restart: {
          policy: 'no', // Don't restart - one-shot execution
        },
      },
    });

    const executionId = machine.id;

    this.activeJobs.set(executionId, {
      taskId: task.id,
      startTime: new Date(),
    });

    console.log(`✓ Fly Machine started: ${executionId} (${machine.state}) for task ${task.id}`);

    return { jobExecutionId: executionId, agentId };
  }

  /**
   * Get current status of a machine
   */
  async getExecutionStatus(executionId: string): Promise<ExecutionStatus> {
    try {
      const machine = await this.flyApi<FlyMachine>('GET', `/machines/${executionId}`);

      switch (machine.state) {
        case 'created':
        case 'starting':
          return 'pending';
        case 'started':
          return 'running';
        case 'stopping':
        case 'stopped':
        case 'destroying':
        case 'destroyed':
          return 'completed';
        case 'replacing':
          return 'running';
        default:
          return 'failed';
      }
    } catch (error) {
      // Machine not found usually means it was destroyed (completed)
      if (error instanceof Error && error.message.includes('404')) {
        return 'completed';
      }
      console.error(`Failed to get machine status for ${executionId}:`, error);
      return 'failed';
    }
  }

  /**
   * Wait for machine to complete execution
   * Uses Fly's /wait endpoint which blocks until state change
   */
  async waitForCompletion(
    executionId: string,
    timeoutMs: number = 30 * 60 * 1000
  ): Promise<ExecutorResult> {
    const timeoutSeconds = Math.floor(timeoutMs / 1000);

    try {
      // Fly's wait endpoint blocks until the machine reaches the target state
      // We wait for 'stopped' which means the process exited
      await this.flyApi(
        'GET',
        `/machines/${executionId}/wait?state=stopped&timeout=${timeoutSeconds}`
      );

      this.activeJobs.delete(executionId);
      console.log(`✓ Fly Machine completed: ${executionId}`);

      // TODO: Optionally fetch logs to parse result
      // const logs = await this.fetchMachineLogs(executionId);
      // const output = this.parseResultFromLogs(logs);

      return { status: 'completed' };
    } catch (error) {
      this.activeJobs.delete(executionId);

      if (error instanceof Error) {
        // Timeout from Fly API
        if (error.message.includes('408') || error.message.includes('timeout')) {
          console.log(`⏱ Fly Machine timed out: ${executionId}`);
          return { status: 'timeout' };
        }
        // Machine was destroyed before we could wait (still counts as completed)
        if (error.message.includes('404')) {
          console.log(`✓ Fly Machine already completed: ${executionId}`);
          return { status: 'completed' };
        }
      }

      console.error(`✗ Fly Machine failed: ${executionId}`, error);
      return { status: 'failed' };
    }
  }

  /**
   * Stop a running machine
   */
  async cancelExecution(executionId: string): Promise<void> {
    try {
      await this.flyApi('POST', `/machines/${executionId}/stop`);
      this.activeJobs.delete(executionId);
      console.log(`⏹ Fly Machine stopped: ${executionId}`);
    } catch (error) {
      // Machine may already be stopped/destroyed
      if (error instanceof Error && !error.message.includes('404')) {
        console.error(`Failed to stop machine ${executionId}:`, error);
      }
      this.activeJobs.delete(executionId);
    }
  }

  /**
   * Get count of active machines
   */
  getActiveJobCount(): number {
    return this.activeJobs.size;
  }

  /**
   * List all active machines
   */
  getActiveJobs(): ActiveJob[] {
    return Array.from(this.activeJobs.entries()).map(([executionId, data]) => ({
      executionId,
      taskId: data.taskId,
      startTime: data.startTime,
    }));
  }

  /**
   * Fetch logs from a machine (for result parsing)
   * @internal
   */
  private async fetchMachineLogs(executionId: string): Promise<string> {
    try {
      // Fly logs endpoint returns NDJSON
      const response = await fetch(
        `${this.baseUrl}/v1/apps/${this.config.appName}/machines/${executionId}/logs?stdout=true`,
        {
          headers: {
            Authorization: `Bearer ${this.config.apiToken}`,
          },
        }
      );

      if (!response.ok) {
        return '';
      }

      return await response.text();
    } catch {
      return '';
    }
  }
}
