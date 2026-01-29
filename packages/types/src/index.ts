// Task Types
export type TaskType = "code" | "test" | "review" | "doc" | "security";
export type TaskPriority = "high" | "normal" | "low";
export type TaskStatus =
  | "pending"
  | "assigned"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";
export type ModelType = "opus" | "sonnet";

export interface TaskContext {
  /** Git branch to work on */
  branch: string;
  /** Files in scope for this task */
  files: string[];
  /** Task IDs this task depends on */
  dependencies: string[];
  /** Repository URL */
  repository?: string;
  /** Base commit SHA */
  baseCommit?: string;
}

export interface AgentTask {
  /** Unique task identifier */
  id: string;
  /** Parent task ID for sub-task tracking */
  parentTaskId?: string;
  /** Type of task */
  type: TaskType;
  /** Task priority */
  priority: TaskPriority;
  /** Model to use */
  model: ModelType;
  /** Claude prompt */
  prompt: string;
  /** Task context */
  context: TaskContext;
  /** Maximum tokens for completion */
  maxTokens?: number;
  /** Timeout in minutes */
  timeoutMinutes: number;
  /** Budget limit in cents */
  budgetCents: number;
  /** Task creation timestamp */
  createdAt: string;
  /** Assigned agent ID */
  assignedAgent?: string;
  /** Current status */
  status: TaskStatus;
}

// Result Types
export type ResultStatus = "success" | "partial" | "failed";

export interface FileChange {
  path: string;
  action: "add" | "modify" | "delete";
  diff?: string;
}

export interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
}

export interface ReviewComment {
  file: string;
  line: number;
  message: string;
  severity: "error" | "warning" | "info";
}

export interface ConflictInfo {
  file: string;
  conflictingAgents: string[];
  resolution?: "auto" | "manual";
}

export interface TokenUsage {
  input: number;
  output: number;
  cached: number;
}

export interface AgentResult {
  /** Task ID */
  taskId: string;
  /** Agent ID */
  agentId: string;
  /** Result status */
  status: ResultStatus;
  /** Task outputs */
  outputs: {
    filesChanged: FileChange[];
    testsRun?: TestResult[];
    reviewComments?: ReviewComment[];
    summary?: string;
  };
  /** Token usage metrics */
  tokensUsed: TokenUsage;
  /** Execution duration in milliseconds */
  durationMs: number;
  /** Cost in cents */
  costCents: number;
  /** Base commit SHA */
  baseCommit: string;
  /** Result commit SHA */
  resultCommit: string;
  /** Detected conflicts */
  conflicts?: ConflictInfo[];
  /** Error message if failed */
  error?: string;
}

// Agent Types
export type AgentStatus =
  | "idle"
  | "initializing"
  | "running"
  | "completed"
  | "failed"
  | "terminated";

export interface Agent {
  id: string;
  status: AgentStatus;
  currentTask?: string;
  startedAt?: string;
  completedAt?: string;
  branch?: string;
  tokensUsed: TokenUsage;
  costCents: number;
}

// Budget Types
export interface BudgetConfig {
  /** Maximum cents per task */
  perTaskMaxCents: number;
  /** Daily budget limit in cents */
  dailyLimitCents: number;
  /** Weekly budget limit in cents */
  weeklyLimitCents: number;
  /** Percentage threshold for alerts */
  alertThresholdPercent: number;
  /** Percentage threshold for auto-pause */
  pauseThresholdPercent: number;
}

export interface BudgetStatus {
  config: BudgetConfig;
  dailyUsedCents: number;
  weeklyUsedCents: number;
  isPaused: boolean;
  lastUpdated: string;
}

// Queue Types
export interface QueueMessage<T> {
  id: string;
  body: T;
  enqueuedAt: string;
  dequeueCount: number;
}

// API Types
export interface SubmitTaskRequest {
  tasks: Omit<AgentTask, "id" | "createdAt" | "status" | "assignedAgent">[];
}

export interface SubmitTaskResponse {
  taskIds: string[];
  estimatedCostCents: number;
}

export interface TaskStatusResponse {
  task: AgentTask;
  result?: AgentResult;
}

export interface AgentListResponse {
  agents: Agent[];
  totalActive: number;
  totalCostCents: number;
}

export interface BudgetResponse {
  status: BudgetStatus;
  projectedDailyCostCents: number;
}
