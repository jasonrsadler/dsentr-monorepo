import { create } from "zustand";
import {
  ApiError,
  fetchSession,
  login as loginApi,
  logout as logoutApi,
} from "../api/client";
import { SessionUser } from "../api/types";

interface AuthState {
  user: SessionUser | null;
  loading: boolean;
  error?: string;
  bootstrap: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: false,
  error: undefined,
  bootstrap: async () => {
    set({ loading: true, error: undefined });
    try {
      const session = await fetchSession();
      const normalizedRole = session.role?.toLowerCase();
      if (normalizedRole !== "admin") {
        set({
          user: null,
          error: "Access denied. Admins only.",
          loading: false,
        });
        await logoutApi().catch(() => {});
        return;
      }
      set({ user: session, loading: false, error: undefined });
    } catch (error) {
      const apiError = error as ApiError;
      const message = apiError?.status === 403 ? apiError.message : undefined;
      set({ user: null, loading: false, error: message });
    }
  },
  login: async (email, password) => {
    set({ loading: true, error: undefined });
    try {
      await loginApi(email, password);
      const session = await fetchSession();
      const normalizedRole = session.role?.toLowerCase();
      if (normalizedRole !== "admin") {
        const err = new ApiError("Not an admin", 403);
        set({ user: null, loading: false, error: err.message });
        await logoutApi().catch(() => {});
        throw err;
      }
      set({ user: session, loading: false, error: undefined });
    } catch (error) {
      const message =
        error instanceof ApiError ? error.message : "Login failed";
      set({ loading: false, error: message });
      throw error;
    }
  },
  logout: async () => {
    await logoutApi().catch(() => {});
    set({ user: null, error: undefined });
  },
}));
