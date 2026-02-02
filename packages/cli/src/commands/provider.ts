import chalk from 'chalk';
import { getConfig, setConfig, type ExecutorType } from '../config.js';

const PROVIDER_INFO: Record<ExecutorType, { name: string; icon: string; description: string }> = {
  fly: {
    name: 'Fly.io',
    icon: '🪰',
    description: 'Fast ephemeral machines via Fly.io Machines API',
  },
  azure: {
    name: 'Azure',
    icon: '☁️',
    description: 'Azure Container Apps Jobs',
  },
  local: {
    name: 'Local',
    icon: '🎭',
    description: 'Simulated execution for testing (no cloud)',
  },
};

export async function providerCommand(provider?: string): Promise<void> {
  const config = getConfig();
  const currentProvider = config.executorType || 'local';

  if (!provider) {
    // Show current provider
    const info = PROVIDER_INFO[currentProvider];
    console.log();
    console.log(chalk.bold('Current Execution Provider'));
    console.log();
    console.log(`  ${info.icon} ${chalk.bold(info.name)}`);
    console.log(chalk.dim(`     ${info.description}`));
    console.log();

    // Show available providers
    console.log(chalk.dim('Available providers:'));
    for (const [key, value] of Object.entries(PROVIDER_INFO)) {
      const isCurrent = key === currentProvider;
      const prefix = isCurrent ? chalk.green('→') : ' ';
      console.log(`  ${prefix} ${value.icon} ${key.padEnd(8)} - ${value.description}`);
    }
    console.log();
    console.log(chalk.dim('Switch with: ') + chalk.cyan(`swarm provider <name>`));
    console.log(chalk.dim('Configure with: ') + chalk.cyan(`swarm setup --provider <name>`));
    return;
  }

  // Switch provider
  const normalized = provider.toLowerCase() as ExecutorType;
  if (!['azure', 'fly', 'local'].includes(normalized)) {
    console.error(chalk.red(`Unknown provider: ${provider}`));
    console.log(chalk.dim('Valid options: azure, fly, local'));
    process.exit(1);
  }

  if (normalized === currentProvider) {
    console.log(chalk.yellow(`Already using ${PROVIDER_INFO[normalized].name}`));
    return;
  }

  // Check if provider is configured
  const info = PROVIDER_INFO[normalized];
  let isConfigured = false;

  if (normalized === 'local') {
    isConfigured = true;
  } else if (normalized === 'fly') {
    isConfigured = !!(config.flyApiToken && config.flyAppName);
  } else if (normalized === 'azure') {
    isConfigured = !!(config.azureSubscriptionId && config.azureResourceGroup);
  }

  setConfig('executorType', normalized);

  console.log();
  console.log(`${info.icon} Switched to ${chalk.bold(info.name)}`);

  if (!isConfigured && normalized !== 'local') {
    console.log();
    console.log(chalk.yellow('Provider not fully configured.'));
    console.log(
      chalk.dim('Run ') +
        chalk.cyan(`swarm setup --provider ${normalized}`) +
        chalk.dim(' to configure.')
    );
  } else {
    console.log(chalk.green('Ready to use.'));
  }
}
