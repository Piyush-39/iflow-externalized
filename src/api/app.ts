import express, { type NextFunction, type Request, type Response } from "express";
import os from "node:os";
import path from "node:path";
import type { AppConfig, ServerConfig } from "../config/env.js";
import { loadServerConfig } from "../config/env.js";
import type {
  ArtifactExternalizationResult,
  ExternalizedParameter,
  SapConfiguration,
  SkippedExternalization
} from "../models/externalization.js";
import { SapAuthService } from "../services/sapAuthService.js";
import type { ArtifactArchive } from "../services/artifactArchiveService.js";
import { VercelBlobArtifactArchive } from "../services/artifactArchiveService.js";
import { analyzeIFlow } from "../services/iflowAnalysisService.js";
import { SapApiError, SapIntegrationService, type SapIntegrationClient } from "../services/sapIntegrationService.js";
import { runExternalization, SapArtifactValidationError, type WorkflowResult } from "../services/workflowService.js";
import type { Logger } from "../utils/logger.js";
import { logger } from "../utils/logger.js";

interface ApiDependencies {
  config?: ServerConfig;
  sap?: SapIntegrationClient;
  projectRoot?: string;
  log?: Logger;
  artifactArchive?: ArtifactArchive;
  workspaceMode?: "local" | "ephemeral";
}

interface IFlowRequestBody {
  tenantUrl?: string;
  iflowId?: string;
  version?: string;
  selectedParameters?: unknown;
  validate?: boolean;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new ApiInputError(`${field} is required`);
  return value.trim();
}

function selectedParameters(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new ApiInputError("selectedParameters must be an array of parameter names");
  }
  return [...new Set(value.map((item) => String(item).trim()))];
}

function assertTenant(value: unknown, configured: string): void {
  if (value === undefined || value === "") return;
  let supplied: string;
  try {
    supplied = new URL(requiredString(value, "tenantUrl")).toString().replace(/\/$/, "");
  } catch {
    throw new ApiInputError("tenantUrl must be a valid absolute URL");
  }
  if (supplied !== configured) {
    throw new ApiInputError("This server is configured for a different SAP tenant URL");
  }
}

class ApiInputError extends Error {}
class ApiAccessError extends Error {}

function safeParameter(parameter: ExternalizedParameter): Record<string, unknown> {
  const { originalValue, attributeCategory: _category, attributeId: _id, ...safe } = parameter;
  return {
    ...safe,
    status: parameter.alreadyExternalized ? "existing" : "new",
    ...(parameter.sensitive ? {} : { originalValue })
  };
}

function safeSkipped(item: SkippedExternalization): Record<string, unknown> {
  return { ...item, status: "skipped" };
}

function summary(result: ArtifactExternalizationResult): Record<string, number> {
  return {
    components: result.detectedComponents,
    externalizable: result.externalizableProperties,
    alreadyExternalized: result.parameters.filter((item) => item.alreadyExternalized).length,
    skipped: result.skipped.length,
    adapterParameters: result.parameters.filter((item) => item.sourceType === "adapter").length,
    contentModifierParameters: result.parameters.filter((item) => item.sourceType === "content-modifier").length,
    skippedDynamicExpressions: result.skipped.filter((item) => item.reason === "dynamic-expression").length
  };
}

function analysisResponse(
  id: string,
  version: string,
  name: string,
  result: ArtifactExternalizationResult
): Record<string, unknown> {
  return {
    iflow: { id, name, version },
    summary: summary(result),
    parameters: result.parameters.map(safeParameter),
    skipped: result.skipped.map(safeSkipped)
  };
}

function workflowResponse(id: string, version: string, workflow: WorkflowResult): Record<string, unknown> {
  return {
    ...analysisResponse(id, version, workflow.metadata.Name, workflow.result),
    outcome: {
      uploaded: workflow.uploaded,
      deployed: workflow.deployed,
      backupCreated: true,
      backupFile: path.basename(workflow.backupReference),
      outputZipFile: path.basename(workflow.outputZipReference),
      reportFile: path.basename(workflow.reportReference),
      localValidation: "passed",
      sapValidation: workflow.uploaded ? "passed" : "not-run",
      configurationVerification: workflow.configurationVerification?.missing.length === 0 ? "passed" : "not-run"
    }
  };
}

function redactConfiguration(configuration: SapConfiguration): SapConfiguration {
  if (/(?:password|secret|token|private.?key|authorization|credential)/i.test(configuration.ParameterKey)) {
    const { ParameterValue: _value, ...safe } = configuration;
    return safe;
  }
  return configuration;
}

export function createApiApp(dependencies: ApiDependencies = {}): express.Express {
  const config = dependencies.config ?? loadServerConfig();
  const log = dependencies.log ?? logger;
  const sap = dependencies.sap ?? new SapIntegrationService(config, new SapAuthService(config, log), log);
  const projectRoot = dependencies.projectRoot ?? process.cwd();
  const isVercel = process.env.VERCEL === "1";
  const workspaceMode = dependencies.workspaceMode ?? (isVercel ? "ephemeral" : "local");
  const analysisRoot = workspaceMode === "ephemeral" ? os.tmpdir() : projectRoot;
  const artifactArchive = dependencies.artifactArchive ?? (isVercel ? new VercelBlobArtifactArchive() : undefined);
  const durableStorage = artifactArchive && (!isVercel || Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim()))
    ? "private-blob"
    : artifactArchive
      ? "not-configured"
      : "local";
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (_request, response) => response.json({ status: "ok" }));
  app.get("/api/sap/status", (_request, response) => response.json({
    configured: true,
    tenantUrl: config.sapBaseUrl,
    credentials: "server-managed",
    updateEnabled: config.enableUpdateApi,
    durableStorage
  }));

  app.post("/api/iflow/analyze", asyncHandler(async (request, response) => {
    const body = request.body as IFlowRequestBody;
    assertTenant(body.tenantUrl, config.sapBaseUrl);
    const id = requiredString(body.iflowId, "iflowId");
    const version = typeof body.version === "string" && body.version.trim() ? body.version.trim() : "active";
    const analysis = await analyzeIFlow(sap, id, version, analysisRoot, config.externalizeContentModifierBody);
    response.json(analysisResponse(id, version, analysis.metadata.Name, analysis.result));
  }));

  app.post("/api/iflow/dry-run", asyncHandler(async (request, response) => {
    const body = request.body as IFlowRequestBody;
    assertTenant(body.tenantUrl, config.sapBaseUrl);
    const id = requiredString(body.iflowId, "iflowId");
    const version = typeof body.version === "string" && body.version.trim() ? body.version.trim() : "active";
    const selection = selectedParameters(body.selectedParameters);
    const workflow = await runExternalization({
      config: requestConfig(config, id, version, true), sap, projectRoot, log, workspaceMode,
      ...(artifactArchive ? { artifactArchive } : {}),
      ...(selection ? { selectedParameters: selection } : {})
    });
    response.json(workflowResponse(id, version, workflow));
  }));

  app.post("/api/iflow/externalize", asyncHandler(async (request, response) => {
    const body = request.body as IFlowRequestBody;
    assertTenant(body.tenantUrl, config.sapBaseUrl);
    const id = requiredString(body.iflowId, "iflowId");
    const version = typeof body.version === "string" && body.version.trim() ? body.version.trim() : "active";
    const selection = selectedParameters(body.selectedParameters);
    if (!selection?.length) throw new ApiInputError("Select at least one new parameter before updating SAP");
    if (!config.enableUpdateApi) {
      throw new ApiAccessError("SAP updates are disabled. Set ENABLE_UPDATE_API=true only after protecting this deployment.");
    }
    const workflow = await runExternalization({
      config: requestConfig(config, id, version, false), sap, projectRoot, log, workspaceMode,
      ...(artifactArchive ? { artifactArchive } : {}),
      selectedParameters: selection
    });
    response.json(workflowResponse(id, version, workflow));
  }));

  app.get("/api/iflow/:id/configurations", asyncHandler(async (request, response) => {
    const id = requiredString(request.params.id, "id");
    const version = typeof request.query.version === "string" && request.query.version.trim()
      ? request.query.version.trim()
      : "active";
    response.json({ configurations: (await sap.getConfigurations(id, version)).map(redactConfiguration) });
  }));

  if (isVercel) {
    const frontendRoot = path.join(projectRoot, "public");
    app.use(express.static(frontendRoot));
    app.get("/{*splat}", (request, response, next) => {
      if (request.path.startsWith("/api/")) {
        next();
        return;
      }
      response.sendFile("index.html", { root: frontendRoot }, (error) => {
        if (error) next(error);
      });
    });
  }

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    const status = error instanceof ApiInputError
      ? 400
      : error instanceof ApiAccessError
        ? 403
      : error instanceof SapArtifactValidationError
        ? 422
      : error instanceof SapApiError && error.status
        ? error.status
        : /timeout|timed out|ECONNABORTED/i.test(error instanceof Error ? error.message : "")
          ? 504
        : /malformed|invalid (?:zip|xml)|validation failed/i.test(error instanceof Error ? error.message : "")
          ? 422
          : 500;
    const message = friendlyError(error, status);
    log.error("API", message);
    response.status(status).json({
      error: {
        status,
        message,
        ...(error instanceof SapArtifactValidationError ? {
          validationErrors: error.validation.errors,
          backupFile: path.basename(error.backupReference),
          backupReference: error.backupReference,
          rolledBack: error.rolledBack
        } : {})
      }
    });
  });
  return app;
}

function requestConfig(config: ServerConfig, iflowId: string, iflowVersion: string, dryRun: boolean): AppConfig {
  return { ...config, iflowId, iflowVersion, dryRun, deployAfterUpdate: false };
}

function asyncHandler(handler: (request: Request, response: Response) => Promise<void>) {
  return (request: Request, response: Response, next: NextFunction): void => {
    handler(request, response).catch(next);
  };
}

function friendlyError(error: unknown, status: number): string {
  if (error instanceof ApiAccessError) return error.message;
  if (status === 401) return "SAP authentication failed. Check the server-side OAuth credentials.";
  if (status === 403) return "The configured SAP account is not authorized for this operation.";
  if (status === 404) return "The requested iFlow or version was not found in SAP Integration Suite.";
  if (status === 409) return "SAP rejected the update because the iFlow version changed. Analyze it again and retry.";
  if (error instanceof Error) return error.message;
  return "The request could not be completed.";
}
