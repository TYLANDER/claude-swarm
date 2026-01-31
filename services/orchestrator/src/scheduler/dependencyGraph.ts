import type { StateStore } from "../store/types.js";

/**
 * Dependency graph for task scheduling
 * Provides topological ordering and circular dependency detection
 */
export class DependencyGraph {
  private store: StateStore;

  constructor(store: StateStore) {
    this.store = store;
  }

  /**
   * Add a dependency relationship
   * @param taskId The task that depends on another
   * @param dependsOn The task that must complete first
   */
  async addDependency(taskId: string, dependsOn: string): Promise<void> {
    // Check for circular dependency before adding
    if (await this.wouldCreateCycle(taskId, dependsOn)) {
      throw new Error(
        `Adding dependency ${taskId} -> ${dependsOn} would create a circular dependency`,
      );
    }

    await this.store.addDependency(taskId, dependsOn);
  }

  /**
   * Remove a dependency relationship
   */
  async removeDependency(taskId: string, dependsOn: string): Promise<void> {
    await this.store.removeDependency(taskId, dependsOn);
  }

  /**
   * Check if adding a dependency would create a cycle
   */
  async wouldCreateCycle(taskId: string, dependsOn: string): Promise<boolean> {
    // If taskId and dependsOn are the same, it's a self-cycle
    if (taskId === dependsOn) return true;

    // Check if dependsOn (directly or transitively) depends on taskId
    const visited = new Set<string>();
    const stack = [dependsOn];

    while (stack.length > 0) {
      const current = stack.pop()!;

      if (current === taskId) return true;
      if (visited.has(current)) continue;

      visited.add(current);

      const deps = await this.store.getDependencies(current);
      stack.push(...deps);
    }

    return false;
  }

  /**
   * Detect any cycles in the dependency graph
   * Returns the first cycle found, or null if no cycles
   */
  async detectCycles(): Promise<string[] | null> {
    const tasks = await this.store.listTasks();
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const path: string[] = [];

    const dfs = async (taskId: string): Promise<boolean> => {
      visited.add(taskId);
      recursionStack.add(taskId);
      path.push(taskId);

      const deps = await this.store.getDependencies(taskId);

      for (const dep of deps) {
        if (!visited.has(dep)) {
          if (await dfs(dep)) return true;
        } else if (recursionStack.has(dep)) {
          // Found cycle - extract it from path
          const cycleStart = path.indexOf(dep);
          path.push(dep); // Close the cycle
          return true;
        }
      }

      path.pop();
      recursionStack.delete(taskId);
      return false;
    };

    for (const task of tasks) {
      if (!visited.has(task.id)) {
        if (await dfs(task.id)) {
          // Extract just the cycle portion
          const cycleStart = path.findIndex(
            (id, i) => i < path.length - 1 && id === path[path.length - 1],
          );
          return path.slice(cycleStart);
        }
      }
    }

    return null;
  }

  /**
   * Get tasks in topological order (tasks with no dependencies first)
   */
  async getTopologicalOrder(): Promise<string[]> {
    const tasks = await this.store.listTasks();
    const inDegree = new Map<string, number>();
    const adjacencyList = new Map<string, string[]>();

    // Initialize
    for (const task of tasks) {
      inDegree.set(task.id, 0);
      adjacencyList.set(task.id, []);
    }

    // Build graph
    for (const task of tasks) {
      const deps = await this.store.getDependencies(task.id);
      inDegree.set(task.id, deps.length);

      for (const dep of deps) {
        const dependents = adjacencyList.get(dep) || [];
        dependents.push(task.id);
        adjacencyList.set(dep, dependents);
      }
    }

    // Kahn's algorithm
    const queue: string[] = [];
    const result: string[] = [];

    // Start with tasks that have no dependencies
    for (const [taskId, degree] of inDegree) {
      if (degree === 0) {
        queue.push(taskId);
      }
    }

    while (queue.length > 0) {
      const current = queue.shift()!;
      result.push(current);

      const dependents = adjacencyList.get(current) || [];
      for (const dependent of dependents) {
        const newDegree = (inDegree.get(dependent) || 1) - 1;
        inDegree.set(dependent, newDegree);

        if (newDegree === 0) {
          queue.push(dependent);
        }
      }
    }

    // If result doesn't contain all tasks, there's a cycle
    if (result.length !== tasks.length) {
      throw new Error("Circular dependency detected in task graph");
    }

    return result;
  }

  /**
   * Get tasks that are ready to run (all dependencies completed)
   */
  async getReadyTasks(): Promise<string[]> {
    const tasks = await this.store.listTasks({ status: "pending" });
    const ready: string[] = [];

    for (const task of tasks) {
      if (await this.store.areDependenciesMet(task.id)) {
        ready.push(task.id);
      }
    }

    return ready;
  }

  /**
   * Check if a specific task can be executed
   */
  async canExecute(taskId: string): Promise<boolean> {
    return this.store.areDependenciesMet(taskId);
  }

  /**
   * Get tasks blocked by a specific task
   */
  async getBlockedTasks(taskId: string): Promise<string[]> {
    return this.store.getDependents(taskId);
  }

  /**
   * Get full dependency chain for a task (transitive dependencies)
   */
  async getDependencyChain(taskId: string): Promise<string[]> {
    const result: string[] = [];
    const visited = new Set<string>();
    const stack = [taskId];

    while (stack.length > 0) {
      const current = stack.pop()!;

      if (visited.has(current)) continue;
      visited.add(current);

      if (current !== taskId) {
        result.push(current);
      }

      const deps = await this.store.getDependencies(current);
      stack.push(...deps);
    }

    return result;
  }
}
