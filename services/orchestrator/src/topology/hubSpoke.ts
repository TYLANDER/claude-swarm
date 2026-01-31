import type { AgentTask, AgentResult } from "@claude-swarm/types";
import type { TopologyHandler, TopologyConfig } from "./types.js";
import type { StateStore } from "../store/types.js";
import type { Logger } from "pino";

/**
 * Hub-spoke topology: Central orchestrator manages all agents directly
 *
 * This is the simplest topology where:
 * - All tasks flow through the central orchestrator
 * - Agents communicate only with the orchestrator
 * - No direct agent-to-agent communication
 * - Good for independent, parallelizable tasks
 */
export class HubSpokeTopology implements TopologyHandler {
  readonly type = "hub-spoke" as const;

  private store: StateStore;
  private logger: Logger;
  private config: TopologyConfig;
  private queueTask: (task: AgentTask) => Promise<void>;
  private spawnAgent: (task: AgentTask) => Promise<void>;

  constructor(
    store: StateStore,
    logger: Logger,
    config: TopologyConfig,
    queueTask: (task: AgentTask) => Promise<void>,
    spawnAgent: (task: AgentTask) => Promise<void>,
  ) {
    this.store = store;
    this.logger = logger.child({ topology: "hub-spoke" });
    this.config = config;
    this.queueTask = queueTask;
    this.spawnAgent = spawnAgent;
  }

  /**
   * Submit a task to the queue
   */
  async submitTask(task: AgentTask): Promise<void> {
    this.logger.info({ taskId: task.id, type: task.type }, "Submitting task");

    // Store the task
    await this.store.setTask(task);

    // Queue for processing
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
        costCents: result.costCents,
      },
      "Task completed",
    );

    // Store the result
    await this.store.setResult(result);

    // Update task status
    const task = await this.store.getTask(result.taskId);
    if (task) {
      task.status = result.status === "success" ? "completed" : "failed";
      await this.store.setTask(task);
    }

    // Update agent status
    const agent = await this.store.getAgent(result.agentId);
    if (agent) {
      agent.status = "completed";
      agent.completedAt = new Date().toISOString();
      agent.tokensUsed = result.tokensUsed;
      agent.costCents = result.costCents;
      await this.store.setAgent(agent);
    }
  }
}

/**
 * Create a hub-spoke topology handler
 */
export function createHubSpokeTopology(
  store: StateStore,
  logger: Logger,
  queueTask: (task: AgentTask) => Promise<void>,
  spawnAgent: (task: AgentTask) => Promise<void>,
): HubSpokeTopology {
  return new HubSpokeTopology(
    store,
    logger,
    { type: "hub-spoke" },
    queueTask,
    spawnAgent,
  );
}
