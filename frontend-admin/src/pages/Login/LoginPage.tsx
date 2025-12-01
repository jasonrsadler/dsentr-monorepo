import { FormEvent, useState } from "react";
import { Location, useLocation, useNavigate } from "react-router-dom";
import { ApiError } from "../../api/client";
import { useAuthStore } from "../../stores/authStore";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [localError, setLocalError] = useState<string | undefined>();
  const { login, error, loading } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();

  const from = (location.state as { from?: Location })?.from?.pathname ?? "/";

  async function onSubmit(evt: FormEvent) {
    evt.preventDefault();
    setLocalError(undefined);
    try {
      await login(email, password);
      navigate(from, { replace: true });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Login failed";
      setLocalError(msg);
    }
  }

  const notAdmin = error === "Not an admin";

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/80 p-8 shadow-2xl">
        <div className="mb-6 text-center">
          <div className="text-xs uppercase tracking-wide text-accent">
            Dsentr Admin
          </div>
          <h1 className="text-2xl font-bold text-slate-100">Sign in</h1>
          <p className="text-sm text-slate-400">
            Admin-only access. You will be redirected if not authorized.
          </p>
        </div>
        {notAdmin && (
          <div className="mb-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            Not an admin. Use an admin account to continue.
          </div>
        )}
        {localError && (
          <div className="mb-3 rounded-lg border border-orange-500/40 bg-orange-500/10 px-3 py-2 text-sm text-orange-200">
            {localError}
          </div>
        )}
        <form className="space-y-4" onSubmit={onSubmit}>
          <label className="block text-sm font-semibold text-slate-200">
            Email
            <input
              type="email"
              required
              className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-slate-100 focus:border-accent focus:outline-none"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="block text-sm font-semibold text-slate-200">
            Password
            <input
              type="password"
              required
              className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-slate-100 focus:border-accent focus:outline-none"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button
            className="btn w-full justify-center"
            disabled={loading}
            type="submit"
          >
            {loading ? "Signing in..." : "Login"}
          </button>
        </form>
      </div>
    </div>
  );
}
