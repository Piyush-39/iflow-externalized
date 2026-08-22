export type ExternalizationSourceType = "adapter" | "content-modifier";
export type ContentModifierSection = "header" | "property" | "body";
export type ParameterStatus = "new" | "existing" | "skipped";

export interface ExternalizationParameterView {
  parameterName: string;
  sourceType: ExternalizationSourceType;
  adapterType?: string;
  componentName?: string;
  componentId?: string;
  propertyName: string;
  section?: ContentModifierSection;
  originalValue?: string;
  sensitive: boolean;
  alreadyExternalized: boolean;
  applied?: boolean;
  status: "new" | "existing";
}

export interface SkippedParameterView {
  sourceType: ExternalizationSourceType;
  adapterType?: string;
  componentName?: string;
  componentId?: string;
  propertyName: string;
  section?: ContentModifierSection;
  valueType?: string;
  reason: string;
  sensitive: boolean;
  status: "skipped";
}

export interface AnalysisSummaryView {
  components: number;
  externalizable: number;
  alreadyExternalized: number;
  skipped: number;
  adapterParameters: number;
  contentModifierParameters: number;
  skippedDynamicExpressions: number;
}

export interface AnalysisResponse {
  iflow: { id: string; name: string; version: string };
  summary: AnalysisSummaryView;
  parameters: ExternalizationParameterView[];
  skipped: SkippedParameterView[];
  outcome?: OperationOutcome;
}

export interface OperationOutcome {
  uploaded: boolean;
  deployed: boolean;
  backupCreated: boolean;
  backupFile: string;
  outputZipFile: string;
  reportFile?: string;
  localValidation: "passed";
  sapValidation: "passed" | "not-run";
  configurationVerification: "passed" | "not-run";
}

export interface SapStatus {
  configured: boolean;
  tenantUrl: string;
  credentials: "server-managed";
  updateEnabled: boolean;
  durableStorage: "private-blob" | "local" | "not-configured";
}

export type ParameterFilter = "all" | "adapter" | "content-modifier" | "existing" | "new" | "skipped";
