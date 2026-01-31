import type { AgentTask } from "@claude-swarm/types";
import type { StateStore } from "../store/types.js";
import { DependencyGraph } from "./dependencyGraph.js";

export { DependencyGraph };

/**
 * Task scheduler that handles dependency-aware task queueing
 */
export class TaskScheduler {
  private store: StateStore;
  private dependencyGraph: DependencyGraph;

  constructor(store: StateStore) {
    this.store = store;
    this.dependencyGraph = new DependencyGraph(store);
  }

  /**
   * Register a task and its dependencies
   */
  async registerTask(task: AgentTask): Promise<void> {
    await this.store.setTask(task);

    // Register dependencies
    for (const depId of task.context.dependencies) {
      await this.dependencyGraph.addDependency(task.id, depId);
    }
  }

  /**
   * Check if a task is ready to be queued
   */
  async isTaskReady(taskId: string): Promise<boolean> {
    const task = await this.store.getTask(taskId);
    if (!task || task.status !== "pending") {
      return false;
    }

    return this.dependencyGraph.canExecute(taskId);
  }

  /**
   * Get all tasks that are ready to be processed
   */
  async getQueueableTasks(): Promise<AgentTask[]> {
    const readyTaskIds = await this.dependencyGraph.getReadyTasks();
    const tasks: AgentTask[] = [];

    for (const taskId of readyTaskIds) {
      const task = await this.store.getTask(taskId);
      if (task && task.status === "pending") {
        tasks.push(task);
      }
    }

    // Sort by priority: high > normal > low
    const priorityOrder = { high: 0, normal: 1, low: 2 };
    return tasks.sort(
      (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority],
    );
  }

  /**
   * Mark a task as completed and check for newly unblocked tasks
   */
  async completeTask(taskId: string): Promise<string[]> {
    const task = await this.store.getTask(taskId);
    if (task) {
      task.status = "completed";
      await this.store.setTask(task);
    }

    // Find tasks that were waiting on this one
    const blockedTasks = await this.dependencyGraph.getBlockedTasks(taskId);
    const newlyReady: string[] = [];

    for (const blockedId of blockedTasks) {
      if (await this.isTaskReady(blockedId)) {
        newlyReady.push(blockedId);
      }
    }

    return newlyReady;
  }

  /**
   * Get dependency information for a task
   */
  async getTaskDependencies(taskId: string): Promise<{
    directDependencies: string[];
    transitiveDependencies: string[];
    blockedBy: string[];
    blocking: string[];
  }> {
    const directDependencies = await this.store.getDependencies(taskId);
    const transitiveDependencies =
      await this.dependencyGraph.getDependencyChain(taskId);
    const blocking = await this.dependencyGraph.getBlockedTasks(taskId);

    // Find incomplete dependencies that are blocking this task
    const blockedBy: string[] = [];
    for (const depId of directDependencies) {
      const dep = await this.store.getTask(depId);
      if (dep && dep.status !== "completed") {
        blockedBy.push(depId);
      }
    }

    return {
      directDependencies,
      transitiveDependencies,
      blockedBy,
      blocking,
    };
  }

  /**
   * Validate that adding dependencies won't create cycles
   */
  async validateDependencies(taskId: string, dependencies: string[]): Promise<{
    valid: boolean;
    errors: string[];
  }> {
    const errors: string[] = [];

    for (const depId of dependencies) {
      // Check if dependency exists
      const dep = await this.store.getTask(depId);
      if (!dep) {
        errors.push(`Dependency ${depId} does not exist`);
        continue;
      }

      // Check for circular dependency
      if (await this.dependencyGraph.wouldCreateCycle(taskId, depId)) {
        errors.push(`Dependency on ${depId} would create a circular dependency`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Get execution plan - tasks in order they should execute
   */
  async getExecutionPlan(): Promise<AgentTask[]> {
    const order = await this.dependencyGraph.getTopologicalOrder();
    const tasks: AgentTask[] = [];

    for (const taskId of order) {
      const task = await this.store.getTask(taskId);
      if (task && task.status === "pending") {
        tasks.push(task);
      }
    }

    return tasks;
  }

  get graph(): DependencyGraph {
    return this.dependencyGraph;
  }
}
