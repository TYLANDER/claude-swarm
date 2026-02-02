import Conf from 'conf';

/** Supported executor provider types */
export type ExecutorType = 'azure' | 'fly' | 'local';

interface SwarmConfig {
  orchestratorUrl: string;
  defaultModel: 'opus' | 'sonnet';
  defaultPriority: 'high' | 'normal' | 'low';
  defaultBudgetCents: number;
  defaultTimeoutMinutes: number;
  defaultBranch: string;

  // Provider selection
  executorType: ExecutorType;

  // Azure configuration
  azureSubscriptionId?: string;
  azureResourceGroup?: string;
  containerAppsEnvironment?: string;
  agentJobName?: string;
  containerImage?: string;

  // Fly.io configuration
  flyApiToken?: string;
  flyAppName?: string;
  flyRegion?: string;
  flyContainerImage?: string;

  // API keys (stored in config for simplicity, will migrate to keychain)
  anthropicApiKey?: string;
  githubToken?: string;

  isConfigured: boolean;
}

const defaults: SwarmConfig = {
  orchestratorUrl: 'http://localhost:3000',
  defaultModel: 'sonnet',
  defaultPriority: 'normal',
  defaultBudgetCents: 100,
  defaultTimeoutMinutes: 30,
  defaultBranch: 'develop',
  executorType: 'local',
  isConfigured: false,
};

export const config = new Conf<SwarmConfig>({
  projectName: 'claude-swarm',
  defaults,
});

export function getConfig(): SwarmConfig {
  return {
    orchestratorUrl: config.get('orchestratorUrl'),
    defaultModel: config.get('defaultModel'),
    defaultPriority: config.get('defaultPriority'),
    defaultBudgetCents: config.get('defaultBudgetCents'),
    defaultTimeoutMinutes: config.get('defaultTimeoutMinutes'),
    defaultBranch: config.get('defaultBranch'),
    executorType: config.get('executorType'),
    // Azure
    azureSubscriptionId: config.get('azureSubscriptionId'),
    azureResourceGroup: config.get('azureResourceGroup'),
    containerAppsEnvironment: config.get('containerAppsEnvironment'),
    agentJobName: config.get('agentJobName'),
    containerImage: config.get('containerImage'),
    // Fly.io
    flyApiToken: config.get('flyApiToken'),
    flyAppName: config.get('flyAppName'),
    flyRegion: config.get('flyRegion'),
    flyContainerImage: config.get('flyContainerImage'),
    // API keys
    anthropicApiKey: config.get('anthropicApiKey'),
    githubToken: config.get('githubToken'),
    isConfigured: config.get('isConfigured'),
  };
}

export function setConfig<K extends keyof SwarmConfig>(key: K, value: SwarmConfig[K]): void {
  config.set(key, value);
}

export function resetConfig(): void {
  config.clear();
}

/**
 * Get environment variables for the orchestrator based on current config
 * Used when starting the orchestrator process
 */
export function getExecutorEnvVars(): Record<string, string> {
  const cfg = getConfig();
  const env: Record<string, string> = {};

  // Common
  if (cfg.anthropicApiKey) env.ANTHROPIC_API_KEY = cfg.anthropicApiKey;
  if (cfg.githubToken) env.GITHUB_TOKEN = cfg.githubToken;

  // Executor type
  if (cfg.executorType === 'local') {
    env.SIMULATE_MODE = 'true';
  } else {
    env.EXECUTOR_TYPE = cfg.executorType;
  }

  // Azure-specific
  if (cfg.executorType === 'azure') {
    if (cfg.azureSubscriptionId) env.AZURE_SUBSCRIPTION_ID = cfg.azureSubscriptionId;
    if (cfg.azureResourceGroup) env.AZURE_RESOURCE_GROUP = cfg.azureResourceGroup;
    if (cfg.containerAppsEnvironment) env.CONTAINER_APPS_ENV = cfg.containerAppsEnvironment;
    if (cfg.agentJobName) env.AGENT_JOB_NAME = cfg.agentJobName;
    if (cfg.containerImage) env.CONTAINER_IMAGE = cfg.containerImage;
  }

  // Fly.io-specific
  if (cfg.executorType === 'fly') {
    if (cfg.flyApiToken) env.FLY_API_TOKEN = cfg.flyApiToken;
    if (cfg.flyAppName) env.FLY_APP_NAME = cfg.flyAppName;
    if (cfg.flyRegion) env.FLY_REGION = cfg.flyRegion;
    if (cfg.flyContainerImage) env.FLY_CONTAINER_IMAGE = cfg.flyContainerImage;
  }

  return env;
}
