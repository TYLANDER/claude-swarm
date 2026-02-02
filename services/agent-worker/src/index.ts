import { ServiceBusClient, ServiceBusReceivedMessage } from '@azure/service-bus';
import { BlobServiceClient } from '@azure/storage-blob';
import type { AgentTask, AgentResult, TokenUsage } from '@claude-swarm/types';
import { withRetry, isTransientError } from '@claude-swarm/shared';
import { executeTask } from './executor.js';
import { setupGitWorktree, cleanupWorktree, commitAndPush } from './git.js';

// Configuration from environment
const config = {
  serviceBusConnection: process.env.AZURE_SERVICE_BUS_CONNECTION,
  taskQueueName: process.env.TASK_QUEUE_NAME || 'agent-tasks',
  resultQueueName: process.env.RESULT_QUEUE_NAME || 'agent-results',
  storageAccountUrl: process.env.STORAGE_ACCOUNT_URL,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY!,
  githubToken: process.env.GITHUB_TOKEN,
  agentId: process.env.AGENT_ID || `agent-${Date.now()}`,
  logLevel: process.env.LOG_LEVEL || 'info',
  taskJson: process.env.TASK_JSON,
};

// Validate required environment variables (varies by mode)
function validateConfig() {
  // ANTHROPIC_API_KEY is always required
  const required = ['ANTHROPIC_API_KEY'];

  // In TASK_JSON mode (single task execution), Service Bus and Storage are optional
  if (!config.taskJson) {
    // Queue mode requires Service Bus
    required.push('AZURE_SERVICE_BUS_CONNECTION', 'STORAGE_ACCOUNT_URL', 'GITHUB_TOKEN');
  }

  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

// Initialize clients (optional based on mode)
let serviceBusClient: ServiceBusClient | null = null;
let blobServiceClient: BlobServiceClient | null = null;

async function init() {
  validateConfig();

  // Only initialize Service Bus if connection string is provided
  if (config.serviceBusConnection) {
    serviceBusClient = new ServiceBusClient(config.serviceBusConnection);
  }

  // Only initialize blob storage if URL is provided
  if (config.storageAccountUrl) {
    blobServiceClient = new BlobServiceClient(config.storageAccountUrl);
  }

  console.log(
    `[${config.agentId}] Agent worker initialized (mode: ${config.taskJson ? 'single-task' : 'queue'})`
  );
}

// Process a single task
async function processTask(task: AgentTask): Promise<AgentResult> {
  const startTime = Date.now();
  let worktreePath: string | null = null;
  const hasRepository = task.context.repository && task.context.repository.length > 0;

  console.log(
    `[${config.agentId}] Processing task ${task.id} (${task.type})${hasRepository ? ` with repo: ${task.context.repository}` : ' (no repository)'}`
  );

  try {
    // Setup git worktree only if repository is specified
    if (hasRepository) {
      worktreePath = await setupGitWorktree(task.context.repository!, task.context.branch, task.id);
    }

    // Execute the task using Claude Agent SDK
    const result = await executeTask(task, worktreePath || '/tmp', {
      anthropicApiKey: config.anthropicApiKey,
      model: task.model,
      maxTokens: task.maxTokens,
      budgetCents: task.budgetCents,
    });

    // Commit and push changes only if we have a worktree
    let resultCommit = '';
    if (hasRepository && worktreePath) {
      resultCommit = await commitAndPush(worktreePath, task.id, config.agentId);
    }

    const durationMs = Date.now() - startTime;

    return {
      taskId: task.id,
      agentId: config.agentId,
      status: 'success',
      outputs: result.outputs,
      tokensUsed: result.tokensUsed,
      durationMs,
      costCents: calculateCost(result.tokensUsed, task.model),
      baseCommit: task.context.baseCommit || 'unknown',
      resultCommit,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    console.error(`[${config.agentId}] Task ${task.id} failed: ${errorMessage}`);

    return {
      taskId: task.id,
      agentId: config.agentId,
      status: 'failed',
      outputs: {
        filesChanged: [],
      },
      tokensUsed: { input: 0, output: 0, cached: 0 },
      durationMs,
      costCents: 0,
      baseCommit: task.context.baseCommit || 'unknown',
      resultCommit: '',
      error: errorMessage,
    };
  } finally {
    // Cleanup worktree
    if (worktreePath) {
      await cleanupWorktree(worktreePath).catch((err) =>
        console.warn(`[${config.agentId}] Failed to cleanup worktree: ${err}`)
      );
    }
  }
}

// Calculate cost based on token usage and model
function calculateCost(tokens: TokenUsage, model: string): number {
  const pricing =
    model === 'opus'
      ? { input: 5, output: 25, cached: 0.5 } // per MTok in dollars
      : { input: 3, output: 15, cached: 0.3 }; // Sonnet pricing

  const inputCost = (tokens.input / 1_000_000) * pricing.input;
  const outputCost = (tokens.output / 1_000_000) * pricing.output;
  const cachedCost = (tokens.cached / 1_000_000) * pricing.cached;

  return Math.round((inputCost + outputCost + cachedCost) * 100); // Convert to cents
}

// Send result to results queue with retry (skipped if Service Bus not configured)
async function sendResult(result: AgentResult) {
  if (!serviceBusClient) {
    console.log(`[${config.agentId}] Service Bus not configured, skipping result send`);
    return;
  }

  await withRetry(
    async () => {
      const sender = serviceBusClient!.createSender(config.resultQueueName);
      try {
        await sender.sendMessages({
          body: result,
          contentType: 'application/json',
        });
        console.log(`[${config.agentId}] Result sent for task ${result.taskId}`);
      } finally {
        await sender.close();
      }
    },
    {
      maxRetries: 3,
      baseDelayMs: 1000,
      maxDelayMs: 10000,
      retryableErrors: isTransientError,
      onRetry: (attempt, error) => {
        console.warn(
          `[${config.agentId}] Retry ${attempt} sending result: ${error instanceof Error ? error.message : error}`
        );
      },
    }
  );
}

// Save result to blob storage with retry (skipped if storage not configured)
async function saveResultToStorage(result: AgentResult) {
  if (!blobServiceClient) {
    console.log(`[${config.agentId}] Blob storage not configured, skipping result save`);
    // Print result to stdout instead for debugging
    console.log(`[${config.agentId}] Result: ${JSON.stringify(result, null, 2)}`);
    return;
  }

  await withRetry(
    async () => {
      const containerClient = blobServiceClient!.getContainerClient('task-results');
      const blobName = `${result.taskId}/${result.agentId}/result.json`;
      const blockBlobClient = containerClient.getBlockBlobClient(blobName);

      const content = JSON.stringify(result, null, 2);
      await blockBlobClient.upload(content, Buffer.byteLength(content), {
        blobHTTPHeaders: { blobContentType: 'application/json' },
      });

      console.log(`[${config.agentId}] Result saved to storage: ${blobName}`);
    },
    {
      maxRetries: 3,
      baseDelayMs: 1000,
      maxDelayMs: 10000,
      retryableErrors: isTransientError,
      onRetry: (attempt, error) => {
        console.warn(
          `[${config.agentId}] Retry ${attempt} saving to storage: ${error instanceof Error ? error.message : error}`
        );
      },
    }
  );
}

// Main entry point
async function main() {
  await init();

  // Check if we're running with a specific task (from Container Apps Job)
  if (config.taskJson) {
    const task: AgentTask = JSON.parse(config.taskJson);
    const result = await processTask(task);
    await sendResult(result);
    await saveResultToStorage(result);
    console.log(`[${config.agentId}] Task completed, exiting`);
    process.exit(result.status === 'success' ? 0 : 1);
  }

  // Otherwise, listen to queue (for testing/dev)
  if (!serviceBusClient) {
    throw new Error('Service Bus is required for queue mode but not configured');
  }

  console.log(`[${config.agentId}] Listening for tasks on queue: ${config.taskQueueName}`);

  const receiver = serviceBusClient.createReceiver(config.taskQueueName);

  receiver.subscribe({
    processMessage: async (message: ServiceBusReceivedMessage) => {
      const task = message.body as AgentTask;
      const result = await processTask(task);
      await sendResult(result);
      await saveResultToStorage(result);
      await receiver.completeMessage(message);
    },
    processError: async (args) => {
      console.error(`[${config.agentId}] Queue error:`, args.error);
    },
  });

  // Handle shutdown
  process.on('SIGTERM', async () => {
    console.log(`[${config.agentId}] Shutting down...`);
    await receiver.close();
    if (serviceBusClient) {
      await serviceBusClient.close();
    }
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
