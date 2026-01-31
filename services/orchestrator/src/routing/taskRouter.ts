import type { AgentTask, Agent, TaskType, ModelType } from "@claude-swarm/types";
import type { StateStore } from "../store/types.js";
import { AgentScoring, AgentPerformance } from "./agentScoring.js";

/**
 * Routing decision for a task
 */
export interface RoutingDecision {
  /** Recommended agent ID (null if should spawn new) */
  agentId: string | null;
  /** Recommended model based on task complexity */
  model: ModelType;
  /** Confidence in the routing decision (0-1) */
  confidence: number;
  /** Reason for the decision */
  reason: string;
}

/**
 * Task router that selects optimal agents based on historical performance
 */
export class TaskRouter {
  private store: StateStore;
  private scoring: AgentScoring;

  constructor(store: StateStore, scoring: AgentScoring) {
    this.store = store;
    this.scoring = scoring;
  }

  /**
   * Route a task to the best available agent
   */
  async routeTask(task: AgentTask): Promise<RoutingDecision> {
    // Get available agents
    const agents = await this.store.listAgents();
    const idleAgents = agents.filter((a) => a.status === "idle");

    // If no idle agents, recommend spawning a new one
    if (idleAgents.length === 0) {
      return {
        agentId: null,
        model: this.selectModel(task),
        confidence: 0.5,
        reason: "No idle agents available, spawn new",
      };
    }

    // Score each idle agent for this task
    const scoredAgents: {
      agent: Agent;
      score: number;
      metrics: AgentPerformance;
    }[] = [];

    for (const agent of idleAgents) {
      const metrics = await this.scoring.getPerformance(agent.id, task.type);
      const score = this.scoring.calculateScore(metrics, task);
      scoredAgents.push({ agent, score, metrics });
    }

    // Sort by score descending
    scoredAgents.sort((a, b) => b.score - a.score);

    // Select the best agent
    const best = scoredAgents[0];

    // Calculate confidence based on experience and score
    const confidence = this.calculateConfidence(best.metrics, best.score);

    return {
      agentId: best.agent.id,
      model: this.selectModel(task, best.metrics),
      confidence,
      reason: this.formatReason(best),
    };
  }

  /**
   * Select model based on task characteristics
   */
  private selectModel(task: AgentTask, metrics?: AgentPerformance): ModelType {
    // Use task-specified model if set
    if (task.model) return task.model;

    // Complex task types default to opus
    const complexTypes: TaskType[] = ["security", "review"];
    if (complexTypes.includes(task.type)) {
      return "opus";
    }

    // High-budget tasks can use opus
    if (task.budgetCents >= 500) {
      return "opus";
    }

    // If historical performance shows low success with sonnet, try opus
    if (metrics && metrics.successRate < 0.6 && metrics.completedCount >= 5) {
      return "opus";
    }

    // Default to sonnet (more cost-effective)
    return "sonnet";
  }

  /**
   * Calculate confidence in routing decision
   */
  private calculateConfidence(metrics: AgentPerformance, score: number): number {
    // Base confidence from score
    let confidence = Math.min(1, score);

    // Adjust based on experience
    if (metrics.completedCount < 5) {
      confidence *= 0.6; // Low confidence with little data
    } else if (metrics.completedCount < 20) {
      confidence *= 0.8;
    }

    // Penalize inconsistent performers
    if (metrics.successRate > 0.3 && metrics.successRate < 0.7) {
      confidence *= 0.8; // Inconsistent
    }

    return Math.round(confidence * 100) / 100;
  }

  /**
   * Format reason string for routing decision
   */
  private formatReason(best: {
    agent: Agent;
    score: number;
    metrics: AgentPerformance;
  }): string {
    const { agent, score, metrics } = best;

    const successPct = Math.round(metrics.successRate * 100);
    const tasks = metrics.completedCount;

    return `Agent ${agent.id.slice(0, 8)} selected (score: ${score.toFixed(2)}, ` +
      `${successPct}% success over ${tasks} tasks)`;
  }

  /**
   * Get routing statistics
   */
  async getRoutingStats(): Promise<{
    totalAgents: number;
    taskTypeStats: Record<TaskType, { avgSuccessRate: number; avgCost: number }>;
  }> {
    const metrics = this.scoring.getAllMetrics();
    const taskTypes: TaskType[] = ["code", "test", "review", "doc", "security"];

    const taskTypeStats: Record<TaskType, { avgSuccessRate: number; avgCost: number }> =
      {} as Record<TaskType, { avgSuccessRate: number; avgCost: number }>;

    for (const type of taskTypes) {
      const typeMetrics = metrics.filter((m) => m.taskType === type);

      if (typeMetrics.length > 0) {
        const avgSuccessRate =
          typeMetrics.reduce((sum, m) => sum + m.successRate, 0) / typeMetrics.length;
        const avgCost =
          typeMetrics.reduce((sum, m) => sum + m.avgCostCents, 0) / typeMetrics.length;

        taskTypeStats[type] = {
          avgSuccessRate: Math.round(avgSuccessRate * 100) / 100,
          avgCost: Math.round(avgCost),
        };
      } else {
        taskTypeStats[type] = { avgSuccessRate: 0, avgCost: 0 };
      }
    }

    const uniqueAgents = new Set(metrics.map((m) => m.agentId));

    return {
      totalAgents: uniqueAgents.size,
      taskTypeStats,
    };
  }
}

export { AgentScoring };
