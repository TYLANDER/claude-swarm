import type { AgentTask, AgentResult } from "@claude-swarm/types";

/**
 * Supported orchestration topology types
 */
export type TopologyType = "hub-spoke" | "hierarchical" | "mesh";

/**
 * Sub-task spawned by a lead agent in hierarchical topology
 */
export interface SubTask {
  /** Parent task ID */
  parentTaskId: string;
  /** The agent that created this sub-task */
  creatorAgentId: string;
  /** Sub-task definition */
  task: Omit<AgentTask, "id" | "createdAt" | "status">;
  /** Priority relative to siblings */
  localPriority: number;
}

/**
 * Message between agents in mesh topology
 */
export interface AgentMessage {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  taskId: string;
  type: "request" | "response" | "broadcast";
  payload: unknown;
  timestamp: string;
}

/**
 * Configuration for topology behavior
 */
export interface TopologyConfig {
  /** The topology type */
  type: TopologyType;
  /** Maximum depth for hierarchical spawning */
  maxDepth?: number;
  /** Maximum sub-tasks per agent */
  maxSubTasksPerAgent?: number;
  /** Allow direct agent-to-agent communication (mesh) */
  allowPeerCommunication?: boolean;
  /** Timeout for waiting on peer responses (mesh) */
  peerTimeoutMs?: number;
}

/**
 * Interface for topology implementations
 */
export interface TopologyHandler {
  /** Type identifier */
  readonly type: TopologyType;

  /** Process a task submission */
  submitTask(task: AgentTask): Promise<void>;

  /** Handle task completion and trigger downstream work */
  onTaskComplete(result: AgentResult): Promise<void>;

  /** Handle sub-task creation (hierarchical) */
  createSubTask?(subTask: SubTask): Promise<string>;

  /** Send message to another agent (mesh) */
  sendMessage?(message: Omit<AgentMessage, "id" | "timestamp">): Promise<void>;

  /** Get messages for an agent (mesh) */
  getMessages?(agentId: string): Promise<AgentMessage[]>;
}

/**
 * Default topology configurations
 */
export const DEFAULT_CONFIGS: Record<TopologyType, TopologyConfig> = {
  "hub-spoke": {
    type: "hub-spoke",
  },
  hierarchical: {
    type: "hierarchical",
    maxDepth: 3,
    maxSubTasksPerAgent: 5,
  },
  mesh: {
    type: "mesh",
    allowPeerCommunication: true,
    peerTimeoutMs: 30000,
  },
};
