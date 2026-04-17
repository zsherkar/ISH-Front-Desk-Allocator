import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export type AdminSession = {
  authenticated: true;
  admin: {
    email: string;
    name: string;
  };
};

export class AuthApiError extends Error {
  status: number;
  data: unknown;

  constructor(status: number, data: unknown) {
    super(
      typeof data === "object" &&
        data !== null &&
        "error" in data &&
        typeof data.error === "string"
        ? data.error
        : `Request failed with status ${status}`,
    );
    this.status = status;
    this.data = data;
  }
}

async function readJsonOrNull(response: Response) {
  const text = await response.text();
  if (!text.trim()) return null;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function authFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      "cache-control": "no-cache",
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });

  const data = await readJsonOrNull(response);
  if (!response.ok) {
    throw new AuthApiError(response.status, data);
  }

  return data as T;
}

export function useAdminSession() {
  return useQuery({
    queryKey: ["admin-session"],
    retry: false,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    queryFn: () => authFetch<AdminSession>("/api/auth/session"),
  });
}

export function useAdminLogin() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { email: string; password: string }) =>
      authFetch<AdminSession>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(["admin-session"], data);
    },
  });
}

export function useAdminLogout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      await authFetch<null>("/api/auth/logout", {
        method: "POST",
      });
      return null;
    },
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ["admin-session"] });
    },
  });
}
