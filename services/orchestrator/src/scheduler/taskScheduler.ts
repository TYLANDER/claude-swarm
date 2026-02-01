import type { AgentTask, TaskType, Agent } from '@claude-swarm/types';
import type { StateStore } from '../store/types.js';
import { AgentScoring } from '../routing/agentScoring.js';
import { DependencyGraph } from './dependencyGraph.js';
import { EventEmitter } from 'events';

/**
 * Task assignment result
 */
export interface TaskAssignment {
  taskId: string;
  agentId: string;
  score: number;
  reason: string;
}

/**
 * Scheduling decision with explanation
 */
export interface SchedulingDecision {
  assignments: TaskAssignment[];
  deferred: { taskId: string; reason: string }[];
  blocked: { taskId: string; blockedBy: string[] }[];
}

/**
 * Smart task scheduler that combines dependency graph with agent scoring
 */
export class TaskScheduler extends EventEmitter {
  private store: StateStore;
  private scoring: AgentScoring;
  private graph: DependencyGraph;
  private maxConcurrentPerAgent: number;

  constructor(
    store: StateStore,
    scoring: AgentScoring,
    graph: DependencyGraph,
    maxConcurrentPerAgent: number = 1
  ) {
    super();
    this.store = store;
    this.scoring = scoring;
    this.graph = graph;
    this.maxConcurrentPerAgent = maxConcurrentPerAgent;
  }

  /**
   * Main scheduling loop - finds optimal task-agent assignments
   */
  async schedule(availableAgents: Agent[]): Promise<SchedulingDecision> {
    const decision: SchedulingDecision = {
      assignments: [],
      deferred: [],
      blocked: [],
    };

    // Get tasks ready to run (dependencies met)
    const readyTaskIds = await this.graph.getReadyTasks();

    if (readyTaskIds.length === 0) {
      return decision;
    }

    // Load full task objects
    const readyTasks: AgentTask[] = [];
    for (const taskId of readyTaskIds) {
      const task = await this.store.getTask(taskId);
      if (task && task.status === 'pending') {
        readyTasks.push(task);
      }
    }

    // Sort tasks by priority
    const prioritizedTasks = this.prioritizeTasks(readyTasks);

    // Filter available agents (not at capacity)
    const agentsWithCapacity = availableAgents.filter(
      (a) => a.status === 'idle' || this.getAgentTaskCount(a.id) < this.maxConcurrentPerAgent
    );

    // Assign tasks to best-fit agents
    for (const task of prioritizedTasks) {
      // Check if any agent has capacity
      if (agentsWithCapacity.length === 0) {
        decision.deferred.push({
          taskId: task.id,
          reason: 'No agents with capacity available',
        });
        continue;
      }

      // Find best agent for this task
      const assignment = await this.findBestAgent(task, agentsWithCapacity);

      if (assignment) {
        decision.assignments.push(assignment);

        // Update agent capacity tracking
        const agentIndex = agentsWithCapacity.findIndex((a) => a.id === assignment.agentId);
        if (this.getAgentTaskCount(assignment.agentId) >= this.maxConcurrentPerAgent) {
          agentsWithCapacity.splice(agentIndex, 1);
        }

        // Emit assignment event
        this.emit('task:assigned', assignment);
      } else {
        decision.deferred.push({
          taskId: task.id,
          reason: 'No suitable agent found for task type',
        });
      }
    }

    // Find blocked tasks (for visibility)
    const pendingTasks = await this.store.listTasks({ status: 'pending' });
    for (const task of pendingTasks) {
      if (!readyTaskIds.includes(task.id)) {
        const deps = await this.store.getDependencies(task.id);
        const unmetDeps = [];
        for (const depId of deps) {
          const depTask = await this.store.getTask(depId);
          if (depTask && depTask.status !== 'completed') {
            unmetDeps.push(depId);
          }
        }
        if (unmetDeps.length > 0) {
          decision.blocked.push({
            taskId: task.id,
            blockedBy: unmetDeps,
          });
        }
      }
    }

    return decision;
  }

  /**
   * Find the best agent for a task based on scoring
   */
  private async findBestAgent(
    task: AgentTask,
    availableAgents: Agent[]
  ): Promise<TaskAssignment | null> {
    if (availableAgents.length === 0) return null;

    let bestAgent: Agent | null = null;
    let bestScore = -1;
    let bestReason = '';

    for (const agent of availableAgents) {
      const performance = await this.scoring.getPerformance(agent.id, task.type);
      const score = this.scoring.calculateScore(performance, task);

      // Apply specialization bonus
      const specializationBonus = this.getSpecializationBonus(agent, task.type);
      const adjustedScore = score * (1 + specializationBonus);

      if (adjustedScore > bestScore) {
        bestScore = adjustedScore;
        bestAgent = agent;
        bestReason = this.explainScore(performance, specializationBonus);
      }
    }

    if (!bestAgent) return null;

    return {
      taskId: task.id,
      agentId: bestAgent.id,
      score: bestScore,
      reason: bestReason,
    };
  }

  /**
   * Prioritize tasks based on multiple factors
   */
  private prioritizeTasks(tasks: AgentTask[]): AgentTask[] {
    return tasks.sort((a, b) => {
      // Priority weight
      const priorityWeight = { high: 3, normal: 2, low: 1 };
      const priorityDiff =
        (priorityWeight[b.priority] || 2) - (priorityWeight[a.priority] || 2);
      if (priorityDiff !== 0) return priorityDiff;

      // Older tasks first (FIFO within same priority)
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
  }

  /**
   * Get specialization bonus for agent/task type match
   */
  private getSpecializationBonus(agent: Agent, taskType: TaskType): number {
    // In a real system, agents would have declared specializations
    // For now, use task history as a proxy
    const metrics = this.scoring.getMetricsByTaskType(taskType);
    const agentMetrics = metrics.find((m) => m.agentId === agent.id);

    if (!agentMetrics) return 0;

    // Bonus based on experience with this task type
    if (agentMetrics.completedCount > 50) return 0.2;
    if (agentMetrics.completedCount > 20) return 0.1;
    if (agentMetrics.completedCount > 5) return 0.05;

    return 0;
  }

  /**
   * Get current task count for an agent
   */
  private getAgentTaskCount(_agentId: string): number {
    // In production, query the store for running tasks assigned to this agent
    return 0; // Simplified for now
  }

  /**
   * Generate human-readable explanation for score
   */
  private explainScore(
    performance: { successRate: number; avgDurationMs: number; completedCount: number },
    specializationBonus: number
  ): string {
    const parts: string[] = [];

    if (performance.successRate > 0.9) {
      parts.push('high success rate');
    } else if (performance.successRate > 0.7) {
      parts.push('good success rate');
    }

    if (performance.avgDurationMs < 60000) {
      parts.push('fast execution');
    }

    if (performance.completedCount > 20) {
      parts.push('experienced');
    }

    if (specializationBonus > 0.1) {
      parts.push('specialized');
    }

    return parts.length > 0 ? parts.join(', ') : 'default assignment';
  }

  /**
   * Rebalance tasks if an agent becomes unavailable
   */
  async rebalance(unavailableAgentId: string, availableAgents: Agent[]): Promise<TaskAssignment[]> {
    const reassignments: TaskAssignment[] = [];

    // Find tasks assigned to unavailable agent
    const tasks = await this.store.listTasks({ status: 'assigned' });
    const affectedTasks = tasks.filter((t) => t.assignedAgent === unavailableAgentId);

    for (const task of affectedTasks) {
      // Mark task as pending again
      task.status = 'pending';
      task.assignedAgent = undefined;
      await this.store.setTask(task);

      // Try to reassign
      const assignment = await this.findBestAgent(task, availableAgents);
      if (assignment) {
        reassignments.push(assignment);
        this.emit('task:reassigned', { ...assignment, previousAgent: unavailableAgentId });
      }
    }

    return reassignments;
  }
}
