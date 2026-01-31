import simpleGit, { SimpleGit, MergeResult } from "simple-git";
import type { ConflictInfo } from "@claude-swarm/types";

/**
 * Result of conflict detection
 */
export interface ConflictDetectionResult {
  hasConflicts: boolean;
  conflicts: ConflictInfo[];
  canAutoResolve: boolean;
}

/**
 * Detect merge conflicts before pushing
 * Uses a dry-run merge to check for conflicts without modifying the working tree
 */
export async function detectConflicts(
  worktreePath: string,
  targetBranch: string,
  agentId: string,
): Promise<ConflictDetectionResult> {
  const git = simpleGit(worktreePath);

  try {
    // Fetch latest from remote
    await git.fetch(["origin", targetBranch]);

    // Get current branch
    const currentBranch = await git.revparse(["--abbrev-ref", "HEAD"]);

    // Try a dry-run merge
    let mergeResult: MergeResult;
    try {
      mergeResult = await git.merge([
        `origin/${targetBranch}`,
        "--no-commit",
        "--no-ff",
      ]);
    } catch (error) {
      // Merge failed - conflicts detected
      const conflicts = await parseConflicts(git, agentId);

      // Abort the merge to restore working tree
      await git.merge(["--abort"]).catch(() => {
        // Ignore abort failures
      });

      return {
        hasConflicts: true,
        conflicts,
        canAutoResolve: canAutoResolveConflicts(conflicts),
      };
    }

    // Merge succeeded - abort it since this was just a test
    await git.merge(["--abort"]).catch(() => {
      // If abort fails, reset to clean state
      return git.reset(["--hard", "HEAD"]);
    });

    return {
      hasConflicts: false,
      conflicts: [],
      canAutoResolve: true,
    };
  } catch (error) {
    // On any error, try to restore clean state
    await git.reset(["--hard", "HEAD"]).catch(() => {});

    throw new Error(
      `Conflict detection failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Parse git status to extract conflict information
 */
async function parseConflicts(
  git: SimpleGit,
  agentId: string,
): Promise<ConflictInfo[]> {
  const status = await git.status();
  const conflicts: ConflictInfo[] = [];

  for (const file of status.conflicted) {
    conflicts.push({
      file,
      conflictingAgents: [agentId, "origin"], // We know it's between agent and origin
      resolution: undefined,
    });
  }

  return conflicts;
}

/**
 * Determine if conflicts can be auto-resolved
 * Currently only auto-resolves non-overlapping changes
 */
function canAutoResolveConflicts(conflicts: ConflictInfo[]): boolean {
  // Simple heuristic: no auto-resolve if more than 3 files conflict
  // In production, you'd want more sophisticated analysis
  return conflicts.length <= 3;
}

/**
 * Attempt to auto-resolve conflicts using "ours" strategy for non-critical files
 */
export async function autoResolveConflicts(
  worktreePath: string,
  conflicts: ConflictInfo[],
  strategy: "ours" | "theirs" = "ours",
): Promise<{ resolved: string[]; failed: string[] }> {
  const git = simpleGit(worktreePath);
  const resolved: string[] = [];
  const failed: string[] = [];

  for (const conflict of conflicts) {
    try {
      // Use checkout with strategy
      if (strategy === "ours") {
        await git.checkout(["--ours", conflict.file]);
      } else {
        await git.checkout(["--theirs", conflict.file]);
      }

      // Stage the resolved file
      await git.add(conflict.file);
      resolved.push(conflict.file);
      conflict.resolution = "auto";
    } catch {
      failed.push(conflict.file);
      conflict.resolution = "manual";
    }
  }

  return { resolved, failed };
}

/**
 * Check if working directory has any uncommitted changes
 */
export async function hasUncommittedChanges(
  worktreePath: string,
): Promise<boolean> {
  const git = simpleGit(worktreePath);
  const status = await git.status();
  return !status.isClean();
}

/**
 * Get the diff between current branch and target branch
 */
export async function getBranchDiff(
  worktreePath: string,
  targetBranch: string,
): Promise<{ files: string[]; additions: number; deletions: number }> {
  const git = simpleGit(worktreePath);

  await git.fetch(["origin", targetBranch]);

  const diff = await git.diffSummary([`origin/${targetBranch}...HEAD`]);

  return {
    files: diff.files.map((f) => f.file),
    additions: diff.insertions,
    deletions: diff.deletions,
  };
}

/**
 * Ensure branch is up to date with remote before pushing
 */
export async function ensureBranchUpToDate(
  worktreePath: string,
  targetBranch: string,
): Promise<{ upToDate: boolean; behind: number; ahead: number }> {
  const git = simpleGit(worktreePath);

  await git.fetch(["origin"]);

  const currentBranch = (await git.revparse(["--abbrev-ref", "HEAD"])).trim();
  const local = await git.revparse(["HEAD"]);
  const remote = await git.revparse([`origin/${targetBranch}`]).catch(() => null);

  if (!remote) {
    // Remote branch doesn't exist yet
    return { upToDate: true, behind: 0, ahead: 1 };
  }

  // Count commits behind and ahead
  const behindAhead = await git.raw([
    "rev-list",
    "--left-right",
    "--count",
    `${local}...origin/${targetBranch}`,
  ]);

  const [ahead, behind] = behindAhead.trim().split(/\s+/).map(Number);

  return {
    upToDate: behind === 0,
    behind,
    ahead,
  };
}
