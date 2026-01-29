import { spawn } from "child_process";
import type { AgentTask, FileChange, TokenUsage } from "@claude-swarm/types";

interface ExecutorOptions {
  anthropicApiKey: string;
  model: string;
  maxTokens?: number;
  budgetCents: number;
}

interface ExecutorResult {
  outputs: {
    filesChanged: FileChange[];
    summary?: string;
  };
  tokensUsed: TokenUsage;
}

/**
 * Execute a task using Claude Agent SDK CLI
 */
export async function executeTask(
  task: AgentTask,
  workingDir: string,
  options: ExecutorOptions,
): Promise<ExecutorResult> {
  const { anthropicApiKey, model, budgetCents } = options;

  // Build the Claude CLI command
  const args = [
    "-p", // Print mode (non-interactive)
    task.prompt,
    "--output-format",
    "json",
    "--model",
    model === "opus"
      ? "claude-opus-4-5-20251101"
      : "claude-sonnet-4-5-20250929",
    "--allowedTools",
    "Read,Edit,Write,Bash(git *),Bash(npm *),Bash(npx *)",
  ];

  // Add file context if specified
  if (task.context.files.length > 0) {
    args.push(
      "--append-system-prompt",
      `Focus on these files: ${task.context.files.join(", ")}`,
    );
  }

  // Execute Claude CLI
  const result = await runClaudeCli(args, workingDir, anthropicApiKey);

  // Parse the result
  const parsed = JSON.parse(result.stdout);

  // Extract file changes from git status
  const filesChanged = await getGitChanges(workingDir);

  // Calculate tokens from response
  const tokensUsed: TokenUsage = {
    input: parsed.usage?.input_tokens || 0,
    output: parsed.usage?.output_tokens || 0,
    cached: parsed.usage?.cache_read_input_tokens || 0,
  };

  // Check budget
  const estimatedCost = estimateCost(tokensUsed, model);
  if (estimatedCost > budgetCents) {
    console.warn(
      `Task exceeded budget: ${estimatedCost} cents > ${budgetCents} cents`,
    );
  }

  return {
    outputs: {
      filesChanged,
      summary: parsed.result || parsed.content?.[0]?.text,
    },
    tokensUsed,
  };
}

/**
 * Run the Claude CLI as a subprocess
 */
function runClaudeCli(
  args: string[],
  cwd: string,
  apiKey: string,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn("claude", args, {
      cwd,
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: apiKey,
      },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`Claude CLI exited with code ${code}: ${stderr}`));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to spawn Claude CLI: ${err.message}`));
    });
  });
}

/**
 * Get list of changed files from git
 */
async function getGitChanges(workingDir: string): Promise<FileChange[]> {
  return new Promise((resolve, reject) => {
    const proc = spawn("git", ["status", "--porcelain"], { cwd: workingDir });

    let stdout = "";
    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        resolve([]);
        return;
      }

      const changes: FileChange[] = stdout
        .trim()
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => {
          const status = line.substring(0, 2).trim();
          const path = line.substring(3);

          let action: FileChange["action"];
          if (status.includes("A") || status === "??") {
            action = "add";
          } else if (status.includes("D")) {
            action = "delete";
          } else {
            action = "modify";
          }

          return { path, action };
        });

      resolve(changes);
    });

    proc.on("error", () => resolve([]));
  });
}

/**
 * Estimate cost in cents
 */
function estimateCost(tokens: TokenUsage, model: string): number {
  const pricing =
    model === "opus"
      ? { input: 5, output: 25, cached: 0.5 }
      : { input: 3, output: 15, cached: 0.3 };

  const inputCost = (tokens.input / 1_000_000) * pricing.input;
  const outputCost = (tokens.output / 1_000_000) * pricing.output;
  const cachedCost = (tokens.cached / 1_000_000) * pricing.cached;

  return Math.round((inputCost + outputCost + cachedCost) * 100);
}
