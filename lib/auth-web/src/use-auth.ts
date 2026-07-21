import { useState, useEffect, useCallback } from "react";
import type { AuthUser } from "@workspace/api-client-react";

export type { AuthUser };

/** "unreachable" = we never got an authoritative answer about the session
 * (fetch rejected, or the server 5xx'd — Render cold starts included).
 * Consumers may apply offline grace on it; a real 401/logged-out answer
 * always reports failure: null with user: null. */
export type AuthFailure = "unreachable" | null;

interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  failure: AuthFailure;
  login: () => void;
  logout: () => void;
}

export function useAuth(): AuthState {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [failure, setFailure] = useState<AuthFailure>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    // 10s cap: a captive portal that blackholes the request must resolve into
    // "unreachable" (the catch below maps the abort) so consumers can apply
    // offline grace, instead of holding the auth gate at loading indefinitely.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);

    fetch("/api/auth/user", { credentials: "include", signal: controller.signal })
      .then(async (res) => {
        if (res.ok) {
          const data = (await res.json()) as { user: AuthUser | null };
          return { user: data.user ?? null, failure: null as AuthFailure };
        }
        // 5xx is not an answer about the session; anything else is a "no".
        return { user: null, failure: (res.status >= 500 ? "unreachable" : null) as AuthFailure };
      })
      .catch(() => ({ user: null, failure: "unreachable" as AuthFailure }))
      .then((result) => {
        clearTimeout(timer);
        if (!cancelled) {
          setUser(result.user);
          setFailure(result.failure);
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  const login = useCallback(() => {
    const base = import.meta.env.BASE_URL.replace(/\/+$/, "") || "/";
    window.location.href = `/api/login?returnTo=${encodeURIComponent(base)}`;
  }, []);

  const logout = useCallback(() => {
    const form = document.createElement("form");
    form.method = "POST";
    form.action = "/api/logout";
    document.body.appendChild(form);
    form.submit();
  }, []);

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    failure,
    login,
    logout,
  };
}
