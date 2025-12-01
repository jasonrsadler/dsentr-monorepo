import { SessionUser } from "./types";

export class ApiError extends Error {
  status: number;
  data?: unknown;

  constructor(message: string, status: number, data?: unknown) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/+$/, "");
const ADMIN_BASE_PATH = "/api/admin";
const AUTH_BASE_PATH = "/api/auth";

type RequestOptions = RequestInit & { skipJson?: boolean; basePath?: string };

async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { skipJson, basePath, headers, ...rest } = options;
  const resolvedBase = basePath ?? ADMIN_BASE_PATH;
  const url = `${API_BASE}${resolvedBase}${path}`;
  const response = await fetch(url, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(headers || {}),
    },
    ...rest,
  });

  if (response.status === 401) {
    // Session expired -> login
    window.location.href = "/login";
    throw new ApiError("Unauthorized", 401);
  }

  if (response.status === 403) {
    throw new ApiError(
      "Access denied. Admins only.",
      403,
      await safeJson(response),
    );
  }

  if (!response.ok) {
    const data = await safeJson(response);
    throw new ApiError(
      (data as { message?: string })?.message ?? "Request failed",
      response.status,
      data,
    );
  }

  if (skipJson) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (_) {
    return undefined;
  }
}

export function adminGet<T>(
  path: string,
  params?: URLSearchParams,
): Promise<T> {
  const url = params ? `${path}?${params.toString()}` : path;
  return request<T>(url);
}

export function adminPost<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    body: body ? JSON.stringify(body) : undefined,
  });
}

export function authGet<T>(path: string): Promise<T> {
  return request<T>(path, { basePath: AUTH_BASE_PATH });
}

export function authPost<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    basePath: AUTH_BASE_PATH,
    method: "POST",
    body: body ? JSON.stringify(body) : undefined,
  });
}

export function authDelete<T>(path: string): Promise<T> {
  return request<T>(path, { basePath: AUTH_BASE_PATH, method: "DELETE" });
}

export async function fetchSession(): Promise<SessionUser> {
  return authGet<SessionUser>("/me");
}

export async function login(email: string, password: string): Promise<void> {
  await authPost("/login", { email, password });
}

export async function logout(): Promise<void> {
  await authPost("/logout");
}

export type { PaginatedResponse } from "./types";
