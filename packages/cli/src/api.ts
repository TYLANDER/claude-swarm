import type {
  SubmitTaskRequest,
  SubmitTaskResponse,
  TaskStatusResponse,
  AgentListResponse,
  BudgetResponse,
} from '@claude-swarm/types';
import { getConfig } from './config.js';

class ApiClient {
  private baseUrl: string;

  constructor() {
    this.baseUrl = getConfig().orchestratorUrl;
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText })) as { error?: string };
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    return response.json() as Promise<T>;
  }

  async submitTasks(request: SubmitTaskRequest): Promise<SubmitTaskResponse> {
    return this.request<SubmitTaskResponse>('/api/tasks', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  async getTaskStatus(taskId: string): Promise<TaskStatusResponse> {
    return this.request<TaskStatusResponse>(`/api/tasks/${taskId}`);
  }

  async cancelTask(taskId: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/api/tasks/${taskId}/cancel`, {
      method: 'POST',
    });
  }

  async listAgents(): Promise<AgentListResponse> {
    return this.request<AgentListResponse>('/api/agents');
  }

  async getBudget(): Promise<BudgetResponse> {
    return this.request<BudgetResponse>('/api/budget');
  }

  async healthCheck(): Promise<{ status: string; timestamp: string }> {
    return this.request<{ status: string; timestamp: string }>('/health');
  }
}

export const api = new ApiClient();
