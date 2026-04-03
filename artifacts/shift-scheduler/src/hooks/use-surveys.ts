import { useQueryClient } from "@tanstack/react-query";
import { useMutation } from "@tanstack/react-query";
import { 
  useCreateSurvey as useGeneratedCreateSurvey,
  useUpdateSurvey as useGeneratedUpdateSurvey,
  getListSurveysQueryKey,
  getGetSurveyQueryKey,
  useListSurveys,
  useGetSurvey,
  useGetSurveyResponses,
  useGetSurveyStats,
  CreateSurveyBody,
  UpdateSurveyBody
} from "@workspace/api-client-react";

export { 
  useListSurveys, 
  useGetSurvey, 
  useGetSurveyResponses, 
  useGetSurveyStats 
};

export function useCreateSurvey() {
  const queryClient = useQueryClient();
  return useGeneratedCreateSurvey({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListSurveysQueryKey() });
      }
    }
  });
}

export function useUpdateSurvey() {
  const queryClient = useQueryClient();
  return useGeneratedUpdateSurvey({
    mutation: {
      onSuccess: (data, variables) => {
        queryClient.invalidateQueries({ queryKey: getListSurveysQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetSurveyQueryKey(variables.id) });
      }
    }
  });
}

export function useDeleteSurvey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const response = await fetch(`/api/surveys/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Failed to delete survey");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getListSurveysQueryKey() });
    },
  });
}

export function useDeleteSurveyResponse() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ surveyId, respondentId }: { surveyId: number; respondentId: number }) => {
      const response = await fetch(`/api/surveys/${surveyId}/responses/${respondentId}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Failed to delete response");
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: getGetSurveyQueryKey(variables.surveyId) });
      queryClient.invalidateQueries({ queryKey: ["getSurveyResponses", variables.surveyId] });
    },
  });
}
