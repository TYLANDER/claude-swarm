import { v4 as uuidv4 } from "uuid";
import type { AgentTask, AgentResult } from "@claude-swarm/types";
import type { TopologyHandler, TopologyConfig, SubTask } from "./types.js";
import type { StateStore } from "../store/types.js";
import type { Logger } from "pino";

/**
 * Hierarchical topology: Lead agents can spawn sub-agents
 *
 * This topology enables:
 * - Task decomposition by lead agents
 * - Multi-level parallelization
 * - Automatic aggregation of results
 * - Good for complex, decomposable tasks
 */
export class HierarchicalTopology implements TopologyHandler {
  readonly type = "hierarchical" as const;

  private store: StateStore;
  private logger: Logger;
  private config: TopologyConfig;
  private queueTask: (task: AgentTask) => Promise<void>;
  private spawnAgent: (task: AgentTask) => Promise<void>;

  /** Track parent-child relationships */
  private taskTree: Map<string, Set<string>> = new Map();
  /** Track task depth */
  private taskDepth: Map<string, number> = new Map();

  constructor(
    store: StateStore,
    logger: Logger,
    config: TopologyConfig,
    queueTask: (task: AgentTask) => Promise<void>,
    spawnAgent: (task: AgentTask) => Promise<void>,
  ) {
    this.store = store;
    this.logger = logger.child({ topology: "hierarchical" });
    this.config = config;
    this.queueTask = queueTask;
    this.spawnAgent = spawnAgent;
  }

  /**
   * Submit a top-level task
   */
  async submitTask(task: AgentTask): Promise<void> {
    this.logger.info({ taskId: task.id, type: task.type }, "Submitting root task");

    // Mark as root (depth 0)
    this.taskDepth.set(task.id, 0);
    this.taskTree.set(task.id, new Set());

    await this.store.setTask(task);
    await this.queueTask(task);
  }

  /**
   * Create a sub-task spawned by a lead agent
   */
  async createSubTask(subTask: SubTask): Promise<string> {
    const parentDepth = this.taskDepth.get(subTask.parentTaskId) ?? 0;
    const newDepth = parentDepth + 1;

    // Check depth limit
    const maxDepth = this.config.maxDepth ?? 3;
    if (newDepth > maxDepth) {
      throw new Error(
        `Maximum task depth (${maxDepth}) exceeded. Cannot create sub-task.`,
      );
    }

    // Check sub-task limit per agent
    const parentChildren = this.taskTree.get(subTask.parentTaskId) ?? new Set();
    const maxSubTasks = this.config.maxSubTasksPerAgent ?? 5;
    if (parentChildren.size >= maxSubTasks) {
      throw new Error(
        `Maximum sub-tasks per agent (${maxSubTasks}) exceeded.`,
      );
    }

    // Create the sub-task
    const task: AgentTask = {
      ...subTask.task,
      id: uuidv4(),
      parentTaskId: subTask.parentTaskId,
      createdAt: new Date().toISOString(),
      status: "pending",
    };

    // Track hierarchy
    this.taskDepth.set(task.id, newDepth);
    this.taskTree.set(task.id, new Set());
    parentChildren.add(task.id);
    this.taskTree.set(subTask.parentTaskId, parentChildren);

    this.logger.info(
      {
        taskId: task.id,
        parentTaskId: subTask.parentTaskId,
        depth: newDepth,
        creatorAgentId: subTask.creatorAgentId,
      },
      "Created sub-task",
    );

    await this.store.setTask(task);
    await this.queueTask(task);

    return task.id;
  }

  /**
   * Handle task completion - check if parent can proceed
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
    if (!task) return;

    task.status = result.status === "success" ? "completed" : "failed";
    await this.store.setTask(task);

    // Check if this completes a parent task
    if (task.parentTaskId) {
      await this.checkParentCompletion(task.parentTaskId);
    }
  }

  /**
   * Check if all children of a parent task are complete
   */
  private async checkParentCompletion(parentTaskId: string): Promise<void> {
    const children = this.taskTree.get(parentTaskId);
    if (!children || children.size === 0) return;

    let allComplete = true;
    let anyFailed = false;

    for (const childId of children) {
      const child = await this.store.getTask(childId);
      if (!child) continue;

      if (child.status !== "completed" && child.status !== "failed") {
        allComplete = false;
        break;
      }

      if (child.status === "failed") {
        anyFailed = true;
      }
    }

    if (allComplete) {
      this.logger.info(
        { parentTaskId, childCount: children.size, anyFailed },
        "All sub-tasks complete",
      );

      // Could trigger aggregation logic here
      // For now, just log the completion
    }
  }

  /**
   * Get all sub-tasks for a parent
   */
  async getSubTasks(parentTaskId: string): Promise<AgentTask[]> {
    const childIds = this.taskTree.get(parentTaskId);
    if (!childIds) return [];

    const tasks: AgentTask[] = [];
    for (const childId of childIds) {
      const task = await this.store.getTask(childId);
      if (task) tasks.push(task);
    }

    return tasks;
  }

  /**
   * Get the full task tree for a root task
   */
  async getTaskTree(rootTaskId: string): Promise<{
    task: AgentTask;
    children: unknown[];
  } | null> {
    const task = await this.store.getTask(rootTaskId);
    if (!task) return null;

    const children = await this.getSubTasks(rootTaskId);
    const childTrees = await Promise.all(
      children.map((child) => this.getTaskTree(child.id)),
    );

    return {
      task,
      children: childTrees.filter(Boolean),
    };
  }
}

/**
 * Create a hierarchical topology handler
 */
export function createHierarchicalTopology(
  store: StateStore,
  logger: Logger,
  config: Partial<TopologyConfig>,
  queueTask: (task: AgentTask) => Promise<void>,
  spawnAgent: (task: AgentTask) => Promise<void>,
): HierarchicalTopology {
  return new HierarchicalTopology(
    store,
    logger,
    { type: "hierarchical", maxDepth: 3, maxSubTasksPerAgent: 5, ...config },
    queueTask,
    spawnAgent,
  );
}
