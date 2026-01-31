import type { AgentTask, AgentResult, TaskType } from "@claude-swarm/types";
import type { StateStore } from "../store/types.js";

/**
 * Performance metrics for an agent on a specific task type
 */
export interface AgentPerformance {
  agentId: string;
  taskType: TaskType;
  /** Exponential moving average of success rate (0-1) */
  successRate: number;
  /** EMA of task duration in milliseconds */
  avgDurationMs: number;
  /** EMA of cost in cents */
  avgCostCents: number;
  /** Total tasks completed for this type */
  completedCount: number;
  /** Last updated timestamp */
  lastUpdated: string;
}

/**
 * Agent scoring system using exponential moving average
 */
export class AgentScoring {
  private store: StateStore;
  /** EMA smoothing factor (0-1). Higher = more weight to recent data */
  private alpha: number;
  /** In-memory cache of performance metrics */
  private metrics: Map<string, AgentPerformance>;

  constructor(store: StateStore, alpha: number = 0.3) {
    this.store = store;
    this.alpha = alpha;
    this.metrics = new Map();
  }

  /**
   * Get the cache key for an agent/task type combo
   */
  private getKey(agentId: string, taskType: TaskType): string {
    return `${agentId}:${taskType}`;
  }

  /**
   * Initialize or get existing performance record
   */
  async getPerformance(
    agentId: string,
    taskType: TaskType,
  ): Promise<AgentPerformance> {
    const key = this.getKey(agentId, taskType);
    const cached = this.metrics.get(key);

    if (cached) {
      return cached;
    }

    // Default metrics for new agents
    const defaultMetrics: AgentPerformance = {
      agentId,
      taskType,
      successRate: 0.5, // Start neutral
      avgDurationMs: 300000, // 5 min default
      avgCostCents: 100, // $1 default
      completedCount: 0,
      lastUpdated: new Date().toISOString(),
    };

    this.metrics.set(key, defaultMetrics);
    return defaultMetrics;
  }

  /**
   * Update agent performance based on task result
   */
  async recordResult(result: AgentResult, task: AgentTask): Promise<void> {
    const key = this.getKey(result.agentId, task.type);
    const current = await this.getPerformance(result.agentId, task.type);

    const success = result.status === "success" ? 1 : 0;

    // Apply exponential moving average
    const newMetrics: AgentPerformance = {
      ...current,
      successRate: this.ema(current.successRate, success),
      avgDurationMs: this.ema(current.avgDurationMs, result.durationMs),
      avgCostCents: this.ema(current.avgCostCents, result.costCents),
      completedCount: current.completedCount + 1,
      lastUpdated: new Date().toISOString(),
    };

    this.metrics.set(key, newMetrics);
  }

  /**
   * Calculate exponential moving average
   */
  private ema(previous: number, current: number): number {
    return this.alpha * current + (1 - this.alpha) * previous;
  }

  /**
   * Calculate a composite score for agent suitability (higher is better)
   */
  calculateScore(metrics: AgentPerformance, task: AgentTask): number {
    // Weights for different factors
    const weights = {
      successRate: 0.5, // Most important
      speed: 0.25,
      cost: 0.25,
    };

    // Normalize speed (inverse, capped at 10ms-1h)
    const minDuration = 10000; // 10s
    const maxDuration = 3600000; // 1h
    const normalizedSpeed =
      1 -
      Math.min(
        1,
        Math.max(0, (metrics.avgDurationMs - minDuration) / (maxDuration - minDuration)),
      );

    // Normalize cost (inverse, capped at 1-1000 cents)
    const minCost = 1;
    const maxCost = 1000;
    const normalizedCost =
      1 -
      Math.min(
        1,
        Math.max(0, (metrics.avgCostCents - minCost) / (maxCost - minCost)),
      );

    // Calculate weighted score
    const score =
      weights.successRate * metrics.successRate +
      weights.speed * normalizedSpeed +
      weights.cost * normalizedCost;

    // Boost for experience (up to 20% boost with 100+ tasks)
    const experienceBoost = Math.min(0.2, metrics.completedCount / 500);

    return score * (1 + experienceBoost);
  }

  /**
   * Get all performance metrics
   */
  getAllMetrics(): AgentPerformance[] {
    return Array.from(this.metrics.values());
  }

  /**
   * Get metrics for a specific task type
   */
  getMetricsByTaskType(taskType: TaskType): AgentPerformance[] {
    return Array.from(this.metrics.values()).filter(
      (m) => m.taskType === taskType,
    );
  }

  /**
   * Get top performing agents for a task type
   */
  async getTopAgents(taskType: TaskType, limit: number = 5): Promise<string[]> {
    const agents = this.getMetricsByTaskType(taskType);

    // Sort by success rate descending, then by experience
    return agents
      .sort((a, b) => {
        const scoreA = this.calculateScore(a, { type: taskType } as AgentTask);
        const scoreB = this.calculateScore(b, { type: taskType } as AgentTask);
        return scoreB - scoreA;
      })
      .slice(0, limit)
      .map((a) => a.agentId);
  }

  /**
   * Decay scores for inactive agents (call periodically)
   */
  decayInactiveScores(inactiveThresholdMs: number = 24 * 60 * 60 * 1000): void {
    const now = Date.now();
    const decayFactor = 0.95; // Decay by 5%

    for (const [key, metrics] of this.metrics) {
      const lastUpdated = new Date(metrics.lastUpdated).getTime();
      if (now - lastUpdated > inactiveThresholdMs) {
        // Decay towards neutral
        metrics.successRate = decayFactor * metrics.successRate + (1 - decayFactor) * 0.5;
        metrics.lastUpdated = new Date().toISOString();
      }
    }
  }
}
