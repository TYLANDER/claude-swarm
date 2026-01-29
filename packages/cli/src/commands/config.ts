import chalk from 'chalk';
import { config, getConfig, setConfig, resetConfig } from '../config.js';

interface ConfigOptions {
  set?: string;
  get?: string;
  list?: boolean;
  reset?: boolean;
}

export async function configCommand(options: ConfigOptions): Promise<void> {
  if (options.reset) {
    resetConfig();
    console.log(chalk.green('Configuration reset to defaults'));
    return;
  }

  if (options.set) {
    const [key, value] = options.set.split('=');
    if (!key || value === undefined) {
      console.log(chalk.red('Invalid format. Use: --set key=value'));
      process.exit(1);
    }

    // Parse value based on key type
    let parsedValue: string | number = value;
    if (['defaultBudgetCents', 'defaultTimeoutMinutes'].includes(key)) {
      parsedValue = parseInt(value);
      if (isNaN(parsedValue)) {
        console.log(chalk.red(`Invalid number for ${key}`));
        process.exit(1);
      }
    }

    setConfig(key as keyof ReturnType<typeof getConfig>, parsedValue as never);
    console.log(chalk.green(`Set ${key} = ${parsedValue}`));
    return;
  }

  if (options.get) {
    const currentConfig = getConfig();
    const value = currentConfig[options.get as keyof typeof currentConfig];
    if (value === undefined) {
      console.log(chalk.red(`Unknown config key: ${options.get}`));
      process.exit(1);
    }
    console.log(value);
    return;
  }

  // Default: list all config
  const currentConfig = getConfig();

  console.log();
  console.log(chalk.bold('Configuration'));
  console.log(chalk.dim('─'.repeat(50)));
  console.log();

  Object.entries(currentConfig).forEach(([key, value]) => {
    console.log(`  ${chalk.cyan(key.padEnd(25))} ${value}`);
  });

  console.log();
  console.log(chalk.dim(`Config file: ${config.path}`));
  console.log();
}
