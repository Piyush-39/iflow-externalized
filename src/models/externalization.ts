export type Direction = "sender" | "receiver" | "step";
export type ExternalizationSourceType = "adapter" | "content-modifier";
export type ContentModifierSection = "header" | "property" | "body";
export type SkipReason =
  | "empty"
  | "already-externalized"
  | "dynamic-expression"
  | "unsupported-type"
  | "unsupported-value"
  | "body-disabled"
  | "body-too-large"
  | "malformed-table";

export interface ExistingParameter {
  name: string;
  value?: string;
  location?: string;
}

export interface ExternalizationRule {
  adapterType: string;
  aliases: string[];
  propertyNames: string[];
  sensitive?: boolean;
  dataType?: `xsd:${string}`;
}

export interface ExternalizedParameter {
  parameterName: string;
  originalValue: string;
  sourceType: ExternalizationSourceType;
  adapterType?: string;
  componentName?: string;
  componentId?: string;
  propertyName: string;
  direction?: Direction;
  alreadyExternalized: boolean;
  sensitive: boolean;
  section?: ContentModifierSection;
  applied?: boolean;
  dataType?: `xsd:${string}`;
  attributeCategory?: string;
  attributeId?: string;
  attributeUiLabel?: string;
}

export interface SkippedExternalization {
  sourceType: ExternalizationSourceType;
  componentName?: string;
  componentId?: string;
  adapterType?: string;
  propertyName: string;
  section?: ContentModifierSection;
  valueType?: string;
  reason: SkipReason;
  sensitive: boolean;
}

export interface ExternalizationResult {
  modifiedXml: string;
  parameters: ExternalizedParameter[];
  existingParameters: ExistingParameter[];
  changed: boolean;
  detectedComponents: number;
  externalizableProperties: number;
  skipped: SkippedExternalization[];
}

export interface ArtifactExternalizationResult extends ExternalizationResult {
  parametersProperties: string;
  parametersDefinitionXml: string;
}

export interface ArtifactMetadata {
  Id: string;
  Name: string;
  Version: string;
  PackageId?: string;
}

export interface SapConfiguration {
  ParameterKey: string;
  ParameterValue?: string;
  DataType?: string;
}

export interface SapValidationError {
  severity?: string;
  message: string;
  sourceObject?: string;
  resourcePath?: string;
  resourceName?: string;
}

export interface SapValidationResult {
  passed: boolean;
  raw: unknown;
  errors: SapValidationError[];
}

export interface ExternalizationReport {
  iflowId: string;
  iflowName: string;
  version: string;
  generatedAt: string;
  dryRun: boolean;
  detectedComponents: number;
  externalizableProperties: number;
  alreadyExternalized: number;
  newExternalizedParameters: number;
  adapterParameters: number;
  contentModifierParameters: number;
  skippedDynamicExpressions: number;
  skippedUnsupportedProperties: number;
  parameters: ExternalizedParameter[];
  skipped: SkippedExternalization[];
}
