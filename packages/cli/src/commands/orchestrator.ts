import chalk from 'chalk';
import ora from 'ora';
import { spawn } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, openSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { getConfig, getExecutorEnvVars } from '../config.js';

// Paths for daemon state
const SWARM_DIR = join(homedir(), '.claude-swarm');
const PID_FILE = join(SWARM_DIR, 'orchestrator.pid');
const LOG_FILE = join(SWARM_DIR, 'orchestrator.log');

interface OrchestratorOptions {
  background?: boolean;
  simulate?: boolean;
}

function ensureSwarmDir(): void {
  if (!existsSync(SWARM_DIR)) {
    mkdirSync(SWARM_DIR, { recursive: true });
  }
}

function getPid(): number | null {
  try {
    if (existsSync(PID_FILE)) {
      const pid = parseInt(readFileSync(PID_FILE, 'utf-8').trim());
      return isNaN(pid) ? null : pid;
    }
  } catch {
    // Ignore read errors
  }
  return null;
}

function isProcessRunning(pid: number): boolean {
  try {
    // Sending signal 0 checks if process exists without killing it
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function checkHealth(): Promise<{ healthy: boolean; data?: Record<string, unknown> }> {
  const config = getConfig();
  try {
    const response = await fetch(`${config.orchestratorUrl}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    if (response.ok) {
      const data = (await response.json()) as Record<string, unknown>;
      return { healthy: true, data };
    }
  } catch {
    // Connection failed or timeout
  }
  return { healthy: false };
}

async function startOrchestrator(options: OrchestratorOptions): Promise<void> {
  ensureSwarmDir();

  // Check if already running
  const existingPid = getPid();
  if (existingPid && isProcessRunning(existingPid)) {
    const { healthy } = await checkHealth();
    if (healthy) {
      console.log(chalk.yellow(`Orchestrator already running (PID: ${existingPid})`));
      console.log(chalk.dim(`Health check: ${getConfig().orchestratorUrl}/health`));
      return;
    }
    // Process exists but not responding, clean up stale PID
    console.log(chalk.dim('Cleaning up stale PID file...'));
    unlinkSync(PID_FILE);
  }

  const spinner = ora('Starting orchestrator...').start();

  // Find the orchestrator package
  // We use npx to run from the workspace, or tsx for development
  const orchestratorScript = join(process.cwd(), 'services', 'orchestrator', 'src', 'local.ts');

  // Build environment for the orchestrator
  // Include executor-specific env vars from CLI config
  const executorEnvVars = getExecutorEnvVars();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...executorEnvVars,
    NODE_ENV: 'development',
  };

  // --simulate flag overrides configured provider
  if (options.simulate) {
    env.SIMULATE_MODE = 'true';
    delete env.EXECUTOR_TYPE;
  }

  if (options.background) {
    // Spawn as detached background process
    const out = openSync(LOG_FILE, 'a');
    const err = openSync(LOG_FILE, 'a');

    const child = spawn('npx', ['tsx', orchestratorScript], {
      detached: true,
      stdio: ['ignore', out, err],
      env,
      cwd: process.cwd(),
    });

    // Write PID file
    writeFileSync(PID_FILE, String(child.pid));

    // Detach from parent
    child.unref();

    // Wait briefly and verify it started
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const { healthy } = await checkHealth();
    if (healthy) {
      spinner.succeed(`Orchestrator started in background (PID: ${child.pid})`);
      console.log(chalk.dim(`  Logs: ${LOG_FILE}`));
      console.log(chalk.dim(`  Health: ${getConfig().orchestratorUrl}/health`));
      console.log();
      console.log(chalk.dim('Stop with: ') + chalk.cyan('swarm orchestrator stop'));
    } else {
      spinner.fail('Orchestrator failed to start');
      console.log(chalk.dim(`Check logs: ${LOG_FILE}`));
      process.exit(1);
    }
  } else {
    // Run in foreground
    spinner.info('Starting orchestrator in foreground (Ctrl+C to stop)');
    console.log();

    const child = spawn('npx', ['tsx', orchestratorScript], {
      stdio: 'inherit',
      env,
      cwd: process.cwd(),
    });

    // Write PID for status checks
    writeFileSync(PID_FILE, String(child.pid));

    child.on('exit', (code) => {
      // Clean up PID file
      try {
        unlinkSync(PID_FILE);
      } catch {
        // Ignore
      }
      process.exit(code ?? 0);
    });

    // Handle Ctrl+C gracefully
    process.on('SIGINT', () => {
      child.kill('SIGINT');
    });
  }
}

async function stopOrchestrator(): Promise<void> {
  const spinner = ora('Stopping orchestrator...').start();

  const pid = getPid();
  if (!pid) {
    spinner.fail('No orchestrator PID file found');
    console.log(chalk.dim('The orchestrator may not be running, or was started differently'));
    return;
  }

  if (!isProcessRunning(pid)) {
    spinner.warn('Orchestrator process not found (cleaning up PID file)');
    unlinkSync(PID_FILE);
    return;
  }

  try {
    // Send SIGTERM for graceful shutdown
    process.kill(pid, 'SIGTERM');

    // Wait for process to exit
    let attempts = 0;
    while (isProcessRunning(pid) && attempts < 10) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      attempts++;
    }

    if (isProcessRunning(pid)) {
      // Force kill if still running
      process.kill(pid, 'SIGKILL');
    }

    // Clean up PID file
    try {
      unlinkSync(PID_FILE);
    } catch {
      // Ignore
    }

    spinner.succeed('Orchestrator stopped');
  } catch (error) {
    spinner.fail('Failed to stop orchestrator');
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}

async function showStatus(): Promise<void> {
  const spinner = ora('Checking orchestrator status...').start();
  const config = getConfig();

  const pid = getPid();
  const pidRunning = pid ? isProcessRunning(pid) : false;
  const { healthy, data } = await checkHealth();

  spinner.stop();

  console.log();
  console.log(chalk.bold('Orchestrator Status'));
  console.log();

  if (healthy && data) {
    console.log(chalk.green('● Running'));
    console.log();
    console.log(chalk.dim('Details:'));
    console.log(`  Provider: ${chalk.cyan(String(data.executor || data.mode || 'unknown'))}`);
    console.log(`  URL: ${chalk.cyan(config.orchestratorUrl)}`);
    console.log(`  PID: ${chalk.cyan(pid ? String(pid) : 'unknown')}`);
    console.log(`  Queue: ${chalk.cyan(String(data.queueLength || 0))} tasks`);
    console.log(`  Agents: ${chalk.cyan(String(data.activeAgents || 0))} active`);
    console.log(`  Jobs: ${chalk.cyan(String(data.executorActiveJobs || 0))} running`);
    if (data.timestamp) {
      console.log(`  Uptime check: ${chalk.dim(String(data.timestamp))}`);
    }
  } else if (pidRunning) {
    console.log(chalk.yellow('● Starting'));
    console.log(chalk.dim(`  PID ${pid} is running but health check failed`));
    console.log(chalk.dim('  The orchestrator may still be initializing'));
  } else {
    console.log(chalk.red('● Stopped'));
    console.log();
    console.log(chalk.dim('Start with: ') + chalk.cyan('swarm orchestrator start'));
  }
  console.log();
}

export async function orchestratorCommand(
  action: string,
  options: OrchestratorOptions
): Promise<void> {
  switch (action) {
    case 'start':
      await startOrchestrator(options);
      break;
    case 'stop':
      await stopOrchestrator();
      break;
    case 'status':
      await showStatus();
      break;
    default:
      console.log(chalk.red(`Unknown action: ${action}`));
      console.log();
      console.log('Usage:');
      console.log('  swarm orchestrator start [--background] [--simulate]');
      console.log('  swarm orchestrator stop');
      console.log('  swarm orchestrator status');
      process.exit(1);
  }
}
