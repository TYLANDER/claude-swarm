import type { TaskType } from "@claude-swarm/types";

/**
 * Agent specialization types
 */
export type AgentSpecialization =
  | "generalist"
  | "frontend"
  | "backend"
  | "infrastructure"
  | "testing"
  | "security";

/**
 * Specialization definition with capabilities and preferences
 */
export interface SpecializationDef {
  name: AgentSpecialization;
  description: string;
  /** Task types this specialization excels at */
  preferredTaskTypes: TaskType[];
  /** File patterns this specialization prefers */
  preferredFilePatterns: string[];
  /** Tools this specialization can use */
  allowedTools: string[];
  /** Default model preference */
  defaultModel: "opus" | "sonnet";
  /** Cost multiplier (1.0 = normal, < 1.0 = cheaper, > 1.0 = more expensive) */
  costMultiplier: number;
}

/**
 * Registry of all agent specializations
 */
export const SPECIALIZATIONS: Record<AgentSpecialization, SpecializationDef> = {
  generalist: {
    name: "generalist",
    description:
      "General-purpose agent capable of handling a wide variety of tasks",
    preferredTaskTypes: ["code", "test", "review", "doc"],
    preferredFilePatterns: ["**/*"],
    allowedTools: [
      "Read",
      "Edit",
      "Write",
      "Bash(git *)",
      "Bash(npm *)",
      "Bash(npx *)",
    ],
    defaultModel: "sonnet",
    costMultiplier: 1.0,
  },

  frontend: {
    name: "frontend",
    description:
      "Specialized in frontend development: React, Vue, CSS, HTML, accessibility",
    preferredTaskTypes: ["code", "test", "review"],
    preferredFilePatterns: [
      "**/*.tsx",
      "**/*.jsx",
      "**/*.vue",
      "**/*.css",
      "**/*.scss",
      "**/*.html",
      "**/components/**",
      "**/pages/**",
      "**/styles/**",
    ],
    allowedTools: [
      "Read",
      "Edit",
      "Write",
      "Bash(git *)",
      "Bash(npm *)",
      "Bash(npx *)",
      "Bash(yarn *)",
      "Bash(pnpm *)",
    ],
    defaultModel: "sonnet",
    costMultiplier: 1.0,
  },

  backend: {
    name: "backend",
    description:
      "Specialized in backend development: APIs, databases, server-side logic",
    preferredTaskTypes: ["code", "test", "review"],
    preferredFilePatterns: [
      "**/*.ts",
      "**/*.js",
      "**/*.py",
      "**/*.go",
      "**/*.rs",
      "**/api/**",
      "**/services/**",
      "**/models/**",
      "**/controllers/**",
    ],
    allowedTools: [
      "Read",
      "Edit",
      "Write",
      "Bash(git *)",
      "Bash(npm *)",
      "Bash(npx *)",
      "Bash(docker *)",
      "Bash(curl *)",
    ],
    defaultModel: "sonnet",
    costMultiplier: 1.0,
  },

  infrastructure: {
    name: "infrastructure",
    description:
      "Specialized in infrastructure: Terraform, Docker, Kubernetes, CI/CD",
    preferredTaskTypes: ["code", "review"],
    preferredFilePatterns: [
      "**/*.tf",
      "**/*.yaml",
      "**/*.yml",
      "**/Dockerfile",
      "**/docker-compose.*",
      "**/.github/**",
      "**/infrastructure/**",
      "**/deploy/**",
    ],
    allowedTools: [
      "Read",
      "Edit",
      "Write",
      "Bash(git *)",
      "Bash(terraform *)",
      "Bash(docker *)",
      "Bash(kubectl *)",
      "Bash(az *)",
      "Bash(aws *)",
    ],
    defaultModel: "sonnet",
    costMultiplier: 1.1, // Slightly more due to infrastructure complexity
  },

  testing: {
    name: "testing",
    description:
      "Specialized in testing: unit tests, integration tests, E2E tests",
    preferredTaskTypes: ["test", "review"],
    preferredFilePatterns: [
      "**/*.test.*",
      "**/*.spec.*",
      "**/__tests__/**",
      "**/test/**",
      "**/tests/**",
      "**/e2e/**",
    ],
    allowedTools: [
      "Read",
      "Edit",
      "Write",
      "Bash(git *)",
      "Bash(npm test*)",
      "Bash(npm run test*)",
      "Bash(npx jest*)",
      "Bash(npx vitest*)",
      "Bash(npx playwright*)",
    ],
    defaultModel: "sonnet",
    costMultiplier: 0.9, // Slightly cheaper for repetitive test tasks
  },

  security: {
    name: "security",
    description:
      "Specialized in security: vulnerability detection, secure coding, auditing",
    preferredTaskTypes: ["security", "review"],
    preferredFilePatterns: [
      "**/*auth*",
      "**/*security*",
      "**/*crypt*",
      "**/*token*",
      "**/*session*",
      "**/*.env*",
      "**/middleware/**",
    ],
    allowedTools: [
      "Read",
      "Edit",
      "Write",
      "Bash(git *)",
      "Bash(npm audit*)",
      "Bash(npx snyk*)",
    ],
    defaultModel: "opus", // Use stronger model for security
    costMultiplier: 1.3, // Higher cost for thorough security analysis
  },
};

/**
 * Get specialization definition
 */
export function getSpecialization(
  name: AgentSpecialization,
): SpecializationDef {
  return SPECIALIZATIONS[name];
}

/**
 * Find the best specialization for a task
 */
export function matchSpecialization(
  taskType: TaskType,
  files: string[],
): AgentSpecialization {
  let bestMatch: AgentSpecialization = "generalist";
  let bestScore = 0;

  for (const [name, spec] of Object.entries(SPECIALIZATIONS)) {
    let score = 0;

    // Score based on task type preference
    if (spec.preferredTaskTypes.includes(taskType)) {
      score += 10;
    }

    // Score based on file pattern matching
    for (const file of files) {
      for (const pattern of spec.preferredFilePatterns) {
        if (matchesPattern(file, pattern)) {
          score += 5;
          break;
        }
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = name as AgentSpecialization;
    }
  }

  return bestMatch;
}

/**
 * Simple glob pattern matching
 */
function matchesPattern(file: string, pattern: string): boolean {
  // Convert glob to regex
  const regexPattern = pattern
    .replace(/\*\*/g, "<<DOUBLESTAR>>")
    .replace(/\*/g, "[^/]*")
    .replace(/<<DOUBLESTAR>>/g, ".*")
    .replace(/\?/g, ".");

  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(file);
}

/**
 * Get all available specializations
 */
export function getAllSpecializations(): SpecializationDef[] {
  return Object.values(SPECIALIZATIONS);
}
