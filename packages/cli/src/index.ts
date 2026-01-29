#!/usr/bin/env node
import { Command } from 'commander';
import { submitCommand } from './commands/submit.js';
import { statusCommand } from './commands/status.js';
import { agentsCommand } from './commands/agents.js';
import { budgetCommand } from './commands/budget.js';
import { configCommand } from './commands/config.js';
import { watchCommand } from './commands/watch.js';

const program = new Command();

program
  .name('swarm')
  .description('CLI for Claude Swarm - Cloud-based agent orchestration')
  .version('0.1.0');

// Submit tasks
program
  .command('submit')
  .description('Submit tasks to the agent swarm')
  .option('-f, --file <path>', 'Task file (JSON or YAML)')
  .option('-p, --prompt <prompt>', 'Single task prompt')
  .option('-t, --type <type>', 'Task type (code, test, review, doc, security)', 'code')
  .option('-m, --model <model>', 'Model to use (opus, sonnet)', 'sonnet')
  .option('--priority <priority>', 'Priority (high, normal, low)', 'normal')
  .option('--branch <branch>', 'Git branch to work on')
  .option('--files <files...>', 'Files in scope')
  .option('--budget <cents>', 'Budget limit in cents', '100')
  .option('--timeout <minutes>', 'Timeout in minutes', '30')
  .action(submitCommand);

// Check task status
program
  .command('status [taskId]')
  .description('Check status of tasks')
  .option('-a, --all', 'Show all tasks')
  .option('-w, --watch', 'Watch for updates')
  .action(statusCommand);

// List agents
program
  .command('agents')
  .description('List active agents')
  .option('-a, --all', 'Show all agents including completed')
  .action(agentsCommand);

// Budget information
program.command('budget').description('Show budget status and usage').action(budgetCommand);

// Configuration
program
  .command('config')
  .description('Manage CLI configuration')
  .option('--set <key=value>', 'Set a configuration value')
  .option('--get <key>', 'Get a configuration value')
  .option('--list', 'List all configuration')
  .option('--reset', 'Reset to defaults')
  .action(configCommand);

// Watch for real-time updates
program.command('watch').description('Watch real-time task and agent updates').action(watchCommand);

program.parse();
