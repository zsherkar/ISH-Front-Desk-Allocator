import {
  getGetPublicSurveyQueryKey,
  useGetPublicSurvey as useGeneratedGetPublicSurvey,
  useSubmitResponse as useGeneratedSubmitResponse
} from "@workspace/api-client-react";

export function useGetPublicSurvey(surveyToken: string) {
  return useGeneratedGetPublicSurvey(surveyToken, {
    query: {
      queryKey: getGetPublicSurveyQueryKey(surveyToken),
      retry: false,
      staleTime: 0,
      refetchOnMount: "always",
      refetchOnWindowFocus: true,
    },
    request: {
      cache: "no-store",
      headers: {
        "cache-control": "no-cache",
      },
    },
  });
}

export function useSubmitResponse() {
  return useGeneratedSubmitResponse();
}
