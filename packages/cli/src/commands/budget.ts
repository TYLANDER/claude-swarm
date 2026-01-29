import chalk from 'chalk';
import ora from 'ora';
import { api } from '../api.js';

export async function budgetCommand(): Promise<void> {
  const spinner = ora('Fetching budget...').start();

  try {
    const response = await api.getBudget();
    spinner.stop();

    const { status, projectedDailyCostCents } = response;
    const { config } = status;

    const dailyPercent = (status.dailyUsedCents / config.dailyLimitCents) * 100;
    const weeklyPercent = (status.weeklyUsedCents / config.weeklyLimitCents) * 100;

    const getBarColor = (percent: number) => {
      if (percent >= 100) return chalk.red;
      if (percent >= config.alertThresholdPercent) return chalk.yellow;
      return chalk.green;
    };

    const renderBar = (percent: number, width: number = 30) => {
      const filled = Math.min(Math.round((percent / 100) * width), width);
      const empty = width - filled;
      const color = getBarColor(percent);
      return color('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));
    };

    console.log();
    console.log(chalk.bold('Budget Status'));
    console.log(chalk.dim('─'.repeat(60)));

    if (status.isPaused) {
      console.log();
      console.log(chalk.bgRed.white.bold(' ⚠ PAUSED ') + chalk.red(' Budget limit reached'));
      console.log();
    }

    // Daily usage
    console.log();
    console.log(chalk.bold('  Daily Usage'));
    console.log(`  ${renderBar(dailyPercent)} ${dailyPercent.toFixed(1)}%`);
    console.log(
      chalk.dim(
        `  $${(status.dailyUsedCents / 100).toFixed(2)} / $${(config.dailyLimitCents / 100).toFixed(2)}`
      )
    );

    // Weekly usage
    console.log();
    console.log(chalk.bold('  Weekly Usage'));
    console.log(`  ${renderBar(weeklyPercent)} ${weeklyPercent.toFixed(1)}%`);
    console.log(
      chalk.dim(
        `  $${(status.weeklyUsedCents / 100).toFixed(2)} / $${(config.weeklyLimitCents / 100).toFixed(2)}`
      )
    );

    // Projections
    console.log();
    console.log(chalk.dim('─'.repeat(60)));
    console.log(
      `  ${chalk.dim('Projected daily:')} ${chalk.yellow(`$${(projectedDailyCostCents / 100).toFixed(2)}`)}`
    );
    console.log(
      `  ${chalk.dim('Per-task limit:')}  ${chalk.cyan(`$${(config.perTaskMaxCents / 100).toFixed(2)}`)}`
    );
    console.log(
      `  ${chalk.dim('Last updated:')}    ${new Date(status.lastUpdated).toLocaleString()}`
    );
    console.log();
  } catch (error) {
    spinner.fail('Failed to fetch budget');
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}
