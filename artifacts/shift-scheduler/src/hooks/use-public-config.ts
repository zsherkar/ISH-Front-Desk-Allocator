import { useQuery } from "@tanstack/react-query";

type PublicConfig = {
  publicAppUrl: string | null;
};

async function fetchPublicConfig(): Promise<PublicConfig> {
  const response = await fetch("/api/public-config", {
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      "cache-control": "no-cache",
    },
  });

  if (!response.ok) {
    throw new Error("Unable to load public app configuration.");
  }

  return response.json() as Promise<PublicConfig>;
}

export function usePublicConfig() {
  return useQuery({
    queryKey: ["public-config"],
    staleTime: 60_000,
    queryFn: fetchPublicConfig,
  });
}
