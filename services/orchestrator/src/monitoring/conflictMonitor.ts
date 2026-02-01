import type { Agent, AgentTask, ConflictInfo } from '@claude-swarm/types';
import type { StateStore } from '../store/types.js';
import { EventEmitter } from 'events';

/**
 * File lock entry
 */
export interface FileLock {
  file: string;
  agentId: string;
  taskId: string;
  lockedAt: string;
  branch: string;
}

/**
 * Conflict event data
 */
export interface ConflictEvent {
  type: 'potential' | 'detected' | 'resolved';
  files: string[];
  agents: string[];
  severity: 'low' | 'medium' | 'high';
  recommendation: string;
}

/**
 * Real-time conflict monitoring across multiple agents
 */
export class ConflictMonitor extends EventEmitter {
  private store: StateStore;
  /** File -> Agent mapping for detecting overlapping work */
  private fileLocks: Map<string, FileLock>;
  /** Agent -> Files being modified */
  private agentFiles: Map<string, Set<string>>;
  /** Historical conflict patterns */
  private conflictHistory: ConflictInfo[];

  constructor(store: StateStore) {
    super();
    this.store = store;
    this.fileLocks = new Map();
    this.agentFiles = new Map();
    this.conflictHistory = [];
  }

  /**
   * Register that an agent is working on specific files
   */
  registerFileActivity(
    agentId: string,
    taskId: string,
    files: string[],
    branch: string
  ): ConflictEvent[] {
    const conflicts: ConflictEvent[] = [];

    // Get or create agent's file set
    if (!this.agentFiles.has(agentId)) {
      this.agentFiles.set(agentId, new Set());
    }
    const agentFileSet = this.agentFiles.get(agentId)!;

    for (const file of files) {
      // Check if another agent is working on this file
      const existingLock = this.fileLocks.get(file);

      if (existingLock && existingLock.agentId !== agentId) {
        // Potential conflict detected!
        const conflictEvent: ConflictEvent = {
          type: 'potential',
          files: [file],
          agents: [existingLock.agentId, agentId],
          severity: this.assessConflictSeverity(file, existingLock.branch, branch),
          recommendation: this.generateRecommendation(file, existingLock, agentId),
        };

        conflicts.push(conflictEvent);
        this.emit('conflict:potential', conflictEvent);

        // Track in history
        this.conflictHistory.push({
          file,
          conflictingAgents: [existingLock.agentId, agentId],
          resolution: undefined,
        });
      }

      // Register the lock (or update existing)
      this.fileLocks.set(file, {
        file,
        agentId,
        taskId,
        lockedAt: new Date().toISOString(),
        branch,
      });

      agentFileSet.add(file);
    }

    return conflicts;
  }

  /**
   * Release file locks when agent completes or is terminated
   */
  releaseAgentLocks(agentId: string): void {
    const agentFileSet = this.agentFiles.get(agentId);
    if (!agentFileSet) return;

    for (const file of agentFileSet) {
      const lock = this.fileLocks.get(file);
      if (lock && lock.agentId === agentId) {
        this.fileLocks.delete(file);
      }
    }

    this.agentFiles.delete(agentId);
    this.emit('agent:released', { agentId, fileCount: agentFileSet.size });
  }

  /**
   * Check if assigning a task to an agent would cause conflicts
   */
  async checkTaskAssignment(
    task: AgentTask,
    candidateAgentId: string
  ): Promise<{ safe: boolean; potentialConflicts: string[] }> {
    const potentialConflicts: string[] = [];

    for (const file of task.context.files) {
      const lock = this.fileLocks.get(file);
      if (lock && lock.agentId !== candidateAgentId) {
        potentialConflicts.push(file);
      }
    }

    return {
      safe: potentialConflicts.length === 0,
      potentialConflicts,
    };
  }

  /**
   * Get all active file locks
   */
  getActiveLocks(): FileLock[] {
    return Array.from(this.fileLocks.values());
  }

  /**
   * Get locks held by a specific agent
   */
  getAgentLocks(agentId: string): FileLock[] {
    return Array.from(this.fileLocks.values()).filter((l) => l.agentId === agentId);
  }

  /**
   * Get conflict statistics
   */
  getConflictStats(): {
    totalPotential: number;
    byFile: Map<string, number>;
    byAgentPair: Map<string, number>;
  } {
    const byFile = new Map<string, number>();
    const byAgentPair = new Map<string, number>();

    for (const conflict of this.conflictHistory) {
      // Count by file
      byFile.set(conflict.file, (byFile.get(conflict.file) || 0) + 1);

      // Count by agent pair
      const pairKey = conflict.conflictingAgents.sort().join(':');
      byAgentPair.set(pairKey, (byAgentPair.get(pairKey) || 0) + 1);
    }

    return {
      totalPotential: this.conflictHistory.length,
      byFile,
      byAgentPair,
    };
  }

  /**
   * Assess how severe a potential conflict is
   */
  private assessConflictSeverity(
    file: string,
    branch1: string,
    branch2: string
  ): 'low' | 'medium' | 'high' {
    // Same branch = high severity
    if (branch1 === branch2) return 'high';

    // Critical files = high severity
    const criticalPatterns = [
      /package\.json$/,
      /package-lock\.json$/,
      /\.env/,
      /config\./,
      /schema\./,
      /migration/,
    ];

    if (criticalPatterns.some((p) => p.test(file))) {
      return 'high';
    }

    // Test files = low severity (usually independent)
    if (/\.(test|spec)\.[jt]sx?$/.test(file)) {
      return 'low';
    }

    return 'medium';
  }

  /**
   * Generate a recommendation for handling the conflict
   */
  private generateRecommendation(
    file: string,
    existingLock: FileLock,
    newAgentId: string
  ): string {
    const lockAge = Date.now() - new Date(existingLock.lockedAt).getTime();
    const lockAgeMinutes = Math.round(lockAge / 60000);

    if (lockAgeMinutes > 30) {
      return `Agent ${existingLock.agentId} has held lock for ${lockAgeMinutes}m. Consider checking agent status.`;
    }

    if (file.includes('index') || file.includes('main')) {
      return `High-traffic file. Consider sequential execution: let ${existingLock.agentId} complete first.`;
    }

    return `${newAgentId} should wait for ${existingLock.agentId} to complete changes to ${file}.`;
  }

  /**
   * Mark a conflict as resolved
   */
  resolveConflict(file: string, resolution: 'auto' | 'manual'): void {
    const conflict = this.conflictHistory.find(
      (c) => c.file === file && !c.resolution
    );

    if (conflict) {
      conflict.resolution = resolution;
      this.emit('conflict:resolved', { file, resolution });
    }
  }

  /**
   * Detect if agents are working on the same logical feature
   * (files in same directory or with similar names)
   */
  detectFeatureOverlap(agents: Agent[]): Map<string, string[]> {
    const featureToAgents = new Map<string, string[]>();

    for (const agent of agents) {
      const agentFiles = this.agentFiles.get(agent.id);
      if (!agentFiles) continue;

      for (const file of agentFiles) {
        // Extract feature identifier (directory path)
        const featureId = this.extractFeatureId(file);

        if (!featureToAgents.has(featureId)) {
          featureToAgents.set(featureId, []);
        }

        const agentsOnFeature = featureToAgents.get(featureId)!;
        if (!agentsOnFeature.includes(agent.id)) {
          agentsOnFeature.push(agent.id);
        }
      }
    }

    // Filter to only features with multiple agents
    const overlaps = new Map<string, string[]>();
    for (const [feature, agentIds] of featureToAgents) {
      if (agentIds.length > 1) {
        overlaps.set(feature, agentIds);
      }
    }

    return overlaps;
  }

  /**
   * Extract a feature identifier from a file path
   */
  private extractFeatureId(filePath: string): string {
    // Use parent directory as feature identifier
    const parts = filePath.split('/');
    if (parts.length >= 2) {
      return parts.slice(0, -1).join('/');
    }
    return 'root';
  }
}
