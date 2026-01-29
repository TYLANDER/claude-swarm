import type { TokenUsage, ModelType } from '@claude-swarm/types';

/**
 * Model pricing in dollars per million tokens
 */
export const MODEL_PRICING = {
  opus: { input: 5, output: 25, cached: 0.5 },
  sonnet: { input: 3, output: 15, cached: 0.3 },
} as const;

/**
 * Calculate cost in cents from token usage
 */
export function calculateCostCents(tokens: TokenUsage, model: ModelType): number {
  const pricing = MODEL_PRICING[model];

  const inputCost = (tokens.input / 1_000_000) * pricing.input;
  const outputCost = (tokens.output / 1_000_000) * pricing.output;
  const cachedCost = (tokens.cached / 1_000_000) * pricing.cached;

  return Math.round((inputCost + outputCost + cachedCost) * 100);
}

/**
 * Format cents as dollars string
 */
export function formatCurrency(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Format token count with commas
 */
export function formatTokens(count: number): string {
  return count.toLocaleString();
}

/**
 * Format duration in ms to human readable
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
  return `${(ms / 3600000).toFixed(1)}h`;
}

/**
 * Generate a short ID for display
 */
export function shortId(id: string, length: number = 8): string {
  return id.slice(0, length);
}

/**
 * Validate task type
 */
export function isValidTaskType(type: string): boolean {
  return ['code', 'test', 'review', 'doc', 'security'].includes(type);
}

/**
 * Validate priority
 */
export function isValidPriority(priority: string): boolean {
  return ['high', 'normal', 'low'].includes(priority);
}

/**
 * Validate model
 */
export function isValidModel(model: string): boolean {
  return ['opus', 'sonnet'].includes(model);
}

/**
 * Default budget limits
 */
export const DEFAULT_BUDGET = {
  perTaskMaxCents: 500,
  dailyLimitCents: 10000,
  weeklyLimitCents: 50000,
  alertThresholdPercent: 80,
  pauseThresholdPercent: 100,
} as const;

/**
 * Default task configuration
 */
export const DEFAULT_TASK = {
  model: 'sonnet' as ModelType,
  priority: 'normal' as const,
  budgetCents: 100,
  timeoutMinutes: 30,
} as const;
