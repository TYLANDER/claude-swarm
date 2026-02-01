import { WebSocket, WebSocketServer } from 'ws';
import type { Agent, AgentTask, AgentResult, ConflictInfo } from '@claude-swarm/types';

/**
 * Notification types for WebSocket clients
 */
export type NotificationType =
  | 'task:created'
  | 'task:assigned'
  | 'task:started'
  | 'task:progress'
  | 'task:completed'
  | 'task:failed'
  | 'agent:spawned'
  | 'agent:idle'
  | 'agent:terminated'
  | 'conflict:potential'
  | 'conflict:detected'
  | 'conflict:resolved'
  | 'budget:warning'
  | 'budget:paused'
  | 'system:health';

/**
 * WebSocket message structure
 */
export interface WsNotification {
  type: NotificationType;
  timestamp: string;
  data: unknown;
}

/**
 * Subscription filter for clients
 */
export interface SubscriptionFilter {
  types?: NotificationType[];
  taskIds?: string[];
  agentIds?: string[];
}

/**
 * Client connection with metadata
 */
interface ClientConnection {
  ws: WebSocket;
  filter: SubscriptionFilter;
  connectedAt: string;
  lastPing: string;
  userId?: string;
}

/**
 * Real-time WebSocket notification manager
 */
export class WsNotificationManager {
  private wss: WebSocketServer;
  private clients: Map<string, ClientConnection>;
  private messageBuffer: WsNotification[];
  private bufferSize: number;

  constructor(wss: WebSocketServer, bufferSize: number = 100) {
    this.wss = wss;
    this.clients = new Map();
    this.messageBuffer = [];
    this.bufferSize = bufferSize;

    this.setupServer();
  }

  /**
   * Set up WebSocket server handlers
   */
  private setupServer(): void {
    this.wss.on('connection', (ws, _req) => {
      const clientId = this.generateClientId();

      const client: ClientConnection = {
        ws,
        filter: {},
        connectedAt: new Date().toISOString(),
        lastPing: new Date().toISOString(),
      };

      this.clients.set(clientId, client);

      // Send welcome message with recent history
      this.sendToClient(clientId, {
        type: 'system:health',
        timestamp: new Date().toISOString(),
        data: {
          status: 'connected',
          clientId,
          recentEvents: this.messageBuffer.slice(-10),
        },
      });

      // Handle client messages
      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleClientMessage(clientId, message);
        } catch {
          // Ignore invalid JSON
        }
      });

      // Handle pong for keepalive
      ws.on('pong', () => {
        const c = this.clients.get(clientId);
        if (c) c.lastPing = new Date().toISOString();
      });

      // Handle disconnect
      ws.on('close', () => {
        this.clients.delete(clientId);
      });

      ws.on('error', () => {
        this.clients.delete(clientId);
      });
    });

    // Keepalive ping every 30 seconds
    setInterval(() => {
      this.pingClients();
    }, 30000);
  }

  /**
   * Handle incoming client messages (subscriptions, etc.)
   */
  private handleClientMessage(
    clientId: string,
    message: { action: string; filter?: SubscriptionFilter }
  ): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    switch (message.action) {
      case 'subscribe':
        if (message.filter) {
          client.filter = { ...client.filter, ...message.filter };
        }
        break;

      case 'unsubscribe':
        client.filter = {};
        break;

      case 'history': {
        // Send recent messages matching filter
        const filtered = this.messageBuffer.filter((m) =>
          this.matchesFilter(m, client.filter)
        );
        this.sendToClient(clientId, {
          type: 'system:health',
          timestamp: new Date().toISOString(),
          data: { history: filtered },
        });
        break;
      }
    }
  }

  /**
   * Generate unique client ID
   */
  private generateClientId(): string {
    return `client-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * Ping all clients for keepalive
   */
  private pingClients(): void {
    for (const [clientId, client] of this.clients) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.ping();
      } else {
        this.clients.delete(clientId);
      }
    }
  }

  /**
   * Check if a notification matches a client's filter
   */
  private matchesFilter(notification: WsNotification, filter: SubscriptionFilter): boolean {
    // If no filter, match everything
    if (!filter.types && !filter.taskIds && !filter.agentIds) {
      return true;
    }

    // Check type filter
    if (filter.types && !filter.types.includes(notification.type)) {
      return false;
    }

    // Check task ID filter
    if (filter.taskIds) {
      const data = notification.data as { taskId?: string };
      if (data.taskId && !filter.taskIds.includes(data.taskId)) {
        return false;
      }
    }

    // Check agent ID filter
    if (filter.agentIds) {
      const data = notification.data as { agentId?: string };
      if (data.agentId && !filter.agentIds.includes(data.agentId)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Send notification to a specific client
   */
  private sendToClient(clientId: string, notification: WsNotification): void {
    const client = this.clients.get(clientId);
    if (client && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(notification));
    }
  }

  /**
   * Broadcast notification to all matching clients
   */
  broadcast(notification: WsNotification): void {
    // Add to buffer
    this.messageBuffer.push(notification);
    if (this.messageBuffer.length > this.bufferSize) {
      this.messageBuffer.shift();
    }

    // Send to matching clients
    for (const [clientId, client] of this.clients) {
      if (this.matchesFilter(notification, client.filter)) {
        this.sendToClient(clientId, notification);
      }
    }
  }

  /**
   * Notify task created
   */
  notifyTaskCreated(task: AgentTask): void {
    this.broadcast({
      type: 'task:created',
      timestamp: new Date().toISOString(),
      data: {
        taskId: task.id,
        type: task.type,
        priority: task.priority,
        prompt: task.prompt.slice(0, 100) + '...',
      },
    });
  }

  /**
   * Notify task assigned to agent
   */
  notifyTaskAssigned(task: AgentTask, agentId: string, reason: string): void {
    this.broadcast({
      type: 'task:assigned',
      timestamp: new Date().toISOString(),
      data: {
        taskId: task.id,
        agentId,
        reason,
        taskType: task.type,
      },
    });
  }

  /**
   * Notify task started
   */
  notifyTaskStarted(taskId: string, agentId: string): void {
    this.broadcast({
      type: 'task:started',
      timestamp: new Date().toISOString(),
      data: { taskId, agentId },
    });
  }

  /**
   * Notify task progress
   */
  notifyTaskProgress(
    taskId: string,
    agentId: string,
    progress: { step: string; percent?: number; tokensUsed?: number }
  ): void {
    this.broadcast({
      type: 'task:progress',
      timestamp: new Date().toISOString(),
      data: { taskId, agentId, ...progress },
    });
  }

  /**
   * Notify task completed
   */
  notifyTaskCompleted(result: AgentResult): void {
    this.broadcast({
      type: 'task:completed',
      timestamp: new Date().toISOString(),
      data: {
        taskId: result.taskId,
        agentId: result.agentId,
        status: result.status,
        filesChanged: result.outputs.filesChanged.length,
        durationMs: result.durationMs,
        costCents: result.costCents,
        summary: result.outputs.summary,
      },
    });
  }

  /**
   * Notify task failed
   */
  notifyTaskFailed(taskId: string, agentId: string, error: string): void {
    this.broadcast({
      type: 'task:failed',
      timestamp: new Date().toISOString(),
      data: { taskId, agentId, error },
    });
  }

  /**
   * Notify agent spawned
   */
  notifyAgentSpawned(agent: Agent): void {
    this.broadcast({
      type: 'agent:spawned',
      timestamp: new Date().toISOString(),
      data: {
        agentId: agent.id,
        taskId: agent.currentTask,
        branch: agent.branch,
      },
    });
  }

  /**
   * Notify agent idle
   */
  notifyAgentIdle(agentId: string): void {
    this.broadcast({
      type: 'agent:idle',
      timestamp: new Date().toISOString(),
      data: { agentId },
    });
  }

  /**
   * Notify agent terminated
   */
  notifyAgentTerminated(agentId: string, reason: string): void {
    this.broadcast({
      type: 'agent:terminated',
      timestamp: new Date().toISOString(),
      data: { agentId, reason },
    });
  }

  /**
   * Notify potential conflict
   */
  notifyConflictPotential(
    files: string[],
    agents: string[],
    severity: 'low' | 'medium' | 'high'
  ): void {
    this.broadcast({
      type: 'conflict:potential',
      timestamp: new Date().toISOString(),
      data: { files, agents, severity },
    });
  }

  /**
   * Notify detected conflict
   */
  notifyConflictDetected(conflicts: ConflictInfo[]): void {
    this.broadcast({
      type: 'conflict:detected',
      timestamp: new Date().toISOString(),
      data: { conflicts },
    });
  }

  /**
   * Notify conflict resolved
   */
  notifyConflictResolved(file: string, resolution: 'auto' | 'manual'): void {
    this.broadcast({
      type: 'conflict:resolved',
      timestamp: new Date().toISOString(),
      data: { file, resolution },
    });
  }

  /**
   * Notify budget warning
   */
  notifyBudgetWarning(usedPercent: number, limitType: 'daily' | 'weekly'): void {
    this.broadcast({
      type: 'budget:warning',
      timestamp: new Date().toISOString(),
      data: { usedPercent, limitType },
    });
  }

  /**
   * Notify budget paused
   */
  notifyBudgetPaused(reason: string): void {
    this.broadcast({
      type: 'budget:paused',
      timestamp: new Date().toISOString(),
      data: { reason },
    });
  }

  /**
   * Get connected client count
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * Get client info for monitoring
   */
  getClientInfo(): { id: string; connectedAt: string; filter: SubscriptionFilter }[] {
    return Array.from(this.clients.entries()).map(([id, client]) => ({
      id,
      connectedAt: client.connectedAt,
      filter: client.filter,
    }));
  }
}
