import { adminGet, PaginatedResponse } from "./client";
import {
  IssueSummary,
  WorkspaceDetailResponse,
  WorkspaceMember,
  WorkspaceSummary,
  WorkflowSummary,
} from "./types";

export interface WorkspaceListParams {
  page?: number;
  limit?: number;
  search?: string;
  sort_by?: "created_at" | "updated_at";
  order?: "asc" | "desc";
}

export function listWorkspaces(
  params: WorkspaceListParams,
): Promise<PaginatedResponse<WorkspaceSummary>> {
  const searchParams = new URLSearchParams();
  if (params.page) searchParams.set("page", params.page.toString());
  if (params.limit) searchParams.set("limit", params.limit.toString());
  if (params.search) searchParams.set("search", params.search);
  if (params.sort_by) searchParams.set("sort_by", params.sort_by);
  if (params.order) searchParams.set("order", params.order);
  return adminGet("/workspaces", searchParams);
}

export function getWorkspace(
  workspaceId: string,
): Promise<WorkspaceDetailResponse> {
  return adminGet(`/workspaces/${workspaceId}`);
}

export function getWorkspaceMembers(
  workspaceId: string,
): Promise<WorkspaceMember[]> {
  return adminGet(`/workspaces/${workspaceId}/members`);
}

export function getWorkspaceWorkflows(
  workspaceId: string,
): Promise<WorkflowSummary[]> {
  return adminGet(`/workspaces/${workspaceId}/workflows`);
}

export function getWorkspaceIssues(
  workspaceId: string,
): Promise<IssueSummary[]> {
  return adminGet(`/workspaces/${workspaceId}/issues`);
}
