import express, { Request, Response } from 'express';
import helmet from 'helmet';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer, IncomingMessage } from 'http';
import { ServiceBusClient } from '@azure/service-bus';
import { ContainerAppsAPIClient } from '@azure/arm-appcontainers';
import { ManagedIdentityCredential } from '@azure/identity';
import { v4 as uuidv4 } from 'uuid';
import type {
  AgentTask,
  AgentResult,
  SubmitTaskResponse,
  TaskStatusResponse,
  AgentListResponse,
  BudgetResponse,
  BudgetStatus,
  Agent,
} from '@claude-swarm/types';
import {
  authMiddleware,
  authenticateWebSocket,
  validateBody,
  validateParams,
  taskSubmissionLimiter,
  statusQueryLimiter,
  generalLimiter,
  checkWebSocketRateLimit,
  cleanupWebSocketRateLimits,
} from './middleware/index.js';
import {
  SubmitTaskRequestSchema,
  TaskIdParamSchema,
  type SubmitTaskRequest,
} from './schemas/task.js';

// Configuration
const config = {
  port: parseInt(process.env.PORT || '3000'),
  serviceBusConnection: process.env.AZURE_SERVICE_BUS_CONNECTION!,
  subscriptionId: process.env.AZURE_SUBSCRIPTION_ID!,
  resourceGroup: process.env.AZURE_RESOURCE_GROUP!,
  agentJobName: process.env.AGENT_JOB_NAME!,
  maxParallelAgents: parseInt(process.env.MAX_PARALLEL_AGENTS || '25'),
  dailyBudgetCents: parseInt(process.env.DAILY_BUDGET_CENTS || '10000'),
  weeklyBudgetCents: parseInt(process.env.WEEKLY_BUDGET_CENTS || '50000'),
  managedIdentityClientId: process.env.AZURE_CLIENT_ID,
};

// State
const tasks = new Map<string, AgentTask>();
const results = new Map<string, AgentResult>();
const agents = new Map<string, Agent>();
const budgetStatus: BudgetStatus = {
  config: {
    perTaskMaxCents: 500,
    dailyLimitCents: config.dailyBudgetCents,
    weeklyLimitCents: config.weeklyBudgetCents,
    alertThresholdPercent: 80,
    pauseThresholdPercent: 100,
  },
  dailyUsedCents: 0,
  weeklyUsedCents: 0,
  isPaused: false,
  lastUpdated: new Date().toISOString(),
};

// Clients
let serviceBusClient: ServiceBusClient;
let containerAppsClient: ContainerAppsAPIClient;

// Express app
const app = express();

// Security middleware
app.use(helmet());
app.use(express.json({ limit: '1mb' }));

// Apply general rate limit to all routes
app.use(generalLimiter);

// Health check (no auth required)
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// All /api/* routes require authentication
app.use('/api', authMiddleware);

// Submit tasks
app.post(
  '/api/tasks',
  taskSubmissionLimiter,
  validateBody(SubmitTaskRequestSchema),
  async (req: Request, res: Response) => {
    try {
      const body = req.body as SubmitTaskRequest;

      if (budgetStatus.isPaused) {
        res.status(503).json({ error: 'Budget limit reached, submissions paused' });
        return;
      }

      const taskIds: string[] = [];
      let estimatedCostCents = 0;

      for (const taskInput of body.tasks) {
        const task: AgentTask = {
          ...taskInput,
          id: uuidv4(),
          createdAt: new Date().toISOString(),
          status: 'pending',
        };

        // Store task
        tasks.set(task.id, task);
        taskIds.push(task.id);

        // Estimate cost (rough: assume 100k tokens per task)
        const perTaskEstimate = task.model === 'opus' ? 200 : 120; // cents
        estimatedCostCents += perTaskEstimate;

        // Queue task
        await queueTask(task);
      }

      const response: SubmitTaskResponse = { taskIds, estimatedCostCents };
      res.json(response);
    } catch (error) {
      console.error('Error submitting tasks:', error);
      res.status(500).json({ error: 'Failed to submit tasks' });
    }
  }
);

// Get task status
app.get(
  '/api/tasks/:id',
  statusQueryLimiter,
  validateParams(TaskIdParamSchema),
  (req: Request, res: Response) => {
    const taskId = req.params.id as string;
    const task = tasks.get(taskId);
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    const result = results.get(taskId);
    const response: TaskStatusResponse = { task, result };
    res.json(response);
  }
);

// Cancel task
app.post(
  '/api/tasks/:id/cancel',
  validateParams(TaskIdParamSchema),
  async (req: Request, res: Response) => {
    const taskId = req.params.id as string;
    const task = tasks.get(taskId);
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    task.status = 'cancelled';
    res.json({ success: true });
  }
);

// List agents
app.get('/api/agents', (_req: Request, res: Response) => {
  const agentList = Array.from(agents.values());
  const totalActive = agentList.filter((a) => a.status === 'running').length;
  const totalCostCents = agentList.reduce((sum, a) => sum + a.costCents, 0);

  const response: AgentListResponse = {
    agents: agentList,
    totalActive,
    totalCostCents,
  };
  res.json(response);
});

// Get budget status
app.get('/api/budget', (_req: Request, res: Response) => {
  const activeAgents = Array.from(agents.values()).filter((a) => a.status === 'running').length;
  const avgCostPerAgent = 150; // cents estimate
  const projectedDailyCostCents = budgetStatus.dailyUsedCents + activeAgents * avgCostPerAgent;

  const response: BudgetResponse = {
    status: budgetStatus,
    projectedDailyCostCents,
  };
  res.json(response);
});

// Queue a task to Service Bus
async function queueTask(task: AgentTask) {
  const queueName =
    task.priority === 'high'
      ? 'agent-tasks-high'
      : task.priority === 'low'
        ? 'agent-tasks-low'
        : 'agent-tasks';

  const sender = serviceBusClient.createSender(queueName);
  try {
    await sender.sendMessages({
      body: task,
      contentType: 'application/json',
      messageId: task.id,
    });
    console.log(`Task ${task.id} queued to ${queueName}`);
  } finally {
    await sender.close();
  }
}

// Spawn an agent for a task
async function spawnAgent(task: AgentTask) {
  if (agents.size >= config.maxParallelAgents) {
    console.warn('Max parallel agents reached, task will wait in queue');
    return;
  }

  const agentId = `agent-${uuidv4().slice(0, 8)}`;

  // Track agent
  const agent: Agent = {
    id: agentId,
    status: 'initializing',
    currentTask: task.id,
    startedAt: new Date().toISOString(),
    branch: task.context.branch,
    tokensUsed: { input: 0, output: 0, cached: 0 },
    costCents: 0,
  };
  agents.set(agentId, agent);

  // Update task
  task.status = 'assigned';
  task.assignedAgent = agentId;

  try {
    // Start Container Apps Job execution
    await containerAppsClient.jobs.beginStartAndWait(config.resourceGroup, config.agentJobName, {
      template: {
        containers: [
          {
            name: 'claude-agent',
            image: `${process.env.CONTAINER_REGISTRY_URL || 'claudeswarmdevacr.azurecr.io'}/claude-agent-worker:latest`,
            env: [
              { name: 'AGENT_ID', value: agentId },
              { name: 'TASK_JSON', value: JSON.stringify(task) },
            ],
          },
        ],
      },
    });

    agent.status = 'running';
    task.status = 'running';
    console.log(`Agent ${agentId} spawned for task ${task.id}`);
  } catch (error) {
    agent.status = 'failed';
    task.status = 'failed';
    console.error(`Failed to spawn agent ${agentId}:`, error);
  }
}

// Process tasks from the queue and spawn agents
async function processTasks() {
  // Process all priority queues
  const queues = ['agent-tasks-high', 'agent-tasks', 'agent-tasks-low'];

  for (const queueName of queues) {
    const receiver = serviceBusClient.createReceiver(queueName);

    receiver.subscribe({
      processMessage: async (message) => {
        const task = message.body as AgentTask;

        // Update local task state if we have it
        const existingTask = tasks.get(task.id);
        if (existingTask) {
          Object.assign(existingTask, task);
        } else {
          tasks.set(task.id, task);
        }

        // Spawn agent for the task
        await spawnAgent(tasks.get(task.id)!);

        await receiver.completeMessage(message);
        console.log(`Task ${task.id} picked up from ${queueName}`);
      },
      processError: async (args) => {
        console.error(`Error processing tasks from ${queueName}:`, args.error);
      },
    });

    console.log(`Listening for tasks on ${queueName}`);
  }
}

// Process results from agents
async function processResults() {
  const receiver = serviceBusClient.createReceiver('agent-results');

  receiver.subscribe({
    processMessage: async (message) => {
      const result = message.body as AgentResult;

      // Store result
      results.set(result.taskId, result);

      // Update task status
      const task = tasks.get(result.taskId);
      if (task) {
        task.status = result.status === 'success' ? 'completed' : 'failed';
      }

      // Update agent
      const agent = agents.get(result.agentId);
      if (agent) {
        agent.status = 'completed';
        agent.completedAt = new Date().toISOString();
        agent.tokensUsed = result.tokensUsed;
        agent.costCents = result.costCents;
      }

      // Update budget
      budgetStatus.dailyUsedCents += result.costCents;
      budgetStatus.weeklyUsedCents += result.costCents;
      budgetStatus.lastUpdated = new Date().toISOString();

      // Check budget limits
      if (budgetStatus.dailyUsedCents >= budgetStatus.config.dailyLimitCents) {
        budgetStatus.isPaused = true;
        console.warn('Daily budget limit reached, pausing new submissions');
      }

      // Broadcast to WebSocket clients
      broadcastUpdate({
        type: 'task_completed',
        taskId: result.taskId,
        status: result.status,
        costCents: result.costCents,
      });

      await receiver.completeMessage(message);
      console.log(`Result processed for task ${result.taskId}`);
    },
    processError: async (args) => {
      console.error('Error processing results:', args.error);
    },
  });
}

// WebSocket for real-time updates
const wsClients = new Set<WebSocket>();

function broadcastUpdate(data: unknown) {
  const message = JSON.stringify(data);
  wsClients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// Initialize
async function init() {
  // Initialize Service Bus client
  serviceBusClient = new ServiceBusClient(config.serviceBusConnection);

  // Initialize Container Apps client with managed identity
  const credential = new ManagedIdentityCredential({
    clientId: config.managedIdentityClientId,
  });
  containerAppsClient = new ContainerAppsAPIClient(credential, config.subscriptionId);

  // Start processing tasks from queues
  await processTasks();

  // Start processing results
  await processResults();

  console.log('Orchestrator initialized');
}

// Start server
async function main() {
  await init();

  const server = createServer(app);

  // WebSocket server with authentication
  const wss = new WebSocketServer({ server, path: '/api/events' });

  wss.on('connection', (ws: WebSocket, request: IncomingMessage) => {
    // Extract client IP for rate limiting
    const forwarded = request.headers['x-forwarded-for'];
    const clientIp =
      typeof forwarded === 'string'
        ? forwarded.split(',')[0].trim()
        : request.socket.remoteAddress || 'unknown';

    // Check rate limit
    if (!checkWebSocketRateLimit(clientIp)) {
      ws.close(1008, 'Rate limit exceeded');
      console.log(`WebSocket connection rejected (rate limit): ${clientIp}`);
      return;
    }

    // Authenticate WebSocket connection
    const user = authenticateWebSocket(request);
    if (!user) {
      ws.close(1008, 'Authentication required');
      console.log(`WebSocket connection rejected (auth): ${clientIp}`);
      return;
    }

    wsClients.add(ws);
    console.log(`WebSocket client connected: ${user.sub}`);

    ws.on('close', () => {
      wsClients.delete(ws);
      console.log(`WebSocket client disconnected: ${user.sub}`);
    });
  });

  // Periodic cleanup of rate limit records
  const rateLimitCleanupInterval = setInterval(cleanupWebSocketRateLimits, 5 * 60 * 1000);

  server.listen(config.port, () => {
    console.log(`Orchestrator listening on port ${config.port}`);
  });

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('Shutting down...');
    clearInterval(rateLimitCleanupInterval);
    await serviceBusClient.close();
    server.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
