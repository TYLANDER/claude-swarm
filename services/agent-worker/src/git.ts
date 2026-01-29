import simpleGit, { SimpleGit } from "simple-git";
import { mkdir, rm } from "fs/promises";
import { join } from "path";

const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || "/workspace";

/**
 * Setup a git worktree for isolated agent work
 */
export async function setupGitWorktree(
  repository: string,
  branch: string,
  taskId: string,
): Promise<string> {
  const worktreePath = join(WORKSPACE_ROOT, `worktree-${taskId}`);
  const mainRepoPath = join(WORKSPACE_ROOT, "repo");

  // Ensure workspace exists
  await mkdir(WORKSPACE_ROOT, { recursive: true });

  // Clone or update main repo
  let git: SimpleGit;
  try {
    git = simpleGit(mainRepoPath);
    await git.fetch(["--all"]);
  } catch {
    // Clone if doesn't exist
    console.log(`Cloning repository: ${repository}`);
    await simpleGit().clone(repository, mainRepoPath, ["--depth", "1"]);
    git = simpleGit(mainRepoPath);
  }

  // Create worktree for this task
  const agentBranch = `agent/${taskId}`;

  try {
    // Create branch from target branch if it doesn't exist
    await git.checkout(branch);
    await git.pull("origin", branch);

    // Create agent branch
    await git.checkoutBranch(agentBranch, branch);

    // Add worktree
    await git.raw(["worktree", "add", worktreePath, agentBranch]);

    console.log(`Created worktree at ${worktreePath} on branch ${agentBranch}`);
    return worktreePath;
  } catch (error) {
    // If worktree already exists, use it
    if (String(error).includes("already exists")) {
      console.log(`Worktree already exists at ${worktreePath}`);
      return worktreePath;
    }
    throw error;
  }
}

/**
 * Commit changes and push to remote
 */
export async function commitAndPush(
  worktreePath: string,
  taskId: string,
  agentId: string,
): Promise<string> {
  const git = simpleGit(worktreePath);

  // Configure git identity
  await git.addConfig("user.name", `Claude Agent ${agentId}`);
  await git.addConfig(
    "user.email",
    `claude-agent-${agentId}@claude-swarm.local`,
  );

  // Check if there are changes to commit
  const status = await git.status();
  if (status.files.length === 0) {
    console.log("No changes to commit");
    const log = await git.log(["-1"]);
    return log.latest?.hash || "";
  }

  // Stage all changes
  await git.add(".");

  // Create commit
  const commitMessage = `feat(agent): complete task ${taskId}

Task-ID: ${taskId}
Agent-ID: ${agentId}

Co-Authored-By: Claude Agent ${agentId} <claude-agent-${agentId}@claude-swarm.local>`;

  await git.commit(commitMessage);

  // Get commit hash
  const log = await git.log(["-1"]);
  const commitHash = log.latest?.hash || "";

  // Push to remote
  const branch = await git.revparse(["--abbrev-ref", "HEAD"]);
  await git.push("origin", branch.trim(), ["--force-with-lease"]);

  console.log(`Pushed commit ${commitHash} to ${branch.trim()}`);
  return commitHash;
}

/**
 * Cleanup worktree after task completion
 */
export async function cleanupWorktree(worktreePath: string): Promise<void> {
  const mainRepoPath = join(WORKSPACE_ROOT, "repo");

  try {
    const git = simpleGit(mainRepoPath);

    // Remove worktree
    await git.raw(["worktree", "remove", worktreePath, "--force"]);
    console.log(`Removed worktree at ${worktreePath}`);
  } catch (error) {
    // Try manual cleanup if git command fails
    console.warn(`Git worktree remove failed, trying manual cleanup: ${error}`);
    await rm(worktreePath, { recursive: true, force: true });
  }
}

/**
 * Get the current commit hash
 */
export async function getCurrentCommit(workingDir: string): Promise<string> {
  const git = simpleGit(workingDir);
  const log = await git.log(["-1"]);
  return log.latest?.hash || "";
}

/**
 * Check if there are uncommitted changes
 */
export async function hasUncommittedChanges(
  workingDir: string,
): Promise<boolean> {
  const git = simpleGit(workingDir);
  const status = await git.status();
  return status.files.length > 0;
}
