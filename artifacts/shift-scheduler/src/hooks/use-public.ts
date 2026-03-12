import {
  useGetPublicSurvey,
  useSubmitResponse as useGeneratedSubmitResponse
} from "@workspace/api-client-react";

export { useGetPublicSurvey };

export function useSubmitResponse() {
  return useGeneratedSubmitResponse();
}
