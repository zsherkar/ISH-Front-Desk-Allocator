import { useQueryClient } from "@tanstack/react-query";
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
