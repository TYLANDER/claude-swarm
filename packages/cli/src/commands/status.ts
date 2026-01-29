import chalk from 'chalk';
import ora from 'ora';
import { api } from '../api.js';

interface StatusOptions {
  all?: boolean;
  watch?: boolean;
}

const statusColors: Record<string, (text: string) => string> = {
  pending: chalk.gray,
  assigned: chalk.blue,
  running: chalk.yellow,
  completed: chalk.green,
  failed: chalk.red,
  cancelled: chalk.gray,
};

export async function statusCommand(
  taskId: string | undefined,
  options: StatusOptions
): Promise<void> {
  if (!taskId && !options.all) {
    console.log(chalk.yellow('Specify a task ID or use --all to see all tasks'));
    process.exit(1);
  }

  const spinner = ora('Fetching status...').start();

  try {
    if (taskId) {
      const response = await api.getTaskStatus(taskId);
      spinner.stop();

      const { task, result } = response;
      const statusColor = statusColors[task.status] || chalk.white;

      console.log();
      console.log(chalk.bold('Task Details'));
      console.log(chalk.dim('─'.repeat(50)));
      console.log(`  ${chalk.dim('ID:')}       ${task.id}`);
      console.log(`  ${chalk.dim('Type:')}     ${task.type}`);
      console.log(`  ${chalk.dim('Status:')}   ${statusColor(task.status)}`);
      console.log(`  ${chalk.dim('Model:')}    ${task.model}`);
      console.log(`  ${chalk.dim('Priority:')} ${task.priority}`);
      console.log(`  ${chalk.dim('Branch:')}   ${task.context.branch}`);
      console.log(`  ${chalk.dim('Created:')}  ${new Date(task.createdAt).toLocaleString()}`);

      if (task.assignedAgent) {
        console.log(`  ${chalk.dim('Agent:')}    ${task.assignedAgent}`);
      }

      if (result) {
        console.log();
        console.log(chalk.bold('Result'));
        console.log(chalk.dim('─'.repeat(50)));
        console.log(`  ${chalk.dim('Status:')}   ${statusColor(result.status)}`);
        console.log(`  ${chalk.dim('Duration:')} ${(result.durationMs / 1000).toFixed(1)}s`);
        console.log(`  ${chalk.dim('Cost:')}     $${(result.costCents / 100).toFixed(2)}`);
        console.log(
          `  ${chalk.dim('Tokens:')}   ${result.tokensUsed.input.toLocaleString()} in / ${result.tokensUsed.output.toLocaleString()} out`
        );

        if (result.outputs.filesChanged.length > 0) {
          console.log();
          console.log(`  ${chalk.dim('Files Changed:')}`);
          result.outputs.filesChanged.forEach((file) => {
            const actionColor =
              file.action === 'add'
                ? chalk.green
                : file.action === 'delete'
                  ? chalk.red
                  : chalk.yellow;
            console.log(`    ${actionColor(file.action.padEnd(8))} ${file.path}`);
          });
        }

        if (result.outputs.summary) {
          console.log();
          console.log(`  ${chalk.dim('Summary:')}`);
          console.log(`    ${result.outputs.summary}`);
        }

        if (result.error) {
          console.log();
          console.log(`  ${chalk.red('Error:')} ${result.error}`);
        }

        if (result.resultCommit) {
          console.log();
          console.log(`  ${chalk.dim('Commit:')}   ${result.resultCommit.slice(0, 8)}`);
        }
      }

      console.log();
    }
  } catch (error) {
    spinner.fail('Failed to fetch status');
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}
