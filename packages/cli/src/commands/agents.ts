import chalk from 'chalk';
import ora from 'ora';
import { api } from '../api.js';

interface AgentsOptions {
  all?: boolean;
}

const statusColors: Record<string, (text: string) => string> = {
  idle: chalk.gray,
  initializing: chalk.blue,
  running: chalk.yellow,
  completed: chalk.green,
  failed: chalk.red,
  terminated: chalk.gray,
};

export async function agentsCommand(options: AgentsOptions): Promise<void> {
  const spinner = ora('Fetching agents...').start();

  try {
    const response = await api.listAgents();
    spinner.stop();

    let agents = response.agents;
    if (!options.all) {
      agents = agents.filter((a) => ['running', 'initializing'].includes(a.status));
    }

    console.log();
    console.log(chalk.bold('Agent Status'));
    console.log(chalk.dim('─'.repeat(80)));

    if (agents.length === 0) {
      console.log(chalk.dim('  No agents currently active'));
    } else {
      // Header
      console.log(
        `  ${chalk.dim('ID'.padEnd(16))} ${chalk.dim('Status'.padEnd(12))} ${chalk.dim('Task'.padEnd(38))} ${chalk.dim('Cost')}`
      );
      console.log(chalk.dim('  ' + '─'.repeat(76)));

      // Rows
      agents.forEach((agent) => {
        const statusColor = statusColors[agent.status] || chalk.white;
        const cost = `$${(agent.costCents / 100).toFixed(2)}`;
        const taskId = agent.currentTask ? agent.currentTask.slice(0, 36) : '-';

        console.log(
          `  ${agent.id.padEnd(16)} ${statusColor(agent.status.padEnd(12))} ${taskId.padEnd(38)} ${chalk.yellow(cost)}`
        );
      });
    }

    console.log();
    console.log(chalk.dim('─'.repeat(80)));
    console.log(
      `  ${chalk.bold('Active:')} ${response.totalActive}  │  ${chalk.bold('Total Cost:')} ${chalk.yellow(`$${(response.totalCostCents / 100).toFixed(2)}`)}`
    );
    console.log();
  } catch (error) {
    spinner.fail('Failed to fetch agents');
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}
