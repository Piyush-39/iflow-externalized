import { apiRequest } from "./client";
import type { AnalysisResponse, SapStatus } from "../models/externalization";

export interface IFlowRequest {
  tenantUrl?: string;
  iflowId: string;
  version: string;
}

export const iflowApi = {
  status: () => apiRequest<SapStatus>("/api/sap/status"),
  analyze: (body: IFlowRequest) => apiRequest<AnalysisResponse>("/api/iflow/analyze", {
    method: "POST", body: JSON.stringify(body)
  }),
  dryRun: (body: IFlowRequest & { selectedParameters: string[] }) =>
    apiRequest<AnalysisResponse>("/api/iflow/dry-run", { method: "POST", body: JSON.stringify(body) }),
  externalize: (body: IFlowRequest & { selectedParameters: string[] }) =>
    apiRequest<AnalysisResponse>("/api/iflow/externalize", {
      method: "POST", body: JSON.stringify({ ...body, validate: true })
    })
};
