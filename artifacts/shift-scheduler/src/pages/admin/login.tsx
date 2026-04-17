import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { AlertCircle, LockKeyhole, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AuthApiError, useAdminLogin, useAdminSession } from "@/hooks/use-auth";

function getNextPath() {
  if (typeof window === "undefined") return "/admin/surveys";
  const params = new URLSearchParams(window.location.search);
  const next = params.get("next");
  return next && next.startsWith("/admin") ? next : "/admin/surveys";
}

export function AdminLoginPage() {
  const [, setLocation] = useLocation();
  const nextPath = useMemo(() => getNextPath(), []);
  const { data: session, isLoading, error } = useAdminSession();
  const loginMutation = useAdminLogin();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (session?.authenticated) {
      setLocation(nextPath);
    }
  }, [nextPath, session, setLocation]);

  const sessionError =
    error instanceof AuthApiError && error.status !== 401 ? error.message : null;
  const submitError =
    loginMutation.error instanceof AuthApiError ? loginMutation.error.message : null;

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-sm text-slate-500">Checking admin access...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary text-white">
            <LockKeyhole className="h-6 w-6" />
          </div>
          <h1 className="font-display text-3xl font-bold text-slate-900">
            Admin Login
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Sign in to manage surveys, respondents, and allocations.
          </p>
        </div>

        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              await loginMutation.mutateAsync({
                email: email.trim(),
                password,
              });
              setLocation(nextPath);
            } catch {
              // The mutation error is rendered in the form.
            }
          }}
        >
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700">Email</label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                autoComplete="email"
                className="pl-9"
                required
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700">Password</label>
            <Input
              autoComplete="current-password"
              required
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>

          {(sessionError || submitError) && (
            <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{submitError ?? sessionError}</span>
            </div>
          )}

          <Button
            className="h-11 w-full"
            disabled={loginMutation.isPending}
            type="submit"
          >
            {loginMutation.isPending ? "Signing in..." : "Log In"}
          </Button>
        </form>
      </div>
    </div>
  );
}
