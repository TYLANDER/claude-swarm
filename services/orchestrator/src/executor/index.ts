/**
 * Executor module - pluggable task execution providers
 *
 * Usage:
 *   import { createExecutor, ExecutorConfig } from './executor/index.js';
 *
 *   const executor = createExecutor({
 *     type: 'fly',
 *     fly: { apiToken: '...', appName: '...', ... }
 *   });
 */

// Re-export types
export * from './types.js';

// Re-export executor implementations
export { FlyExecutor, type FlyExecutorConfig } from './flyExecutor.js';

// Import for factory
import type { Executor, ExecutorType } from './types.js';
import { FlyExecutor, type FlyExecutorConfig } from './flyExecutor.js';

// Import existing Azure executor (keeping original file for backward compatibility)
import { AzureExecutor, MockAzureExecutor, type AzureExecutorConfig } from '../azureExecutor.js';

// Re-export Azure types for convenience
export { AzureExecutor, MockAzureExecutor, type AzureExecutorConfig };

/** Unified executor configuration */
export interface ExecutorConfig {
  /** Executor provider type */
  type: ExecutorType;
  /** Enable simulate/mock mode (overrides type) */
  simulateMode?: boolean;
  /** Azure Container Apps configuration */
  azure?: AzureExecutorConfig;
  /** Fly.io Machines configuration */
  fly?: FlyExecutorConfig;
}

/**
 * Create an executor based on configuration
 *
 * @param config Executor configuration with provider type and credentials
 * @returns Configured executor instance
 * @throws Error if required config for selected provider is missing
 *
 * @example
 * // Fly.io executor
 * const executor = createExecutor({
 *   type: 'fly',
 *   fly: {
 *     apiToken: process.env.FLY_API_TOKEN,
 *     appName: 'claude-swarm-workers',
 *     containerImage: 'registry.fly.io/claude-swarm-workers:latest',
 *     anthropicApiKey: process.env.ANTHROPIC_API_KEY,
 *   }
 * });
 *
 * @example
 * // Azure executor
 * const executor = createExecutor({
 *   type: 'azure',
 *   azure: {
 *     subscriptionId: process.env.AZURE_SUBSCRIPTION_ID,
 *     resourceGroup: 'claude-swarm',
 *     // ...
 *   }
 * });
 *
 * @example
 * // Mock executor for testing
 * const executor = createExecutor({ type: 'mock' });
 */
export function createExecutor(config: ExecutorConfig): Executor {
  // Simulate mode always returns mock executor
  if (config.simulateMode) {
    console.log('🎭 Running in simulate mode (no cloud resources used)');
    return new MockAzureExecutor();
  }

  switch (config.type) {
    case 'fly': {
      if (!config.fly) {
        throw new Error(
          'Fly.io configuration required when EXECUTOR_TYPE=fly. ' +
            'Set FLY_API_TOKEN, FLY_APP_NAME, FLY_CONTAINER_IMAGE, and ANTHROPIC_API_KEY.'
        );
      }
      console.log(`🪰 Running with Fly.io Machines (app: ${config.fly.appName})`);
      return new FlyExecutor(config.fly);
    }

    case 'azure': {
      if (!config.azure) {
        throw new Error(
          'Azure configuration required when EXECUTOR_TYPE=azure. ' +
            'Set AZURE_SUBSCRIPTION_ID, AZURE_RESOURCE_GROUP, and related variables.'
        );
      }
      console.log('☁️ Running with Azure Container Apps Jobs');
      return new AzureExecutor(config.azure);
    }

    case 'mock':
    default: {
      console.log('🎭 Running in mock mode (no cloud resources used)');
      return new MockAzureExecutor();
    }
  }
}

/**
 * Build executor config from environment variables
 *
 * This is a convenience function for loading config from env vars.
 * It detects which provider to use based on available credentials.
 *
 * @returns ExecutorConfig populated from environment
 */
export function configFromEnv(): ExecutorConfig {
  const executorType = (process.env.EXECUTOR_TYPE || 'mock') as ExecutorType;
  const simulateMode = process.env.SIMULATE_MODE === 'true';

  return {
    type: simulateMode ? 'mock' : executorType,
    simulateMode,

    // Fly.io config (if FLY_API_TOKEN is set)
    fly:
      process.env.FLY_API_TOKEN && process.env.ANTHROPIC_API_KEY
        ? {
            apiToken: process.env.FLY_API_TOKEN,
            appName: process.env.FLY_APP_NAME || 'claude-swarm-workers',
            containerImage:
              process.env.FLY_CONTAINER_IMAGE ||
              `registry.fly.io/${process.env.FLY_APP_NAME || 'claude-swarm-workers'}:latest`,
            anthropicApiKey: process.env.ANTHROPIC_API_KEY,
            githubToken: process.env.GITHUB_TOKEN,
            region: process.env.FLY_REGION || 'ord',
          }
        : undefined,

    // Azure config (if AZURE_SUBSCRIPTION_ID is set)
    azure:
      process.env.AZURE_SUBSCRIPTION_ID && process.env.ANTHROPIC_API_KEY
        ? {
            subscriptionId: process.env.AZURE_SUBSCRIPTION_ID,
            resourceGroup: process.env.AZURE_RESOURCE_GROUP || '',
            containerAppsEnvironment: process.env.CONTAINER_APPS_ENV || '',
            agentJobName: process.env.AGENT_JOB_NAME || 'claude-agent-job',
            anthropicApiKey: process.env.ANTHROPIC_API_KEY,
            containerImage: process.env.CONTAINER_IMAGE || '',
          }
        : undefined,
  };
}
