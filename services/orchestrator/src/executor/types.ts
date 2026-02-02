/**
 * Executor interface types for task execution providers
 * Supports multiple backends: Azure Container Apps, Fly.io Machines, Mock
 */

import type { AgentTask, AgentResult } from '@claude-swarm/types';

/** Supported executor provider types */
export type ExecutorType = 'azure' | 'fly' | 'mock';

/** Status of a task execution */
export type ExecutionStatus = 'pending' | 'running' | 'completed' | 'failed';

/** Result from spawning a task execution */
export interface ExecutionResult {
  /** Provider-specific execution identifier (Azure job ID, Fly machine ID, etc.) */
  jobExecutionId: string;
  /** Agent identifier for tracking */
  agentId: string;
}

/** Result from waiting for execution completion */
export interface ExecutorResult {
  /** Final status of the execution */
  status: 'completed' | 'failed' | 'timeout';
  /** Parsed result from worker (if available) */
  output?: AgentResult;
}

/** Active job tracking info */
export interface ActiveJob {
  /** Provider-specific execution identifier */
  executionId: string;
  /** Associated task ID */
  taskId: string;
  /** When the job started */
  startTime: Date;
}

/**
 * Abstract interface for task execution providers
 *
 * Implementations:
 * - AzureExecutor: Azure Container Apps Jobs
 * - FlyExecutor: Fly.io Machines API
 * - MockExecutor: Local testing without cloud resources
 */
export interface Executor {
  /**
   * Spawn a container/job to execute a task
   * @param task The task to execute
   * @returns Execution identifiers for tracking
   */
  executeTask(task: AgentTask): Promise<ExecutionResult>;

  /**
   * Check current status of an execution
   * @param executionId Provider-specific execution ID
   * @returns Current execution status
   */
  getExecutionStatus(executionId: string): Promise<ExecutionStatus>;

  /**
   * Wait for execution to complete with optional timeout
   * @param executionId Provider-specific execution ID
   * @param timeoutMs Maximum time to wait (default: 30 minutes)
   * @returns Final result including status and optional parsed output
   */
  waitForCompletion(executionId: string, timeoutMs?: number): Promise<ExecutorResult>;

  /**
   * Attempt to cancel/stop a running execution
   * @param executionId Provider-specific execution ID
   */
  cancelExecution(executionId: string): Promise<void>;

  /**
   * Get count of currently active executions
   * @returns Number of active jobs
   */
  getActiveJobCount(): number;

  /**
   * List all active executions with details
   * @returns Array of active job info
   */
  getActiveJobs(): ActiveJob[];
}

/** Resource tier for task execution */
export type ResourceTier = 'light' | 'standard' | 'heavy';

/** Resource specifications per tier */
export interface ResourceSpec {
  /** CPU cores (or fractional for shared) */
  cpu: number;
  /** Memory in megabytes */
  memoryMb: number;
}

/** Resource tier configuration */
export const RESOURCE_TIERS: Record<ResourceTier, ResourceSpec> = {
  /** Light: docs, simple reviews (1 CPU, 1GB) */
  light: { cpu: 1, memoryMb: 1024 },
  /** Standard: most code tasks (2 CPU, 2GB) */
  standard: { cpu: 2, memoryMb: 2048 },
  /** Heavy: security scans, Opus + code (4 CPU, 4GB) */
  heavy: { cpu: 4, memoryMb: 4096 },
};

/**
 * Determine resource tier based on task characteristics
 * @param task The task to evaluate
 * @returns Appropriate resource tier
 */
export function getResourceTier(task: AgentTask): ResourceTier {
  // Heavy: security scans, complex code with Opus
  if (task.type === 'security') return 'heavy';
  if (task.model === 'opus' && task.type === 'code') return 'heavy';

  // Light: documentation, simple reviews
  if (task.type === 'doc') return 'light';
  if (task.type === 'review' && (task.context.files?.length || 0) < 3) return 'light';

  // Standard: everything else
  return 'standard';
}
