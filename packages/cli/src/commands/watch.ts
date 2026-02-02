import chalk from 'chalk';
import WebSocket from 'ws';
import { getConfig } from '../config.js';

interface WatchEvent {
  type: string;
  taskId?: string;
  agentId?: string;
  status?: string;
  costCents?: number;
  error?: string;
  [key: string]: unknown;
}

export async function watchCommand(): Promise<void> {
  const config = getConfig();
  const wsUrl = config.orchestratorUrl.replace(/^http/, 'ws') + '/ws';

  console.log();
  console.log(chalk.bold('Watching for updates...'));
  console.log(chalk.dim(`Connected to: ${wsUrl}`));
  console.log(chalk.dim('Press Ctrl+C to stop'));
  console.log(chalk.dim('─'.repeat(60)));
  console.log();

  const ws = new WebSocket(wsUrl);

  ws.on('open', () => {
    console.log(chalk.green('✓ Connected'));
    console.log();
  });

  ws.on('message', (data) => {
    try {
      const event: WatchEvent = JSON.parse(data.toString());
      const timestamp = new Date().toLocaleTimeString();

      switch (event.type) {
        case 'task_submitted':
          console.log(
            `${chalk.dim(timestamp)} ${chalk.blue('▶')} Task submitted: ${chalk.cyan(event.taskId)}`
          );
          break;

        case 'task_assigned':
          console.log(
            `${chalk.dim(timestamp)} ${chalk.yellow('●')} Task ${chalk.cyan(event.taskId?.slice(0, 8))} assigned to ${chalk.magenta(event.agentId)}`
          );
          break;

        case 'task_running':
          console.log(
            `${chalk.dim(timestamp)} ${chalk.yellow('◐')} Task ${chalk.cyan(event.taskId?.slice(0, 8))} running on ${chalk.magenta(event.agentId)}`
          );
          break;

        case 'task_completed': {
          const statusIcon = event.status === 'success' ? chalk.green('✓') : chalk.red('✗');
          const cost = event.costCents ? `($${(event.costCents / 100).toFixed(2)})` : '';
          console.log(
            `${chalk.dim(timestamp)} ${statusIcon} Task ${chalk.cyan(event.taskId?.slice(0, 8))} ${event.status} ${chalk.yellow(cost)}`
          );
          break;
        }

        case 'agent_spawned':
          console.log(
            `${chalk.dim(timestamp)} ${chalk.blue('+')} Agent spawned: ${chalk.magenta(event.agentId)}`
          );
          break;

        case 'agent_terminated':
          console.log(
            `${chalk.dim(timestamp)} ${chalk.gray('-')} Agent terminated: ${chalk.magenta(event.agentId)}`
          );
          break;

        case 'budget_warning':
          console.log(
            `${chalk.dim(timestamp)} ${chalk.yellow('⚠')} Budget warning: ${event.message}`
          );
          break;

        case 'budget_paused':
          console.log(
            `${chalk.dim(timestamp)} ${chalk.red('⛔')} Budget limit reached - submissions paused`
          );
          break;

        default:
          console.log(
            `${chalk.dim(timestamp)} ${chalk.dim('•')} ${event.type}: ${JSON.stringify(event)}`
          );
      }
    } catch {
      console.log(chalk.dim(`Raw: ${data.toString()}`));
    }
  });

  ws.on('close', () => {
    console.log();
    console.log(chalk.yellow('Disconnected'));
    process.exit(0);
  });

  ws.on('error', (error) => {
    console.log();
    console.log(chalk.red(`Connection error: ${error.message}`));
    console.log(chalk.dim('Make sure the orchestrator is running'));
    process.exit(1);
  });

  // Handle Ctrl+C
  process.on('SIGINT', () => {
    console.log();
    console.log(chalk.dim('Closing connection...'));
    ws.close();
  });
}
