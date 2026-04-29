import { useQueryClient } from "@tanstack/react-query";
import {
  useRunAllocation as useGeneratedRunAllocation,
  useDryRunAllocation as useGeneratedDryRunAllocation,
  useAdjustAllocation as useGeneratedAdjustAllocation,
  useGetAllocations,
  useGetAllocationStats,
  getGetAllocationsQueryKey,
  getGetAllocationStatsQueryKey
} from "@workspace/api-client-react";

export { useGetAllocations, useGetAllocationStats };

export function useRunAllocation() {
  const queryClient = useQueryClient();
  return useGeneratedRunAllocation({
    mutation: {
      onSuccess: (_, variables) => {
        queryClient.invalidateQueries({ queryKey: getGetAllocationsQueryKey(variables.id) });
        queryClient.invalidateQueries({ queryKey: getGetAllocationStatsQueryKey(variables.id) });
      }
    }
  });
}

export function useDryRunAllocation() {
  return useGeneratedDryRunAllocation();
}

export function useAdjustAllocation() {
  const queryClient = useQueryClient();
  return useGeneratedAdjustAllocation({
    mutation: {
      onSuccess: (_, variables) => {
        queryClient.invalidateQueries({ queryKey: getGetAllocationsQueryKey(variables.id) });
        queryClient.invalidateQueries({ queryKey: getGetAllocationStatsQueryKey(variables.id) });
      }
    }
  });
}
