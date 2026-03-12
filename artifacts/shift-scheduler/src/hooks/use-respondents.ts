import { useQueryClient } from "@tanstack/react-query";
import {
  useListRespondents,
  useCreateRespondent as useGeneratedCreateRespondent,
  useUpdateRespondent as useGeneratedUpdateRespondent,
  useDeleteRespondent as useGeneratedDeleteRespondent,
  getListRespondentsQueryKey
} from "@workspace/api-client-react";

export { useListRespondents };

export function useCreateRespondent() {
  const queryClient = useQueryClient();
  return useGeneratedCreateRespondent({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListRespondentsQueryKey() });
      }
    }
  });
}

export function useUpdateRespondent() {
  const queryClient = useQueryClient();
  return useGeneratedUpdateRespondent({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListRespondentsQueryKey() });
      }
    }
  });
}

export function useDeleteRespondent() {
  const queryClient = useQueryClient();
  return useGeneratedDeleteRespondent({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListRespondentsQueryKey() });
      }
    }
  });
}
