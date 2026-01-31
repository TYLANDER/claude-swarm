import type { AgentTask, AgentResult, Agent, BudgetStatus } from "@claude-swarm/types";

/**
 * Abstract interface for state storage
 * Allows swapping between in-memory (dev) and Redis (prod)
 */
export interface StateStore {
  // Task operations
  getTask(id: string): Promise<AgentTask | null>;
  setTask(task: AgentTask): Promise<void>;
  deleteTask(id: string): Promise<void>;
  listTasks(filter?: TaskFilter): Promise<AgentTask[]>;

  // Result operations
  getResult(taskId: string): Promise<AgentResult | null>;
  setResult(result: AgentResult): Promise<void>;

  // Agent operations
  getAgent(id: string): Promise<Agent | null>;
  setAgent(agent: Agent): Promise<void>;
  deleteAgent(id: string): Promise<void>;
  listAgents(): Promise<Agent[]>;
  countActiveAgents(): Promise<number>;

  // Budget operations
  getBudget(): Promise<BudgetStatus>;
  setBudget(status: BudgetStatus): Promise<void>;
  incrementBudget(field: "daily" | "weekly", amount: number): Promise<number>;
  resetDailyBudget(): Promise<void>;
  resetWeeklyBudget(): Promise<void>;

  // Dependency tracking
  addDependency(taskId: string, dependsOn: string): Promise<void>;
  removeDependency(taskId: string, dependsOn: string): Promise<void>;
  getDependencies(taskId: string): Promise<string[]>;
  getDependents(taskId: string): Promise<string[]>;
  areDependenciesMet(taskId: string): Promise<boolean>;

  // Health
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

export interface TaskFilter {
  status?: AgentTask["status"];
  type?: AgentTask["type"];
  priority?: AgentTask["priority"];
  limit?: number;
  offset?: number;
}

/**
 * TTL values for different data types (in seconds)
 */
export const TTL = {
  TASK: 7 * 24 * 60 * 60, // 7 days
  RESULT: 7 * 24 * 60 * 60, // 7 days
  AGENT: 24 * 60 * 60, // 1 day
  BUDGET: 0, // No expiry (persistent)
  DEPENDENCY: 7 * 24 * 60 * 60, // 7 days
} as const;
