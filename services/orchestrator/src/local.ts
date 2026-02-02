/**
 * Local development server for claude-swarm orchestrator
 *
 * Modes:
 * - Azure (EXECUTOR_TYPE=azure): Uses Azure Container Apps Jobs
 * - Fly.io (EXECUTOR_TYPE=fly): Uses Fly.io Machines API
 * - Simulate (SIMULATE_MODE=true): Mock execution for testing
 */

import express, { Request, Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { v4 as uuidv4 } from 'uuid';
import type {
  AgentTask,
  AgentResult,
  SubmitTaskResponse,
  TaskStatusResponse,
  AgentListResponse,
  BudgetResponse,
  Agent,
} from '@claude-swarm/types';
import { MemoryStore } from './store/memoryStore.js';
import { TaskScheduler } from './scheduler/index.js';
import { ConflictMonitor, WsNotificationManager } from './monitoring/index.js';
import { AgentScoring } from './routing/agentScoring.js';
import { createExecutor, configFromEnv, type ExecutorType } from './executor/index.js';
import { generateToken } from './auth/index.js';

// Configuration (with sensible defaults for local dev)
const config = {
  port: parseInt(process.env.PORT || '3000'),
  maxParallelAgents: parseInt(process.env.MAX_PARALLEL_AGENTS || '5'),
  dailyBudgetCents: parseInt(process.env.DAILY_BUDGET_CENTS || '10000'),
  weeklyBudgetCents: parseInt(process.env.WEEKLY_BUDGET_CENTS || '50000'),
  simulateMode: process.env.SIMULATE_MODE === 'true',
  executorType: (process.env.EXECUTOR_TYPE || 'mock') as ExecutorType,
};

// Load executor config from environment (supports Azure, Fly.io, or mock)
const executorConfig = configFromEnv();

// Create executor based on EXECUTOR_TYPE env var
const executor = createExecutor(executorConfig);

// Initialize stores and services
const store = new MemoryStore();
const scheduler = new TaskScheduler(store);
const scoring = new AgentScoring(store);
const conflictMonitor = new ConflictMonitor(store);

// In-memory task queue (replaces Azure Service Bus)
const taskQueue: AgentTask[] = [];
const results = new Map<string, AgentResult>();
const agents = new Map<string, Agent>();

// Express app
const app = express();
app.use(helmet());

// CORS configuration for mobile/desktop apps
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [
  'http://localhost:3000',
  'http://localhost:5173', // Vite dev
  'capacitor://localhost', // iOS
  'http://localhost', // Android
];
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, curl, etc.)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      callback(new Error('CORS not allowed'));
    },
    credentials: true,
  })
);

app.use(express.json({ limit: '1mb' }));

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    mode: config.simulateMode ? 'simulate' : config.executorType,
    executor: executorConfig.type,
    timestamp: new Date().toISOString(),
    queueLength: taskQueue.length,
    activeAgents: agents.size,
    executorActiveJobs: executor.getActiveJobCount(),
  });
});

// Submit tasks
app.post('/api/tasks', async (req: Request, res: Response) => {
  try {
    const { tasks: taskInputs } = req.body;

    if (!taskInputs || !Array.isArray(taskInputs)) {
      res.status(400).json({ error: 'tasks array required' });
      return;
    }

    const taskIds: string[] = [];
    let estimatedCostCents = 0;

    for (const taskInput of taskInputs) {
      const task: AgentTask = {
        ...taskInput,
        id: uuidv4(),
        createdAt: new Date().toISOString(),
        status: 'pending',
      };

      // Store and queue task
      await store.setTask(task);
      await scheduler.registerTask(task);
      taskQueue.push(task);
      taskIds.push(task.id);

      // Estimate cost
      const perTaskEstimate = task.model === 'opus' ? 200 : 120;
      estimatedCostCents += perTaskEstimate;

      console.log(`📝 Task queued: ${task.id} (${task.type})`);
    }

    const response: SubmitTaskResponse = { taskIds, estimatedCostCents };
    res.json(response);
  } catch (error) {
    console.error('Error submitting tasks:', error);
    res.status(500).json({ error: 'Failed to submit tasks' });
  }
});

// Get task status
app.get('/api/tasks/:id', async (req: Request, res: Response) => {
  const taskId = req.params.id as string;
  const task = await store.getTask(taskId);

  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }

  const result = results.get(taskId);
  const response: TaskStatusResponse = { task, result };
  res.json(response);
});

// List all tasks
app.get('/api/tasks', async (_req: Request, res: Response) => {
  const tasks = await store.listTasks();
  res.json({ tasks, total: tasks.length });
});

// Cancel task
app.post('/api/tasks/:id/cancel', async (req: Request, res: Response) => {
  const taskId = req.params.id as string;
  const task = await store.getTask(taskId);

  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }

  task.status = 'cancelled';
  await store.setTask(task);
  console.log(`❌ Task cancelled: ${taskId}`);
  res.json({ success: true });
});

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
app.get('/api/budget', async (_req: Request, res: Response) => {
  const budget = await store.getBudget();
  const activeAgents = await store.countActiveAgents();
  const avgCostPerAgent = 150;
  const projectedDailyCostCents = budget.dailyUsedCents + activeAgents * avgCostPerAgent;

  const response: BudgetResponse = {
    status: budget,
    projectedDailyCostCents,
  };
  res.json(response);
});

// Get queue status
app.get('/api/queue', (_req: Request, res: Response) => {
  res.json({
    pending: taskQueue.filter((t) => t.status === 'pending').length,
    total: taskQueue.length,
    tasks: taskQueue.slice(0, 10).map((t) => ({
      id: t.id,
      type: t.type,
      priority: t.priority,
      status: t.status,
    })),
  });
});

// Get ready tasks (for debugging scheduler)
app.get('/api/scheduler/ready', async (_req: Request, res: Response) => {
  const ready = await scheduler.getQueueableTasks();
  res.json({
    readyCount: ready.length,
    tasks: ready.map((t) => ({ id: t.id, type: t.type, priority: t.priority })),
  });
});

// Get conflict monitor status
app.get('/api/conflicts', (_req: Request, res: Response) => {
  const locks = conflictMonitor.getActiveLocks();
  const stats = conflictMonitor.getConflictStats();
  res.json({ activeLocks: locks, stats });
});

// ============================================================================
// App Backend API Endpoints (for iOS/macOS apps)
// ============================================================================

// Generate authentication token
app.post('/api/auth/token', (req: Request, res: Response) => {
  const { apiKey } = req.body;

  // In production, validate apiKey against stored hashes
  // For development, accept any key that matches format
  if (!apiKey || typeof apiKey !== 'string') {
    res.status(400).json({ error: 'apiKey required' });
    return;
  }

  // Generate token (in production, validate the API key first)
  const { token, expiresAt } = generateToken(`user:${apiKey.slice(0, 10)}`, {
    expiresInSeconds: 7 * 24 * 60 * 60, // 7 days
    scopes: ['tasks:read', 'tasks:write', 'agents:read', 'budget:read'],
  });

  res.json({ token, expiresAt: expiresAt.toISOString() });
});

// Get current provider information
app.get('/api/provider', (_req: Request, res: Response) => {
  const providerInfo = {
    type: executorConfig.type,
    configured: true,
    details: {} as Record<string, unknown>,
  };

  if (executorConfig.type === 'fly' && executorConfig.fly) {
    providerInfo.details = {
      appName: executorConfig.fly.appName,
      region: executorConfig.fly.region || 'ord',
    };
  } else if (executorConfig.type === 'azure' && executorConfig.azure) {
    providerInfo.details = {
      resourceGroup: executorConfig.azure.resourceGroup,
      agentJobName: executorConfig.azure.agentJobName,
    };
  } else if (executorConfig.type === 'mock') {
    providerInfo.details = {
      mode: 'simulate',
    };
  }

  res.json(providerInfo);
});

// Get aggregate metrics
app.get('/api/metrics', async (_req: Request, res: Response) => {
  try {
    const tasks = await store.listTasks();
    const budget = await store.getBudget();
    const agentList = Array.from(agents.values());

    // Calculate metrics
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());

    const completedToday = tasks.filter(
      (t) => t.status === 'completed' && new Date(t.createdAt) >= todayStart
    ).length;

    const completedThisWeek = tasks.filter(
      (t) => t.status === 'completed' && new Date(t.createdAt) >= weekStart
    ).length;

    const failedToday = tasks.filter(
      (t) => t.status === 'failed' && new Date(t.createdAt) >= todayStart
    ).length;

    const successRate =
      completedToday + failedToday > 0
        ? Math.round((completedToday / (completedToday + failedToday)) * 100)
        : 100;

    res.json({
      tasks: {
        total: tasks.length,
        pending: tasks.filter((t) => t.status === 'pending').length,
        running: tasks.filter((t) => t.status === 'running').length,
        completedToday,
        completedThisWeek,
        failedToday,
        successRate,
      },
      agents: {
        total: agentList.length,
        active: agentList.filter((a) => a.status === 'running').length,
        executorJobs: executor.getActiveJobCount(),
      },
      budget: {
        dailyUsedCents: budget.dailyUsedCents,
        weeklyUsedCents: budget.weeklyUsedCents,
        dailyLimitCents: budget.config.dailyLimitCents,
        weeklyLimitCents: budget.config.weeklyLimitCents,
        isPaused: budget.isPaused,
      },
      provider: executorConfig.type,
      timestamp: now.toISOString(),
    });
  } catch (error) {
    console.error('Error fetching metrics:', error);
    res.status(500).json({ error: 'Failed to fetch metrics' });
  }
});

// Simulate task execution (for testing)
app.post('/api/simulate/execute/:taskId', async (req: Request, res: Response) => {
  const taskId = req.params.taskId as string;
  const task = await store.getTask(taskId);

  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }

  // Simulate execution
  task.status = 'running';
  task.assignedAgent = `sim-agent-${uuidv4().slice(0, 8)}`;
  await store.setTask(task);

  // Create mock agent
  const agent: Agent = {
    id: task.assignedAgent,
    status: 'running',
    currentTask: task.id,
    startedAt: new Date().toISOString(),
    branch: task.context.branch,
    tokensUsed: { input: 0, output: 0, cached: 0 },
    costCents: 0,
  };
  agents.set(agent.id, agent);

  console.log(`🚀 Simulating execution: ${taskId} -> ${agent.id}`);

  // Simulate completion after 2 seconds
  setTimeout(async () => {
    task.status = 'completed';
    await store.setTask(task);

    agent.status = 'completed';
    agent.completedAt = new Date().toISOString();
    agent.tokensUsed = { input: 5000, output: 2000, cached: 1000 };
    agent.costCents = 75;

    const result: AgentResult = {
      taskId: task.id,
      agentId: agent.id,
      status: 'success',
      outputs: {
        filesChanged: [{ path: 'src/example.ts', action: 'modify' }],
        summary: 'Simulated task completion',
      },
      tokensUsed: agent.tokensUsed,
      durationMs: 2000,
      costCents: agent.costCents,
      baseCommit: 'abc123',
      resultCommit: 'def456',
    };
    results.set(taskId, result);
    await store.setResult(result);

    // Update scoring
    await scoring.recordResult(result, task);

    // Notify newly unblocked tasks
    const newlyReady = await scheduler.completeTask(taskId);
    if (newlyReady.length > 0) {
      console.log(`📋 Unblocked tasks: ${newlyReady.join(', ')}`);
    }

    console.log(`✅ Simulated completion: ${taskId}`);
  }, 2000);

  res.json({
    success: true,
    agentId: agent.id,
    message: 'Execution simulated, will complete in 2s',
  });
});

// Auto-execute ready tasks endpoint (must be before :taskId route)
app.post('/api/execute/batch', async (_req: Request, res: Response) => {
  const readyTasks = await scheduler.getQueueableTasks();
  const maxToStart = config.maxParallelAgents - executor.getActiveJobCount();
  const tasksToStart = readyTasks.slice(0, Math.max(0, maxToStart));

  const started: string[] = [];
  for (const task of tasksToStart) {
    try {
      const { jobExecutionId, agentId } = await executor.executeTask(task);
      task.status = 'running';
      task.assignedAgent = agentId;
      await store.setTask(task);

      const agent: Agent = {
        id: agentId,
        status: 'running',
        currentTask: task.id,
        startedAt: new Date().toISOString(),
        branch: task.context.branch,
        tokensUsed: { input: 0, output: 0, cached: 0 },
        costCents: 0,
      };
      agents.set(agentId, agent);
      started.push(task.id);

      // Monitor execution in background
      monitorExecution(jobExecutionId, task, agent);
    } catch (error) {
      console.error(`Failed to start task ${task.id}:`, error);
    }
  }

  res.json({
    started: started.length,
    taskIds: started,
    activeJobs: executor.getActiveJobCount(),
    mode: config.simulateMode ? 'simulate' : 'azure',
  });
});

// Background execution monitor
async function monitorExecution(executionId: string, task: AgentTask, agent: Agent) {
  const { status } = await executor.waitForCompletion(executionId, task.timeoutMinutes * 60 * 1000);

  if (status === 'completed') {
    task.status = 'completed';
    agent.status = 'completed';
    agent.completedAt = new Date().toISOString();
    // In real mode, these would come from blob storage
    agent.tokensUsed = { input: 5000, output: 2000, cached: 1000 };
    agent.costCents = task.model === 'opus' ? 150 : 75;

    const result: AgentResult = {
      taskId: task.id,
      agentId: agent.id,
      status: 'success',
      outputs: {
        filesChanged: [],
        summary: 'Task completed',
      },
      tokensUsed: agent.tokensUsed,
      durationMs: Date.now() - new Date(agent.startedAt || Date.now()).getTime(),
      costCents: agent.costCents,
      baseCommit: 'abc123',
      resultCommit: 'def456',
    };
    results.set(task.id, result);
    await store.setResult(result);
    await scoring.recordResult(result, task);

    const newlyReady = await scheduler.completeTask(task.id);
    if (newlyReady.length > 0) {
      console.log(`📋 Unblocked tasks: ${newlyReady.join(', ')}`);
    }
    console.log(`✅ Task completed: ${task.id}`);
  } else {
    task.status = 'failed';
    agent.status = 'failed';
    agent.completedAt = new Date().toISOString();
    console.log(`❌ Task ${status}: ${task.id}`);
  }

  await store.setTask(task);
}

// Execute task via Azure executor (or mock in simulate mode)
app.post('/api/execute/:taskId', async (req: Request, res: Response) => {
  const taskId = req.params.taskId as string;
  const task = await store.getTask(taskId);

  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }

  if (task.status !== 'pending') {
    res.status(400).json({ error: `Task is already ${task.status}` });
    return;
  }

  try {
    // Spawn execution via executor
    const { jobExecutionId, agentId } = await executor.executeTask(task);

    // Update task status
    task.status = 'running';
    task.assignedAgent = agentId;
    await store.setTask(task);

    // Create agent record
    const agent: Agent = {
      id: agentId,
      status: 'running',
      currentTask: task.id,
      startedAt: new Date().toISOString(),
      branch: task.context.branch,
      tokensUsed: { input: 0, output: 0, cached: 0 },
      costCents: 0,
    };
    agents.set(agentId, agent);

    // Monitor execution in background
    monitorExecution(jobExecutionId, task, agent);

    res.json({
      success: true,
      agentId,
      jobExecutionId,
      mode: config.simulateMode ? 'simulate' : 'azure',
    });
  } catch (error) {
    console.error(`Failed to execute task ${taskId}:`, error);
    res.status(500).json({ error: 'Failed to start execution' });
  }
});

// Create HTTP server
const server = createServer(app);

// WebSocket server for real-time notifications
const wss = new WebSocketServer({ server, path: '/ws' });
const wsManager = new WsNotificationManager(wss);

// Log WebSocket connections
wss.on('connection', (ws: WebSocket) => {
  console.log(`🔌 WebSocket client connected (${wsManager.getClientCount()} total)`);
  ws.on('close', () => {
    console.log(`🔌 WebSocket client disconnected`);
  });
});

// Start server
server.listen(config.port, () => {
  const modeLabels: Record<string, { label: string; icon: string }> = {
    simulate: { label: 'SIMULATE MODE', icon: '🎭' },
    mock: { label: 'MOCK MODE', icon: '🎭' },
    azure: { label: 'AZURE MODE', icon: '☁️' },
    fly: { label: 'FLY.IO MODE', icon: '🪰' },
  };
  const mode = config.simulateMode ? 'simulate' : executorConfig.type;
  const { label: modeLabel, icon: modeIcon } = modeLabels[mode] || modeLabels.mock;
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log(`║  ${modeIcon} CLAUDE-SWARM ORCHESTRATOR (${modeLabel.padEnd(14)})    ║`);
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║  REST API:    http://localhost:${config.port}                      ║`);
  console.log(`║  WebSocket:   ws://localhost:${config.port}/ws                     ║`);
  console.log(`║  Health:      http://localhost:${config.port}/health               ║`);
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log('║  ENDPOINTS:                                              ║');
  console.log('║    POST /api/tasks          - Submit tasks               ║');
  console.log('║    GET  /api/tasks          - List all tasks             ║');
  console.log('║    GET  /api/tasks/:id      - Get task status            ║');
  console.log('║    POST /api/execute/:id    - Execute single task        ║');
  console.log('║    POST /api/execute/batch  - Execute ready tasks        ║');
  console.log('║    GET  /api/agents         - List agents                ║');
  console.log('║    GET  /api/budget         - Budget status              ║');
  console.log('║    GET  /api/queue          - Queue status               ║');
  console.log('║    GET  /api/scheduler/ready - Ready tasks               ║');
  console.log('║    GET  /api/conflicts      - Conflict monitor           ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  if (config.simulateMode || executorConfig.type === 'mock') {
    console.log('');
    console.log('  🎭 Running in simulate mode - no cloud resources used');
  }
  console.log('');
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down...');
  await store.close();
  server.close();
  process.exit(0);
});
