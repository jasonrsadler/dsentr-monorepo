import { adminGet, PaginatedResponse } from "./client";
import {
  AdminUser,
  AdminUserDetail,
  ConnectionSummary,
  WorkspaceMembershipSummary,
} from "./types";

export interface UserListParams {
  page?: number;
  limit?: number;
  search?: string;
  sort_by?: "created_at" | "updated_at";
  order?: "asc" | "desc";
}

export async function listUsers(
  params: UserListParams,
): Promise<PaginatedResponse<AdminUser>> {
  const searchParams = new URLSearchParams();
  if (params.page) searchParams.set("page", params.page.toString());
  if (params.limit) searchParams.set("limit", params.limit.toString());
  if (params.search) searchParams.set("search", params.search);
  if (params.sort_by) searchParams.set("sort_by", params.sort_by);
  if (params.order) searchParams.set("order", params.order);
  return adminGet("/users", searchParams);
}

export async function getUser(id: string): Promise<AdminUserDetail> {
  return adminGet(`/users/${id}`);
}

export async function getUserWorkspaces(
  userId: string,
): Promise<WorkspaceMembershipSummary[]> {
  return adminGet(`/users/${userId}/workspaces`);
}

export async function getUserConnections(
  userId: string,
): Promise<ConnectionSummary[]> {
  return adminGet(`/users/${userId}/connections`);
}
