import { z } from "zod";

// Constants for validation limits
const MAX_PROMPT_LENGTH = 50_000;
const MAX_FILES_PER_TASK = 100;
const MAX_DEPENDENCIES = 50;
const MAX_TASKS_PER_SUBMISSION = 20;

/**
 * Task type enum
 */
export const TaskTypeSchema = z.enum(["code", "test", "review", "doc", "security"]);

/**
 * Task priority enum
 */
export const PrioritySchema = z.enum(["high", "normal", "low"]);

/**
 * Model type enum
 */
export const ModelSchema = z.enum(["opus", "sonnet"]);

/**
 * UUID validation
 */
export const UuidSchema = z.string().uuid();

/**
 * Task context schema
 */
export const TaskContextSchema = z.object({
  branch: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[a-zA-Z0-9._\-/]+$/, "Invalid branch name format"),
  files: z
    .array(z.string().max(500))
    .max(MAX_FILES_PER_TASK)
    .default([]),
  dependencies: z
    .array(UuidSchema)
    .max(MAX_DEPENDENCIES)
    .default([]),
  repository: z.string().url().optional(),
  baseCommit: z
    .string()
    .regex(/^[a-f0-9]{40}$/, "Invalid commit SHA")
    .optional(),
});

/**
 * Individual task input schema (for submission)
 */
export const TaskInputSchema = z.object({
  type: TaskTypeSchema,
  priority: PrioritySchema.default("normal"),
  model: ModelSchema.default("sonnet"),
  prompt: z
    .string()
    .min(1, "Prompt is required")
    .max(MAX_PROMPT_LENGTH, `Prompt must be under ${MAX_PROMPT_LENGTH} characters`),
  context: TaskContextSchema,
  maxTokens: z.number().int().positive().max(200_000).optional(),
  timeoutMinutes: z.number().int().min(1).max(120).default(30),
  budgetCents: z.number().int().min(1).max(10_000).default(100),
  parentTaskId: UuidSchema.optional(),
});

/**
 * Submit task request schema
 */
export const SubmitTaskRequestSchema = z.object({
  tasks: z
    .array(TaskInputSchema)
    .min(1, "At least one task is required")
    .max(MAX_TASKS_PER_SUBMISSION, `Maximum ${MAX_TASKS_PER_SUBMISSION} tasks per submission`),
});

/**
 * Task ID parameter schema (for routes like /api/tasks/:id)
 */
export const TaskIdParamSchema = z.object({
  id: UuidSchema,
});

/**
 * Pagination query schema
 */
export const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/**
 * Task list filter schema
 */
export const TaskListFilterSchema = z.object({
  status: z.enum(["pending", "assigned", "running", "completed", "failed", "cancelled"]).optional(),
  type: TaskTypeSchema.optional(),
  priority: PrioritySchema.optional(),
}).merge(PaginationSchema);

/**
 * DLQ reprocess request schema
 */
export const DlqReprocessSchema = z.object({
  queue: z.enum(["agent-tasks-high", "agent-tasks", "agent-tasks-low", "agent-results"]),
});

// Type exports inferred from schemas
export type TaskInput = z.infer<typeof TaskInputSchema>;
export type SubmitTaskRequest = z.infer<typeof SubmitTaskRequestSchema>;
export type TaskContext = z.infer<typeof TaskContextSchema>;
export type TaskIdParam = z.infer<typeof TaskIdParamSchema>;
export type PaginationParams = z.infer<typeof PaginationSchema>;
export type TaskListFilter = z.infer<typeof TaskListFilterSchema>;
export type DlqReprocessRequest = z.infer<typeof DlqReprocessSchema>;
