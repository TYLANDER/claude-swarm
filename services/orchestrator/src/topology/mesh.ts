import { v4 as uuidv4 } from "uuid";
import type { AgentTask, AgentResult } from "@claude-swarm/types";
import type { TopologyHandler, TopologyConfig, AgentMessage } from "./types.js";
import type { StateStore } from "../store/types.js";
import type { Logger } from "pino";

/**
 * Mesh topology: Agents can communicate directly with each other
 *
 * This topology enables:
 * - Peer-to-peer agent communication
 * - Collaborative problem solving
 * - Knowledge sharing between agents
 * - Good for tasks requiring coordination
 */
export class MeshTopology implements TopologyHandler {
  readonly type = "mesh" as const;

  private store: StateStore;
  private logger: Logger;
  private config: TopologyConfig;
  private queueTask: (task: AgentTask) => Promise<void>;
  private spawnAgent: (task: AgentTask) => Promise<void>;

  /** Message queues per agent */
  private messageQueues: Map<string, AgentMessage[]> = new Map();
  /** Pending responses keyed by request message ID */
  private pendingResponses: Map<
    string,
    { resolve: (msg: AgentMessage) => void; timeout: ReturnType<typeof setTimeout> }
  > = new Map();

  constructor(
    store: StateStore,
    logger: Logger,
    config: TopologyConfig,
    queueTask: (task: AgentTask) => Promise<void>,
    spawnAgent: (task: AgentTask) => Promise<void>,
  ) {
    this.store = store;
    this.logger = logger.child({ topology: "mesh" });
    this.config = config;
    this.queueTask = queueTask;
    this.spawnAgent = spawnAgent;
  }

  /**
   * Submit a task
   */
  async submitTask(task: AgentTask): Promise<void> {
    this.logger.info({ taskId: task.id, type: task.type }, "Submitting task");

    await this.store.setTask(task);
    await this.queueTask(task);
  }

  /**
   * Handle task completion
   */
  async onTaskComplete(result: AgentResult): Promise<void> {
    this.logger.info(
      {
        taskId: result.taskId,
        agentId: result.agentId,
        status: result.status,
      },
      "Task completed",
    );

    await this.store.setResult(result);

    const task = await this.store.getTask(result.taskId);
    if (task) {
      task.status = result.status === "success" ? "completed" : "failed";
      await this.store.setTask(task);
    }

    // Clean up message queue for this agent
    this.messageQueues.delete(result.agentId);
  }

  /**
   * Send a message from one agent to another
   */
  async sendMessage(
    message: Omit<AgentMessage, "id" | "timestamp">,
  ): Promise<void> {
    const fullMessage: AgentMessage = {
      ...message,
      id: uuidv4(),
      timestamp: new Date().toISOString(),
    };

    this.logger.debug(
      {
        messageId: fullMessage.id,
        from: message.fromAgentId,
        to: message.toAgentId,
        type: message.type,
      },
      "Sending agent message",
    );

    if (message.type === "broadcast") {
      // Send to all agents working on the same task
      await this.broadcastToTask(message.taskId, fullMessage);
    } else {
      // Direct message
      await this.deliverMessage(message.toAgentId, fullMessage);
    }
  }

  /**
   * Get pending messages for an agent
   */
  async getMessages(agentId: string): Promise<AgentMessage[]> {
    const queue = this.messageQueues.get(agentId) || [];

    // Clear the queue after reading
    this.messageQueues.set(agentId, []);

    return queue;
  }

  /**
   * Send a request and wait for response
   */
  async sendRequest(
    fromAgentId: string,
    toAgentId: string,
    taskId: string,
    payload: unknown,
  ): Promise<AgentMessage> {
    const timeoutMs = this.config.peerTimeoutMs ?? 30000;

    const message: AgentMessage = {
      id: uuidv4(),
      fromAgentId,
      toAgentId,
      taskId,
      type: "request",
      payload,
      timestamp: new Date().toISOString(),
    };

    return new Promise((resolve, reject) => {
      // Set up timeout
      const timeout = setTimeout(() => {
        this.pendingResponses.delete(message.id);
        reject(new Error(`Request to ${toAgentId} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      // Register pending response handler
      this.pendingResponses.set(message.id, { resolve, timeout });

      // Deliver the message
      this.deliverMessage(toAgentId, message);
    });
  }

  /**
   * Respond to a request
   */
  async respondToRequest(
    originalMessageId: string,
    fromAgentId: string,
    toAgentId: string,
    taskId: string,
    payload: unknown,
  ): Promise<void> {
    const pending = this.pendingResponses.get(originalMessageId);

    const response: AgentMessage = {
      id: uuidv4(),
      fromAgentId,
      toAgentId,
      taskId,
      type: "response",
      payload: { ...payload as object, inResponseTo: originalMessageId },
      timestamp: new Date().toISOString(),
    };

    if (pending) {
      // Direct callback for pending requests
      clearTimeout(pending.timeout);
      this.pendingResponses.delete(originalMessageId);
      pending.resolve(response);
    } else {
      // Queue the response
      await this.deliverMessage(toAgentId, response);
    }
  }

  /**
   * Deliver a message to an agent's queue
   */
  private async deliverMessage(
    agentId: string,
    message: AgentMessage,
  ): Promise<void> {
    const queue = this.messageQueues.get(agentId) || [];
    queue.push(message);
    this.messageQueues.set(agentId, queue);
  }

  /**
   * Broadcast a message to all agents working on a task
   */
  private async broadcastToTask(
    taskId: string,
    message: AgentMessage,
  ): Promise<void> {
    const agents = await this.store.listAgents();
    const taskAgents = agents.filter(
      (a) => a.currentTask === taskId && a.id !== message.fromAgentId,
    );

    for (const agent of taskAgents) {
      const broadcastMessage: AgentMessage = {
        ...message,
        toAgentId: agent.id,
      };
      await this.deliverMessage(agent.id, broadcastMessage);
    }

    this.logger.debug(
      {
        taskId,
        recipients: taskAgents.length,
        fromAgentId: message.fromAgentId,
      },
      "Broadcast message sent",
    );
  }

  /**
   * Get connected agents for a specific task
   */
  async getTaskPeers(taskId: string): Promise<string[]> {
    const agents = await this.store.listAgents();
    return agents
      .filter((a) => a.currentTask === taskId && a.status === "running")
      .map((a) => a.id);
  }

  /**
   * Get message statistics
   */
  getStats(): {
    activeQueues: number;
    pendingResponses: number;
    totalQueuedMessages: number;
  } {
    let totalQueuedMessages = 0;
    for (const queue of this.messageQueues.values()) {
      totalQueuedMessages += queue.length;
    }

    return {
      activeQueues: this.messageQueues.size,
      pendingResponses: this.pendingResponses.size,
      totalQueuedMessages,
    };
  }
}

/**
 * Create a mesh topology handler
 */
export function createMeshTopology(
  store: StateStore,
  logger: Logger,
  config: Partial<TopologyConfig>,
  queueTask: (task: AgentTask) => Promise<void>,
  spawnAgent: (task: AgentTask) => Promise<void>,
): MeshTopology {
  return new MeshTopology(
    store,
    logger,
    { type: "mesh", allowPeerCommunication: true, peerTimeoutMs: 30000, ...config },
    queueTask,
    spawnAgent,
  );
}
