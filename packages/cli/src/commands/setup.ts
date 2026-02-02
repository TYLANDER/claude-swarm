import chalk from 'chalk';
import ora from 'ora';
import * as readline from 'readline';
import { setConfig, getConfig, type ExecutorType } from '../config.js';

interface SetupOptions {
  check?: boolean;
  fromTerraform?: string;
  provider?: 'azure' | 'fly' | 'local';
}

async function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(chalk.cyan(question), (answer) => {
      resolve(answer.trim());
    });
  });
}

async function promptSelect(
  rl: readline.Interface,
  question: string,
  options: { label: string; value: string }[]
): Promise<string> {
  console.log(chalk.cyan(question));
  options.forEach((opt, i) => {
    console.log(chalk.dim(`  ${i + 1}) ${opt.label}`));
  });
  const answer = await prompt(rl, 'Select (1-' + options.length + '): ');
  const idx = parseInt(answer, 10) - 1;
  if (idx >= 0 && idx < options.length) {
    return options[idx].value;
  }
  // Default to first option
  return options[0].value;
}

async function checkCredentials(): Promise<{
  valid: boolean;
  missing: string[];
  provider: ExecutorType;
}> {
  const config = getConfig();
  const missing: string[] = [];
  const provider = config.executorType || 'local';

  // Common requirements
  if (!config.anthropicApiKey) missing.push('Anthropic API Key');

  // Provider-specific requirements
  if (provider === 'azure') {
    if (!config.azureSubscriptionId) missing.push('Azure Subscription ID');
    if (!config.azureResourceGroup) missing.push('Azure Resource Group');
    if (!config.containerAppsEnvironment) missing.push('Container Apps Environment');
    if (!config.agentJobName) missing.push('Agent Job Name');
  } else if (provider === 'fly') {
    if (!config.flyApiToken) missing.push('Fly.io API Token');
    if (!config.flyAppName) missing.push('Fly.io App Name');
  }
  // 'local' mode has no additional requirements

  return { valid: missing.length === 0, missing, provider };
}

async function runAzureSetup(rl: readline.Interface): Promise<void> {
  const currentConfig = getConfig();

  console.log();
  console.log(chalk.bold.blue('Azure Configuration'));
  console.log(chalk.dim('Find these in your Azure Portal or Terraform outputs'));
  console.log();

  const orchestratorUrl = await prompt(
    rl,
    `Orchestrator URL${currentConfig.orchestratorUrl !== 'http://localhost:3000' ? ` [${currentConfig.orchestratorUrl}]` : ''}: `
  );
  if (orchestratorUrl) {
    setConfig('orchestratorUrl', orchestratorUrl);
  }

  const subscriptionId = await prompt(
    rl,
    `Azure Subscription ID${currentConfig.azureSubscriptionId ? ` [${currentConfig.azureSubscriptionId}]` : ''}: `
  );
  if (subscriptionId) {
    setConfig('azureSubscriptionId', subscriptionId);
  }

  const resourceGroup = await prompt(
    rl,
    `Azure Resource Group${currentConfig.azureResourceGroup ? ` [${currentConfig.azureResourceGroup}]` : ''}: `
  );
  if (resourceGroup) {
    setConfig('azureResourceGroup', resourceGroup);
  }

  const containerEnv = await prompt(
    rl,
    `Container Apps Environment${currentConfig.containerAppsEnvironment ? ` [${currentConfig.containerAppsEnvironment}]` : ''}: `
  );
  if (containerEnv) {
    setConfig('containerAppsEnvironment', containerEnv);
  }

  const jobName = await prompt(
    rl,
    `Agent Job Name${currentConfig.agentJobName ? ` [${currentConfig.agentJobName}]` : ''}: `
  );
  if (jobName) {
    setConfig('agentJobName', jobName);
  }

  setConfig('executorType', 'azure');
}

async function runFlySetup(rl: readline.Interface): Promise<void> {
  const currentConfig = getConfig();

  console.log();
  console.log(chalk.bold.magenta('Fly.io Configuration'));
  console.log(chalk.dim('Get these from fly.io dashboard or CLI'));
  console.log();

  const apiToken = await prompt(
    rl,
    `Fly.io API Token${currentConfig.flyApiToken ? ` [${currentConfig.flyApiToken.slice(0, 10)}...]` : ''}: `
  );
  if (apiToken) {
    setConfig('flyApiToken', apiToken);
  }

  const appName = await prompt(
    rl,
    `Fly.io App Name${currentConfig.flyAppName ? ` [${currentConfig.flyAppName}]` : ' (e.g., claude-swarm-workers)'}: `
  );
  if (appName) {
    setConfig('flyAppName', appName);
  }

  const region = await prompt(
    rl,
    `Fly.io Region${currentConfig.flyRegion ? ` [${currentConfig.flyRegion}]` : ' (default: ord)'}: `
  );
  if (region) {
    setConfig('flyRegion', region);
  } else if (!currentConfig.flyRegion) {
    setConfig('flyRegion', 'ord');
  }

  const containerImage = await prompt(
    rl,
    `Container Image${currentConfig.flyContainerImage ? ` [${currentConfig.flyContainerImage}]` : ''}: `
  );
  if (containerImage) {
    setConfig('flyContainerImage', containerImage);
  }

  setConfig('executorType', 'fly');
}

async function runLocalSetup(): Promise<void> {
  console.log();
  console.log(chalk.bold.yellow('Local/Simulate Mode'));
  console.log(chalk.dim('No cloud provider configuration needed.'));
  console.log(chalk.dim('Tasks will be simulated locally for testing.'));

  setConfig('executorType', 'local');
}

async function runInteractiveSetup(preselectedProvider?: ExecutorType): Promise<void> {
  const currentConfig = getConfig();

  console.log();
  console.log(chalk.bold('Claude Swarm Setup'));
  console.log(chalk.dim('Configure your agent execution provider'));
  console.log();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    // Provider selection (unless preselected via --provider)
    let provider: ExecutorType = preselectedProvider || currentConfig.executorType || 'local';

    if (!preselectedProvider) {
      const selected = await promptSelect(rl, 'Select execution provider:', [
        { label: 'Fly.io (Recommended) - Fast, simple, pay-per-second', value: 'fly' },
        { label: 'Azure Container Apps - Enterprise, existing Azure infra', value: 'azure' },
        { label: 'Local/Simulate - No cloud, for testing', value: 'local' },
      ]);
      provider = selected as ExecutorType;
    }

    // Provider-specific setup
    if (provider === 'azure') {
      await runAzureSetup(rl);
    } else if (provider === 'fly') {
      await runFlySetup(rl);
    } else {
      await runLocalSetup();
    }

    // API Credentials (common to all providers except local)
    if (provider !== 'local') {
      console.log();
      console.log(chalk.bold.blue('API Credentials'));
      console.log();

      const existingKey = currentConfig.anthropicApiKey;
      const keyPrompt = existingKey
        ? `Anthropic API Key [${existingKey.slice(0, 10)}...] (Enter to keep): `
        : 'Anthropic API Key: ';

      const anthropicKey = await prompt(rl, keyPrompt);
      if (anthropicKey) {
        setConfig('anthropicApiKey', anthropicKey);
      }

      const existingGithub = currentConfig.githubToken;
      const githubPrompt = existingGithub
        ? `GitHub Token [${existingGithub.slice(0, 10)}...] (Enter to keep, optional): `
        : 'GitHub Token (optional, for private repos): ';

      const githubToken = await prompt(rl, githubPrompt);
      if (githubToken) {
        setConfig('githubToken', githubToken);
      }
    }

    // Mark as configured
    setConfig('isConfigured', true);

    // Show summary
    console.log();
    console.log(chalk.green.bold('Setup complete!'));
    console.log();
    const updatedConfig = getConfig();
    console.log(chalk.dim('Configuration:'));
    console.log(chalk.dim(`  Provider:      ${updatedConfig.executorType}`));

    if (updatedConfig.executorType === 'azure') {
      console.log(chalk.dim(`  Orchestrator:  ${updatedConfig.orchestratorUrl}`));
      console.log(
        chalk.dim(`  Subscription:  ${updatedConfig.azureSubscriptionId || '(not set)'}`)
      );
      console.log(
        chalk.dim(`  Resource Group: ${updatedConfig.azureResourceGroup || '(not set)'}`)
      );
    } else if (updatedConfig.executorType === 'fly') {
      console.log(chalk.dim(`  App Name:      ${updatedConfig.flyAppName || '(not set)'}`));
      console.log(chalk.dim(`  Region:        ${updatedConfig.flyRegion || 'ord'}`));
    }

    if (updatedConfig.anthropicApiKey) {
      console.log(chalk.dim(`  Anthropic Key: ${updatedConfig.anthropicApiKey.slice(0, 10)}...`));
    }
  } finally {
    rl.close();
  }
}

async function runTerraformSetup(terraformDir: string): Promise<void> {
  const spinner = ora('Reading Terraform outputs...').start();

  try {
    const { execSync } = await import('child_process');
    const output = execSync(`terraform output -json`, {
      cwd: terraformDir,
      encoding: 'utf-8',
    });

    const outputs = JSON.parse(output);

    // Extract values from terraform outputs
    const orchestratorUrl = outputs.orchestrator_url?.value;
    const resourceGroupName = outputs.resource_group_name?.value;

    if (!orchestratorUrl) {
      spinner.fail('Could not find orchestrator_url in Terraform outputs');
      process.exit(1);
    }

    spinner.succeed('Read Terraform outputs');

    // Set the config values
    setConfig('orchestratorUrl', orchestratorUrl);
    if (resourceGroupName) {
      setConfig('azureResourceGroup', resourceGroupName);
    }

    // Default values based on terraform module conventions
    setConfig('containerAppsEnvironment', 'claude-swarm-agents-env');
    setConfig('agentJobName', 'claude-swarm-agent-worker');
    setConfig('executorType', 'azure');
    setConfig('isConfigured', true);

    console.log();
    console.log(chalk.green.bold('Terraform configuration imported!'));
    console.log();
    console.log(chalk.dim('Configuration:'));
    console.log(chalk.dim(`  Provider:      azure`));
    console.log(chalk.dim(`  Orchestrator:  ${orchestratorUrl}`));
    console.log(chalk.dim(`  Resource Group: ${resourceGroupName || '(not set)'}`));
    console.log(chalk.dim(`  Environment:   claude-swarm-agents-env`));
    console.log(chalk.dim(`  Job Name:      claude-swarm-agent-worker`));
    console.log();
    console.log(chalk.yellow('Note: You still need to set your Anthropic API key:'));
    console.log(chalk.cyan('  swarm setup'));
  } catch (error) {
    spinner.fail('Failed to read Terraform outputs');
    console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
    console.log();
    console.log(
      chalk.dim('Make sure you are in a directory with Terraform state or provide the path:')
    );
    console.log(chalk.cyan('  swarm setup --from-terraform /path/to/terraform'));
    process.exit(1);
  }
}

export async function setupCommand(options: SetupOptions): Promise<void> {
  if (options.check) {
    const spinner = ora('Checking credentials...').start();

    const { valid, missing, provider } = await checkCredentials();

    if (valid) {
      spinner.succeed('All credentials configured');
      console.log();
      console.log(chalk.green('Ready to use Claude Swarm'));
      const config = getConfig();
      console.log(chalk.dim(`  Provider: ${provider}`));
      if (provider === 'azure') {
        console.log(chalk.dim(`  Orchestrator: ${config.orchestratorUrl}`));
      } else if (provider === 'fly') {
        console.log(chalk.dim(`  App: ${config.flyAppName} (${config.flyRegion || 'ord'})`));
      }
    } else {
      spinner.fail('Missing credentials');
      console.log();
      console.log(chalk.yellow(`Provider: ${provider}`));
      console.log(chalk.yellow('Missing:'));
      missing.forEach((item) => {
        console.log(chalk.red(`  - ${item}`));
      });
      console.log();
      console.log(chalk.dim('Run ') + chalk.cyan('swarm setup') + chalk.dim(' to configure'));
      process.exit(1);
    }
  } else if (options.fromTerraform) {
    await runTerraformSetup(options.fromTerraform);
  } else {
    // Map --provider option to executor type
    const providerMap: Record<string, ExecutorType> = {
      azure: 'azure',
      fly: 'fly',
      local: 'local',
    };
    const preselected = options.provider ? providerMap[options.provider] : undefined;
    await runInteractiveSetup(preselected);
  }
}

// Export for other commands
export { checkCredentials };
