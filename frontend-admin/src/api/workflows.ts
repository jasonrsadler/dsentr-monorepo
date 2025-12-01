import { adminGet, PaginatedResponse } from './client';
import { RunSummary, WorkflowDetail, WorkflowSummary } from './types';

export interface WorkflowListParams {
  page?: number;
  limit?: number;
  search?: string;
  sort_by?: 'created_at' | 'updated_at';
  order?: 'asc' | 'desc';
}

export function listWorkflows(
  params: WorkflowListParams,
): Promise<PaginatedResponse<WorkflowSummary>> {
  const searchParams = new URLSearchParams();
  if (params.page) searchParams.set('page', params.page.toString());
  if (params.limit) searchParams.set('limit', params.limit.toString());
  if (params.search) searchParams.set('search', params.search);
  if (params.sort_by) searchParams.set('sort_by', params.sort_by);
  if (params.order) searchParams.set('order', params.order);
  return adminGet('/workflows', searchParams);
}

export function getWorkflow(workflowId: string): Promise<WorkflowDetail> {
  return adminGet(`/workflows/${workflowId}`);
}

export function getWorkflowRuns(workflowId: string): Promise<RunSummary[]> {
  return adminGet(`/workflows/${workflowId}/runs`);
}

export function getWorkflowJson(workflowId: string): Promise<unknown> {
  return adminGet(`/workflows/${workflowId}/json`);
}
