import Conf from 'conf';

interface SwarmConfig {
  orchestratorUrl: string;
  defaultModel: 'opus' | 'sonnet';
  defaultPriority: 'high' | 'normal' | 'low';
  defaultBudgetCents: number;
  defaultTimeoutMinutes: number;
  defaultBranch: string;
}

const defaults: SwarmConfig = {
  orchestratorUrl: 'http://localhost:3000',
  defaultModel: 'sonnet',
  defaultPriority: 'normal',
  defaultBudgetCents: 100,
  defaultTimeoutMinutes: 30,
  defaultBranch: 'develop',
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
  };
}

export function setConfig<K extends keyof SwarmConfig>(key: K, value: SwarmConfig[K]): void {
  config.set(key, value);
}

export function resetConfig(): void {
  config.clear();
}
