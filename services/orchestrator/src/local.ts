/**
 * Local development server for claude-swarm orchestrator
 * Runs without Azure dependencies - uses in-memory store and mock queue
 */

import express, { Request, Response } from 'express';
import helmet from 'helmet';
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

// Configuration (with sensible defaults for local dev)
const config = {
  port: parseInt(process.env.PORT || '3000'),
  maxParallelAgents: parseInt(process.env.MAX_PARALLEL_AGENTS || '5'),
  dailyBudgetCents: parseInt(process.env.DAILY_BUDGET_CENTS || '10000'),
  weeklyBudgetCents: parseInt(process.env.WEEKLY_BUDGET_CENTS || '50000'),
};

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
app.use(express.json({ limit: '1mb' }));

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    mode: 'local-development',
    timestamp: new Date().toISOString(),
    queueLength: taskQueue.length,
    activeAgents: agents.size,
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

  res.json({ success: true, agentId: agent.id, message: 'Execution simulated, will complete in 2s' });
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
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║     🤖 CLAUDE-SWARM ORCHESTRATOR (LOCAL DEV MODE)        ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║  REST API:    http://localhost:${config.port}                      ║`);
  console.log(`║  WebSocket:   ws://localhost:${config.port}/ws                     ║`);
  console.log(`║  Health:      http://localhost:${config.port}/health               ║`);
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log('║  ENDPOINTS:                                              ║');
  console.log('║    POST /api/tasks          - Submit tasks               ║');
  console.log('║    GET  /api/tasks          - List all tasks             ║');
  console.log('║    GET  /api/tasks/:id      - Get task status            ║');
  console.log('║    GET  /api/agents         - List agents                ║');
  console.log('║    GET  /api/budget         - Budget status              ║');
  console.log('║    GET  /api/queue          - Queue status               ║');
  console.log('║    GET  /api/scheduler/ready - Ready tasks               ║');
  console.log('║    GET  /api/conflicts      - Conflict monitor           ║');
  console.log('║    POST /api/simulate/execute/:id - Simulate execution   ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down...');
  await store.close();
  server.close();
  process.exit(0);
});
