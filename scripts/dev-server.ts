#!/usr/bin/env npx tsx
/**
 * Local development server for Claude Swarm
 *
 * This runs a simplified orchestrator that works without Azure dependencies.
 * Good for testing the API, CLI, and authentication locally.
 *
 * Usage: npx tsx scripts/dev-server.ts
 *
 * Required env vars:
 *   JWT_SECRET - Secret for JWT verification
 *
 * Optional env vars:
 *   PORT - Server port (default: 3000)
 */

import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';

// Config
const PORT = parseInt(process.env.PORT || '3000');
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

// Task type for dev server
interface DevTask {
  id: string;
  type: string;
  model?: string;
  status: string;
  createdAt: string;
  assignedAgent?: string;
  context?: { branch?: string };
}

// Agent type for dev server
interface DevAgent {
  id: string;
  status: string;
  currentTask?: string;
  startedAt: string;
  completedAt?: string;
  branch?: string;
  tokensUsed: { input: number; output: number; cached: number };
  costCents: number;
}

// Result type for dev server
interface DevResult {
  taskId: string;
  agentId: string;
  status: string;
  outputs: { filesChanged: string[]; summary: string };
  tokensUsed: { input: number; output: number; cached: number };
  durationMs: number;
  costCents: number;
  baseCommit: string;
  resultCommit: string;
}

// In-memory state
const tasks = new Map<string, DevTask>();
const results = new Map<string, DevResult>();
const agents = new Map<string, DevAgent>();

// Express app
const app = express();
app.use(helmet());
app.use(express.json());

// Extend Request to include user
interface AuthenticatedRequest extends Request {
  user?: string | jwt.JwtPayload;
}

// Auth middleware
function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authorization header required' });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    (req as AuthenticatedRequest).user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// Health check (no auth)
app.get('/health', (_req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString(), mode: 'development' });
});

// Protected routes
app.use('/api', authMiddleware);

// Submit tasks
app.post('/api/tasks', async (req: Request, res: Response) => {
  try {
    const { tasks: taskInputs } = req.body;

    const taskIds: string[] = [];
    let estimatedCostCents = 0;

    for (const taskInput of taskInputs) {
      const task = {
        ...taskInput,
        id: uuidv4(),
        createdAt: new Date().toISOString(),
        status: 'pending',
      };

      tasks.set(task.id, task);
      taskIds.push(task.id);

      // Simulate cost estimate
      const perTaskEstimate = task.model === 'opus' ? 200 : 120;
      estimatedCostCents += perTaskEstimate;

      console.log(`📋 Task queued: ${task.id} (${task.type})`);

      // In dev mode, simulate task processing after a delay
      simulateTaskProcessing(task);
    }

    res.json({ taskIds, estimatedCostCents });
  } catch (error) {
    console.error('Error submitting tasks:', error);
    res.status(500).json({ error: 'Failed to submit tasks' });
  }
});

// Get task status
app.get('/api/tasks/:id', (req: Request, res: Response) => {
  const task = tasks.get(req.params.id);
  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  const result = results.get(req.params.id);
  res.json({ task, result });
});

// Cancel task
app.post('/api/tasks/:id/cancel', (req: Request, res: Response) => {
  const task = tasks.get(req.params.id);
  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  task.status = 'cancelled';
  res.json({ success: true });
});

// List agents
app.get('/api/agents', (_req: Request, res: Response) => {
  const agentList = Array.from(agents.values());
  res.json({
    agents: agentList,
    totalActive: agentList.filter((a) => a.status === 'running').length,
    totalCostCents: agentList.reduce((sum, a) => sum + (a.costCents || 0), 0),
  });
});

// Budget
app.get('/api/budget', (_req: Request, res: Response) => {
  res.json({
    status: {
      config: {
        perTaskMaxCents: 500,
        dailyLimitCents: 10000,
        weeklyLimitCents: 50000,
        alertThresholdPercent: 80,
        pauseThresholdPercent: 100,
      },
      dailyUsedCents: 0,
      weeklyUsedCents: 0,
      isPaused: false,
      lastUpdated: new Date().toISOString(),
    },
    projectedDailyCostCents: 0,
  });
});

// Simulate task processing (for dev mode)
async function simulateTaskProcessing(task: DevTask) {
  // Create simulated agent
  const agentId = `dev-agent-${uuidv4().slice(0, 8)}`;
  const agent = {
    id: agentId,
    status: 'running',
    currentTask: task.id,
    startedAt: new Date().toISOString(),
    branch: task.context?.branch,
    tokensUsed: { input: 0, output: 0, cached: 0 },
    costCents: 0,
  };
  agents.set(agentId, agent);
  task.status = 'running';
  task.assignedAgent = agentId;

  console.log(`🤖 Agent ${agentId} processing task ${task.id}`);

  // Simulate processing time (2-5 seconds in dev)
  const processingTime = 2000 + Math.random() * 3000;
  await new Promise((resolve) => setTimeout(resolve, processingTime));

  // Complete the task
  const result = {
    taskId: task.id,
    agentId,
    status: 'success',
    outputs: {
      filesChanged: [],
      summary: `[DEV MODE] Simulated completion of ${task.type} task`,
    },
    tokensUsed: { input: 1000, output: 500, cached: 200 },
    durationMs: processingTime,
    costCents: task.model === 'opus' ? 150 : 80,
    baseCommit: 'dev-commit',
    resultCommit: 'dev-result',
  };

  results.set(task.id, result);
  task.status = 'completed';
  agent.status = 'completed';
  agent.completedAt = new Date().toISOString();
  agent.tokensUsed = result.tokensUsed;
  agent.costCents = result.costCents;

  console.log(`✅ Task ${task.id} completed by ${agentId}`);

  // Broadcast to WebSocket clients
  broadcastUpdate({ type: 'task_completed', taskId: task.id, status: 'success' });
}

// WebSocket
const wsClients = new Set<WebSocket>();

function broadcastUpdate(data: { type: string; taskId: string; status: string }) {
  const message = JSON.stringify(data);
  wsClients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// Start server
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/api/events' });

wss.on('connection', (ws) => {
  wsClients.add(ws);
  console.log('🔌 WebSocket client connected');
  ws.on('close', () => {
    wsClients.delete(ws);
    console.log('🔌 WebSocket client disconnected');
  });
});

server.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║           Claude Swarm - Development Server                ║
╠════════════════════════════════════════════════════════════╣
║                                                            ║
║  🚀 Server running at http://localhost:${PORT}               ║
║                                                            ║
║  📋 Endpoints:                                             ║
║     GET  /health           - Health check                  ║
║     POST /api/tasks        - Submit tasks                  ║
║     GET  /api/tasks/:id    - Get task status               ║
║     GET  /api/agents       - List agents                   ║
║     GET  /api/budget       - Budget status                 ║
║     WS   /api/events       - Real-time updates             ║
║                                                            ║
║  🔐 Generate a token:                                      ║
║     npx tsx scripts/generate-jwt.ts                        ║
║                                                            ║
║  💡 Note: Tasks are simulated in dev mode                  ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
`);
});
