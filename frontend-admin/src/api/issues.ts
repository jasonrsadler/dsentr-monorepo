import { adminGet, adminPost, PaginatedResponse } from './client';
import { IssueDetail, IssueMessage, IssueSummary } from './types';

export interface IssueListParams {
  page?: number;
  limit?: number;
  search?: string;
  sort_by?: 'created_at' | 'updated_at';
  order?: 'asc' | 'desc';
}

export function listIssues(params: IssueListParams): Promise<PaginatedResponse<IssueSummary>> {
  const searchParams = new URLSearchParams();
  if (params.page) searchParams.set('page', params.page.toString());
  if (params.limit) searchParams.set('limit', params.limit.toString());
  if (params.search) searchParams.set('search', params.search);
  if (params.sort_by) searchParams.set('sort_by', params.sort_by);
  if (params.order) searchParams.set('order', params.order);
  return adminGet('/issues', searchParams);
}

export function getIssue(issueId: string): Promise<IssueDetail> {
  return adminGet(`/issues/${issueId}`);
}

export function replyToIssue(issueId: string, message: string): Promise<IssueMessage[]> {
  return adminPost(`/issues/${issueId}/reply`, { message });
}
