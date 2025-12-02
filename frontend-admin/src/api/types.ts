export type ConnectedOAuthProvider = "google" | "microsoft" | "slack";

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export interface SessionUser {
  id: string;
  email: string;
  role?: "admin" | "user";
  plan?: string | null;
  first_name?: string;
  last_name?: string;
}

export interface AdminUser {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  plan?: string | null;
  is_verified: boolean;
  is_admin: boolean;
  created_at: string;
  updated_at: string;
}

export interface AdminUserDetail extends AdminUser {
  role?: "admin" | "user";
  company_name?: string | null;
  settings: any;
  onboarded_at?: string | null;
}

export interface ConnectionSummary {
  id: string;
  provider: ConnectedOAuthProvider;
  account_email: string;
  workspace_id?: string | null;
  owner_user_id: string;
  scope: "personal" | "workspace" | string;
  updated_at: string;
}

export interface Workspace {
  id: string;
  name: string;
  created_by: string;
  owner_id: string;
  plan: string;
  stripe_overage_item_id?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  plan: string;
  owner_id: string;
  owner_email?: string | null;
  member_count: number;
  run_count: number;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceInvite {
  id: string;
  workspace_id: string;
  email: string;
  role: string;
  status: string;
  expires_at: string;
  created_at: string;
  accepted_at?: string | null;
  revoked_at?: string | null;
  declined_at?: string | null;
}

export interface WorkspaceConnectionListing {
  id: string;
  workspace_id: string;
  owner_user_id: string;
  workspace_name: string;
  provider: ConnectedOAuthProvider;
  account_email: string;
  expires_at: string;
  shared_by_first_name?: string | null;
  shared_by_last_name?: string | null;
  shared_by_email?: string | null;
  updated_at: string;
  requires_reconnect: boolean;
}

export interface WorkspaceMember {
  workspace_id: string;
  user_id: string;
  role: string;
  joined_at: string;
  email: string;
  first_name: string;
  last_name: string;
}

export interface WorkspaceMembershipSummary {
  workspace: Workspace;
  role: string;
}

export interface WorkflowSummary {
  id: string;
  workspace_id?: string | null;
  name: string;
  run_count: number;
  updated_at: string;
}

export interface RunSummary {
  id: string;
  workflow_id: string;
  status: string;
  started_at?: string | null;
  finished_at?: string | null;
  created_at: string;
}

export interface WorkflowDetail {
  id: string;
  workspace_id?: string | null;
  name: string;
  updated_at: string;
  run_count: number;
  runs: RunSummary[];
}

export interface IssueSummary {
  id: string;
  user_id: string;
  workspace_id?: string | null;
  status: string;
  user_email: string;
  unread_user_messages: number;
  last_message_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface IssueMessage {
  id: string;
  issue_id: string;
  sender_id?: string | null;
  sender_type: string;
  body: string;
  created_at: string;
  read_by_user_at?: string | null;
  read_by_admin_at?: string | null;
}

export interface IssueReport {
  id: string;
  user_id: string;
  workspace_id?: string | null;
  user_email: string;
  user_name: string;
  user_plan?: string | null;
  user_role?: string | null;
  workspace_plan?: string | null;
  workspace_role?: string | null;
  description: string;
  metadata: any;
  created_at: string;
  status: string;
  updated_at: string;
}

export interface IssueDetail {
  issue: IssueReport;
  messages: IssueMessage[];
  unread_user_messages: number;
}

export interface WorkspaceDetailResponse {
  workspace: Workspace;
  invites: WorkspaceInvite[];
  connections: WorkspaceConnectionListing[];
  workflows: {
    id: string;
    workspace_id?: string | null;
    name: string;
    updated_at: string;
    run_count?: number;
  }[];
  issues: IssueSummary[];
  quotas: {
    member_limit: number;
    run_limit: number;
  };
}
