import type { AgentTask, AgentResult, Agent, BudgetStatus } from '@claude-swarm/types';
import type { StateStore, TaskFilter } from './types.js';

/**
 * In-memory implementation of StateStore for local development
 * No external dependencies required
 */
export class MemoryStore implements StateStore {
  private tasks: Map<string, AgentTask> = new Map();
  private results: Map<string, AgentResult> = new Map();
  private agents: Map<string, Agent> = new Map();
  private dependencies: Map<string, Set<string>> = new Map();
  private dependents: Map<string, Set<string>> = new Map();
  private budget: BudgetStatus = {
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
  };

  // Task operations
  async getTask(id: string): Promise<AgentTask | null> {
    return this.tasks.get(id) || null;
  }

  async setTask(task: AgentTask): Promise<void> {
    this.tasks.set(task.id, task);
  }

  async deleteTask(id: string): Promise<void> {
    this.tasks.delete(id);
    this.dependencies.delete(id);
    // Clean up from dependents map
    for (const [, deps] of this.dependents) {
      deps.delete(id);
    }
  }

  async listTasks(filter?: TaskFilter): Promise<AgentTask[]> {
    let tasks = Array.from(this.tasks.values());

    if (filter?.status) {
      tasks = tasks.filter((t) => t.status === filter.status);
    }
    if (filter?.type) {
      tasks = tasks.filter((t) => t.type === filter.type);
    }
    if (filter?.priority) {
      tasks = tasks.filter((t) => t.priority === filter.priority);
    }
    if (filter?.offset) {
      tasks = tasks.slice(filter.offset);
    }
    if (filter?.limit) {
      tasks = tasks.slice(0, filter.limit);
    }

    return tasks;
  }

  // Result operations
  async getResult(taskId: string): Promise<AgentResult | null> {
    return this.results.get(taskId) || null;
  }

  async setResult(result: AgentResult): Promise<void> {
    this.results.set(result.taskId, result);
  }

  // Agent operations
  async getAgent(id: string): Promise<Agent | null> {
    return this.agents.get(id) || null;
  }

  async setAgent(agent: Agent): Promise<void> {
    this.agents.set(agent.id, agent);
  }

  async deleteAgent(id: string): Promise<void> {
    this.agents.delete(id);
  }

  async listAgents(): Promise<Agent[]> {
    return Array.from(this.agents.values());
  }

  async countActiveAgents(): Promise<number> {
    return Array.from(this.agents.values()).filter(
      (a) => a.status === 'running' || a.status === 'initializing'
    ).length;
  }

  // Budget operations
  async getBudget(): Promise<BudgetStatus> {
    return this.budget;
  }

  async setBudget(status: BudgetStatus): Promise<void> {
    this.budget = status;
  }

  async incrementBudget(field: 'daily' | 'weekly', amount: number): Promise<number> {
    if (field === 'daily') {
      this.budget.dailyUsedCents += amount;
      return this.budget.dailyUsedCents;
    } else {
      this.budget.weeklyUsedCents += amount;
      return this.budget.weeklyUsedCents;
    }
  }

  async resetDailyBudget(): Promise<void> {
    this.budget.dailyUsedCents = 0;
    this.budget.lastUpdated = new Date().toISOString();
  }

  async resetWeeklyBudget(): Promise<void> {
    this.budget.weeklyUsedCents = 0;
    this.budget.lastUpdated = new Date().toISOString();
  }

  // Dependency tracking
  async addDependency(taskId: string, dependsOn: string): Promise<void> {
    if (!this.dependencies.has(taskId)) {
      this.dependencies.set(taskId, new Set());
    }
    this.dependencies.get(taskId)!.add(dependsOn);

    // Track reverse mapping
    if (!this.dependents.has(dependsOn)) {
      this.dependents.set(dependsOn, new Set());
    }
    this.dependents.get(dependsOn)!.add(taskId);
  }

  async removeDependency(taskId: string, dependsOn: string): Promise<void> {
    this.dependencies.get(taskId)?.delete(dependsOn);
    this.dependents.get(dependsOn)?.delete(taskId);
  }

  async getDependencies(taskId: string): Promise<string[]> {
    return Array.from(this.dependencies.get(taskId) || []);
  }

  async getDependents(taskId: string): Promise<string[]> {
    return Array.from(this.dependents.get(taskId) || []);
  }

  async areDependenciesMet(taskId: string): Promise<boolean> {
    const deps = this.dependencies.get(taskId);
    if (!deps || deps.size === 0) return true;

    for (const depId of deps) {
      const depTask = this.tasks.get(depId);
      if (!depTask || depTask.status !== 'completed') {
        return false;
      }
    }
    return true;
  }

  // Health
  async ping(): Promise<boolean> {
    return true;
  }

  async close(): Promise<void> {
    // Nothing to close for in-memory store
  }
}
