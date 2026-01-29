import chalk from 'chalk';
import ora from 'ora';
import { readFile } from 'fs/promises';
import type { AgentTask, TaskType, TaskPriority, ModelType } from '@claude-swarm/types';
import { api } from '../api.js';
import { getConfig } from '../config.js';

interface SubmitOptions {
  file?: string;
  prompt?: string;
  type: string;
  model: string;
  priority: string;
  branch?: string;
  files?: string[];
  budget: string;
  timeout: string;
}

export async function submitCommand(options: SubmitOptions): Promise<void> {
  const config = getConfig();
  const spinner = ora('Preparing tasks...').start();

  try {
    let tasks: Partial<AgentTask>[] = [];

    if (options.file) {
      // Load tasks from file
      const content = await readFile(options.file, 'utf-8');
      const parsed = JSON.parse(content);
      tasks = Array.isArray(parsed) ? parsed : [parsed];
    } else if (options.prompt) {
      // Single task from prompt
      tasks = [
        {
          type: options.type as TaskType,
          model: (options.model || config.defaultModel) as ModelType,
          priority: (options.priority || config.defaultPriority) as TaskPriority,
          prompt: options.prompt,
          context: {
            branch: options.branch || config.defaultBranch,
            files: options.files || [],
            dependencies: [],
          },
          budgetCents: parseInt(options.budget) || config.defaultBudgetCents,
          timeoutMinutes: parseInt(options.timeout) || config.defaultTimeoutMinutes,
        },
      ];
    } else {
      spinner.fail('No task specified. Use --file or --prompt');
      process.exit(1);
    }

    // Fill in defaults for each task
    const preparedTasks = tasks.map((task) => ({
      type: (task.type || 'code') as TaskType,
      model: (task.model || config.defaultModel) as ModelType,
      priority: (task.priority || config.defaultPriority) as TaskPriority,
      prompt: task.prompt!,
      context: {
        branch: task.context?.branch || config.defaultBranch,
        files: task.context?.files || [],
        dependencies: task.context?.dependencies || [],
      },
      budgetCents: task.budgetCents || config.defaultBudgetCents,
      timeoutMinutes: task.timeoutMinutes || config.defaultTimeoutMinutes,
    }));

    spinner.text = `Submitting ${preparedTasks.length} task(s)...`;

    const response = await api.submitTasks({ tasks: preparedTasks });

    spinner.succeed(`Submitted ${response.taskIds.length} task(s)`);

    console.log();
    console.log(chalk.bold('Task IDs:'));
    response.taskIds.forEach((id) => {
      console.log(`  ${chalk.cyan(id)}`);
    });
    console.log();
    console.log(
      chalk.dim(
        `Estimated cost: ${chalk.yellow(`$${(response.estimatedCostCents / 100).toFixed(2)}`)}`
      )
    );
    console.log();
    console.log(chalk.dim(`Watch progress: ${chalk.cyan('swarm watch')}`));
    console.log(chalk.dim(`Check status:   ${chalk.cyan(`swarm status ${response.taskIds[0]}`)}`));
  } catch (error) {
    spinner.fail('Failed to submit tasks');
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}
