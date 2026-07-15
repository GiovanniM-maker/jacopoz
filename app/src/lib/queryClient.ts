import { QueryClient } from "@tanstack/react-query";

// One client for the app. Reasonable defaults for a social read-heavy app:
// cache aggressively, refetch on reconnect, don't spam retries.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000, // 1 min — feed/dashboard don't need to be realtime
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
});
