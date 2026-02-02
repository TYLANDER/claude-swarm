#!/usr/bin/env npx tsx
/**
 * Test script to verify Claude CLI can execute tasks for the swarm
 * Usage: npx tsx scripts/test-executor.ts
 *
 * NOTE: This uses Claude Code's existing session auth (~/.claude/),
 * NOT an ANTHROPIC_API_KEY. Make sure you're logged into Claude Code first.
 */

import { spawn } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execSync } from 'child_process';

interface TaskResult {
  type: string;
  subtype: string;
  result?: string;
  duration_ms: number;
  total_cost_usd: number;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
  };
}

async function main() {
  console.log('🧪 Claude Swarm - Executor Test\n');
  console.log('─'.repeat(50));
  console.log('NOTE: Using Claude Code session auth (~/.claude/)');
  console.log('      ANTHROPIC_API_KEY is NOT used by Claude CLI');
  console.log('─'.repeat(50));

  // Create a temporary working directory
  const workDir = mkdtempSync(join(tmpdir(), 'swarm-test-'));
  console.log(`\n📁 Working directory: ${workDir}`);

  // Initialize a git repo
  execSync('git init', { cwd: workDir, stdio: 'pipe' });
  execSync('git config user.email "test@swarm.local"', { cwd: workDir, stdio: 'pipe' });
  execSync('git config user.name "Swarm Test"', { cwd: workDir, stdio: 'pipe' });

  // Create initial file so git has something
  writeFileSync(join(workDir, 'README.md'), '# Test\n');
  execSync('git add . && git commit -m "init"', { cwd: workDir, stdio: 'pipe' });

  const prompt =
    'Create a file called hello.ts with: export default function hello() { return "Hello, Swarm!"; }';

  console.log(`\n📋 Task: "${prompt.substring(0, 60)}..."`);
  console.log('─'.repeat(50));
  console.log('\n⏳ Executing with Claude CLI...\n');

  const startTime = Date.now();

  try {
    const result = await runClaudeCli(prompt, workDir, 60000); // 60s timeout
    const durationMs = Date.now() - startTime;

    console.log('─'.repeat(50));
    console.log('\n✅ Task completed!\n');

    console.log('📊 Results:');
    console.log(`   Duration: ${(durationMs / 1000).toFixed(2)}s`);
    console.log(`   API Duration: ${(result.duration_ms / 1000).toFixed(2)}s`);
    console.log(`   Cost: $${result.total_cost_usd.toFixed(4)}`);
    console.log(`   Tokens: ${result.usage.input_tokens} in / ${result.usage.output_tokens} out`);

    if (result.usage.cache_read_input_tokens) {
      console.log(`   Cached: ${result.usage.cache_read_input_tokens}`);
    }

    // Check for created files
    console.log('\n📝 Git status:');
    const status = execSync('git status --porcelain', { cwd: workDir, encoding: 'utf-8' });
    if (status.trim()) {
      status
        .trim()
        .split('\n')
        .forEach((line) => console.log(`   ${line}`));
    } else {
      console.log('   (no changes)');
    }

    // Try to show the created file
    try {
      const content = execSync('cat hello.ts', { cwd: workDir, encoding: 'utf-8' });
      console.log(`\n📄 hello.ts:\n${'─'.repeat(30)}\n${content}${'─'.repeat(30)}`);
    } catch {
      console.log('\n⚠️  hello.ts was not created');
    }

    if (result.result) {
      console.log(
        `\n💬 Claude's response:\n   ${result.result.substring(0, 300)}${result.result.length > 300 ? '...' : ''}`
      );
    }

    console.log('\n🎉 Executor test PASSED!');
  } catch (error) {
    const durationMs = Date.now() - startTime;
    console.log('─'.repeat(50));
    console.error('\n❌ Task failed!\n');
    console.error(`   Duration: ${(durationMs / 1000).toFixed(2)}s`);
    console.error(`   Error: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  } finally {
    try {
      rmSync(workDir, { recursive: true, force: true });
      console.log(`\n🧹 Cleaned up temp directory`);
    } catch {
      /* ignore */
    }
  }
}

function runClaudeCli(prompt: string, cwd: string, timeoutMs: number): Promise<TaskResult> {
  return new Promise((resolve, reject) => {
    const args = [
      '-p',
      prompt,
      '--output-format',
      'json',
      '--max-turns',
      '3',
      '--allowedTools',
      'Read,Edit,Write',
    ];

    console.log(`   Running: claude ${args.slice(0, 3).join(' ')}...`);

    const proc = spawn('claude', args, {
      cwd,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let killed = false;

    const timeout = setTimeout(() => {
      killed = true;
      proc.kill('SIGTERM');
      setTimeout(() => proc.kill('SIGKILL'), 5000);
    }, timeoutMs);

    proc.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    proc.on('close', (code) => {
      clearTimeout(timeout);

      if (killed) {
        reject(new Error(`Timed out after ${timeoutMs}ms`));
        return;
      }

      if (code !== 0) {
        reject(new Error(`Claude CLI exited with code ${code}: ${stderr || stdout}`));
        return;
      }

      try {
        const result = JSON.parse(stdout) as TaskResult;
        resolve(result);
      } catch {
        reject(new Error(`Failed to parse JSON output: ${stdout.substring(0, 200)}`));
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`Failed to spawn Claude CLI: ${err.message}`));
    });
  });
}

main();
