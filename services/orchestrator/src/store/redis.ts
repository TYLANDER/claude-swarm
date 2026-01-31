import Redis from "ioredis";
import type { AgentTask, AgentResult, Agent, BudgetStatus } from "@claude-swarm/types";
import { DEFAULT_BUDGET } from "@claude-swarm/shared";
import type { StateStore, TaskFilter } from "./types.js";
import { TTL } from "./types.js";

// Redis key prefixes
const KEYS = {
  TASK: "task:",
  RESULT: "result:",
  AGENT: "agent:",
  BUDGET: "budget",
  BUDGET_DAILY: "budget:daily",
  BUDGET_WEEKLY: "budget:weekly",
  DEP_FORWARD: "dep:forward:", // task -> dependencies
  DEP_REVERSE: "dep:reverse:", // task -> dependents
  TASK_INDEX: "tasks:index",
  AGENT_INDEX: "agents:index",
} as const;

/**
 * Redis-backed implementation of StateStore
 */
export class RedisStore implements StateStore {
  private client: Redis;

  constructor(redisUrl: string) {
    this.client = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => {
        if (times > 3) return null;
        return Math.min(times * 200, 2000);
      },
    });

    this.client.on("error", (err) => {
      console.error("Redis connection error:", err);
    });
  }

  // ===== Task Operations =====

  async getTask(id: string): Promise<AgentTask | null> {
    const data = await this.client.get(KEYS.TASK + id);
    return data ? JSON.parse(data) : null;
  }

  async setTask(task: AgentTask): Promise<void> {
    const key = KEYS.TASK + task.id;
    await this.client.setex(key, TTL.TASK, JSON.stringify(task));
    // Add to index for listing
    await this.client.zadd(KEYS.TASK_INDEX, Date.now(), task.id);
  }

  async deleteTask(id: string): Promise<void> {
    await this.client.del(KEYS.TASK + id);
    await this.client.zrem(KEYS.TASK_INDEX, id);
  }

  async listTasks(filter?: TaskFilter): Promise<AgentTask[]> {
    const limit = filter?.limit || 100;
    const offset = filter?.offset || 0;

    // Get task IDs from index (newest first)
    const taskIds = await this.client.zrevrange(
      KEYS.TASK_INDEX,
      offset,
      offset + limit - 1,
    );

    if (taskIds.length === 0) return [];

    // Fetch all tasks
    const pipeline = this.client.pipeline();
    taskIds.forEach((id) => pipeline.get(KEYS.TASK + id));
    const results = await pipeline.exec();

    const tasks: AgentTask[] = [];
    for (const [err, data] of results || []) {
      if (!err && data) {
        const task = JSON.parse(data as string) as AgentTask;
        // Apply filters
        if (filter?.status && task.status !== filter.status) continue;
        if (filter?.type && task.type !== filter.type) continue;
        if (filter?.priority && task.priority !== filter.priority) continue;
        tasks.push(task);
      }
    }

    return tasks;
  }

  // ===== Result Operations =====

  async getResult(taskId: string): Promise<AgentResult | null> {
    const data = await this.client.get(KEYS.RESULT + taskId);
    return data ? JSON.parse(data) : null;
  }

  async setResult(result: AgentResult): Promise<void> {
    await this.client.setex(
      KEYS.RESULT + result.taskId,
      TTL.RESULT,
      JSON.stringify(result),
    );
  }

  // ===== Agent Operations =====

  async getAgent(id: string): Promise<Agent | null> {
    const data = await this.client.get(KEYS.AGENT + id);
    return data ? JSON.parse(data) : null;
  }

  async setAgent(agent: Agent): Promise<void> {
    const key = KEYS.AGENT + agent.id;
    await this.client.setex(key, TTL.AGENT, JSON.stringify(agent));
    await this.client.zadd(KEYS.AGENT_INDEX, Date.now(), agent.id);
  }

  async deleteAgent(id: string): Promise<void> {
    await this.client.del(KEYS.AGENT + id);
    await this.client.zrem(KEYS.AGENT_INDEX, id);
  }

  async listAgents(): Promise<Agent[]> {
    const agentIds = await this.client.zrange(KEYS.AGENT_INDEX, 0, -1);
    if (agentIds.length === 0) return [];

    const pipeline = this.client.pipeline();
    agentIds.forEach((id) => pipeline.get(KEYS.AGENT + id));
    const results = await pipeline.exec();

    const agents: Agent[] = [];
    for (const [err, data] of results || []) {
      if (!err && data) {
        agents.push(JSON.parse(data as string));
      }
    }

    return agents;
  }

  async countActiveAgents(): Promise<number> {
    const agents = await this.listAgents();
    return agents.filter((a) => a.status === "running").length;
  }

  // ===== Budget Operations =====

  async getBudget(): Promise<BudgetStatus> {
    const [configData, daily, weekly, isPaused] = await Promise.all([
      this.client.get(KEYS.BUDGET),
      this.client.get(KEYS.BUDGET_DAILY),
      this.client.get(KEYS.BUDGET_WEEKLY),
      this.client.get(KEYS.BUDGET + ":paused"),
    ]);

    const config = configData ? JSON.parse(configData) : DEFAULT_BUDGET;

    return {
      config,
      dailyUsedCents: parseInt(daily || "0", 10),
      weeklyUsedCents: parseInt(weekly || "0", 10),
      isPaused: isPaused === "true",
      lastUpdated: new Date().toISOString(),
    };
  }

  async setBudget(status: BudgetStatus): Promise<void> {
    await Promise.all([
      this.client.set(KEYS.BUDGET, JSON.stringify(status.config)),
      this.client.set(KEYS.BUDGET_DAILY, status.dailyUsedCents.toString()),
      this.client.set(KEYS.BUDGET_WEEKLY, status.weeklyUsedCents.toString()),
      this.client.set(KEYS.BUDGET + ":paused", status.isPaused.toString()),
    ]);
  }

  async incrementBudget(field: "daily" | "weekly", amount: number): Promise<number> {
    const key = field === "daily" ? KEYS.BUDGET_DAILY : KEYS.BUDGET_WEEKLY;
    return this.client.incrby(key, amount);
  }

  async resetDailyBudget(): Promise<void> {
    await this.client.set(KEYS.BUDGET_DAILY, "0");
  }

  async resetWeeklyBudget(): Promise<void> {
    await this.client.set(KEYS.BUDGET_WEEKLY, "0");
  }

  // ===== Dependency Operations =====

  async addDependency(taskId: string, dependsOn: string): Promise<void> {
    await Promise.all([
      this.client.sadd(KEYS.DEP_FORWARD + taskId, dependsOn),
      this.client.sadd(KEYS.DEP_REVERSE + dependsOn, taskId),
    ]);
    // Set TTL on both keys
    await Promise.all([
      this.client.expire(KEYS.DEP_FORWARD + taskId, TTL.DEPENDENCY),
      this.client.expire(KEYS.DEP_REVERSE + dependsOn, TTL.DEPENDENCY),
    ]);
  }

  async removeDependency(taskId: string, dependsOn: string): Promise<void> {
    await Promise.all([
      this.client.srem(KEYS.DEP_FORWARD + taskId, dependsOn),
      this.client.srem(KEYS.DEP_REVERSE + dependsOn, taskId),
    ]);
  }

  async getDependencies(taskId: string): Promise<string[]> {
    return this.client.smembers(KEYS.DEP_FORWARD + taskId);
  }

  async getDependents(taskId: string): Promise<string[]> {
    return this.client.smembers(KEYS.DEP_REVERSE + taskId);
  }

  async areDependenciesMet(taskId: string): Promise<boolean> {
    const dependencies = await this.getDependencies(taskId);
    if (dependencies.length === 0) return true;

    // Check each dependency's status
    const pipeline = this.client.pipeline();
    dependencies.forEach((depId) => pipeline.get(KEYS.TASK + depId));
    const results = await pipeline.exec();

    for (const [err, data] of results || []) {
      if (err || !data) return false;
      const task = JSON.parse(data as string) as AgentTask;
      if (task.status !== "completed") return false;
    }

    return true;
  }

  // ===== Health =====

  async ping(): Promise<boolean> {
    try {
      const result = await this.client.ping();
      return result === "PONG";
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.client.quit();
  }
}

/**
 * Create a Redis store instance
 */
export function createRedisStore(redisUrl: string): StateStore {
  return new RedisStore(redisUrl);
}
