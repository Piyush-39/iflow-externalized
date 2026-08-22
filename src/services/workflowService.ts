import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AppConfig } from "../config/env.js";
import type {
  ArtifactExternalizationResult,
  ArtifactMetadata,
  ExternalizationReport,
  SapConfiguration,
  SapValidationResult
} from "../models/externalization.js";
import type { Logger } from "../utils/logger.js";
import { logger } from "../utils/logger.js";
import { externalizeArtifactFiles } from "./externalizationService.js";
import type { ArtifactArchive } from "./artifactArchiveService.js";
import { writeChangeReport } from "./reportService.js";
import type { SapIntegrationClient } from "./sapIntegrationService.js";
import { validateIFlowZip } from "./validationService.js";
import { createIFlowZip, extractIFlow } from "./zipService.js";

const PARAMETERS_PATH = "src/main/resources/parameters.prop";
const PARAMDEF_PATH = "src/main/resources/parameters.propdef";

export interface WorkflowResult {
  metadata: ArtifactMetadata;
  result: ArtifactExternalizationResult;
  backupPath: string;
  outputZipPath: string;
  uploaded: boolean;
  deployed: boolean;
  configurations?: SapConfiguration[];
  sapValidation?: SapValidationResult;
  configurationVerification?: { expected: number; found: number; missing: string[] };
  backupReference: string;
  outputZipReference: string;
  reportReference: string;
}

export interface WorkflowOptions {
  config: AppConfig;
  sap: SapIntegrationClient;
  projectRoot?: string;
  log?: Logger;
  selectedParameters?: readonly string[];
  artifactArchive?: ArtifactArchive;
  workspaceMode?: "local" | "ephemeral";
}

export class SapArtifactValidationError extends Error {
  constructor(
    readonly validation: SapValidationResult,
    readonly backupPath: string,
    readonly backupReference: string,
    readonly rolledBack: boolean
  ) {
    super("SAP validation failed; deployment was not attempted");
    this.name = "SapArtifactValidationError";
  }
}

function safeFilePart(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]+/g, "_").replace(/^\.+/, "") || "iflow";
}

function timestamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace("T", "_").replace(/\.\d{3}Z$/, "");
}

async function writeUniqueBackup(directory: string, baseName: string, data: Buffer): Promise<string> {
  await mkdir(directory, { recursive: true });
  for (let suffix = 0; suffix < 1000; suffix += 1) {
    const fileName = `${baseName}${suffix ? `_${suffix + 1}` : ""}.zip`;
    const target = path.join(directory, fileName);
    try {
      await writeFile(target, data, { flag: "wx" });
      return target;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  throw new Error("Could not create a unique backup filename");
}

async function optionalText(filePath: string): Promise<string | undefined> {
  try { return await readFile(filePath, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function uniqueParameterNames(result: ArtifactExternalizationResult): string[] {
  return [...new Set(result.parameters
    .filter((parameter) => parameter.alreadyExternalized || parameter.applied)
    .map((parameter) => parameter.parameterName))].sort();
}

export async function runExternalization(options: WorkflowOptions): Promise<WorkflowResult> {
  const { config, sap } = options;
  const log = options.log ?? logger;
  const workspaceMode = options.workspaceMode ?? "local";
  const root = workspaceMode === "ephemeral"
    ? await mkdtemp(path.join(os.tmpdir(), "iflow-operation-"))
    : path.resolve(options.projectRoot ?? process.cwd());
  const backupDirectory = path.join(root, "backup");
  const outputDirectory = path.join(root, "output");
  const tempDirectory = path.join(root, ".tmp");
  await Promise.all([mkdir(backupDirectory, { recursive: true }), mkdir(outputDirectory, { recursive: true }), mkdir(tempDirectory, { recursive: true })]);

  let extractedDirectory: string | undefined;
  try {
    const metadata = await sap.getArtifactMetadata(config.iflowId, config.iflowVersion);
    const originalZip = await sap.downloadIFlow(config.iflowId, config.iflowVersion);
    const backupPath = await writeUniqueBackup(
      backupDirectory,
      `${safeFilePart(metadata.Name || config.iflowId)}_${timestamp()}`,
      originalZip
    );
    const backupReference = options.artifactArchive
      ? await options.artifactArchive.save("backup", path.basename(backupPath), originalZip, "application/zip")
      : backupPath;
    log.info("BACKUP", "Original saved", { backupReference });

    const extracted = await extractIFlow(originalZip, tempDirectory);
    extractedDirectory = extracted.directory;
    log.info("EXTRACT", `Found ${path.basename(extracted.iflowPath)}`);
    const propertiesPath = path.join(extracted.directory, ...PARAMETERS_PATH.split("/"));
    const propdefPath = path.join(extracted.directory, ...PARAMDEF_PATH.split("/"));

    const [iflowXml, parametersProperties, parametersDefinitionXml] = await Promise.all([
      readFile(extracted.iflowPath, "utf8"), optionalText(propertiesPath), optionalText(propdefPath)
    ]);
    const result = await externalizeArtifactFiles(
      iflowXml,
      { parametersProperties, parametersDefinitionXml },
      {
        ...(options.selectedParameters ? { selectedParameters: options.selectedParameters } : {}),
        externalizeContentModifierBody: config.externalizeContentModifierBody
      }
    );
    if (options.selectedParameters) {
      const available = new Set(result.parameters.filter((item) => !item.alreadyExternalized).map((item) => item.parameterName));
      const unknown = [...new Set(options.selectedParameters)].filter((name) => !available.has(name));
      if (unknown.length) throw new Error(`Selected parameters are not available for externalization: ${unknown.join(", ")}`);
    }
    log.info("ANALYZE", `Found ${result.externalizableProperties} configurable properties`);

    if (result.changed) {
      await mkdir(path.dirname(propertiesPath), { recursive: true });
      await Promise.all([
        writeFile(extracted.iflowPath, result.modifiedXml, "utf8"),
        writeFile(propertiesPath, result.parametersProperties, "utf8"),
        writeFile(propdefPath, result.parametersDefinitionXml, "utf8")
      ]);
    }

    const modifiedZip = await createIFlowZip(extracted.directory);
    const allowedAdded = [PARAMETERS_PATH, PARAMDEF_PATH].filter((file) => !extracted.fileList.includes(file));
    const newParameterNames = result.parameters.filter((parameter) => !parameter.alreadyExternalized && parameter.applied).map((parameter) => parameter.parameterName);
    validateIFlowZip(originalZip, modifiedZip, allowedAdded, newParameterNames);
    log.info("VALIDATE", "Local artifact validation successful");

    const outputZipPath = path.join(outputDirectory, `${safeFilePart(config.iflowId)}-externalized.zip`);
    await writeFile(outputZipPath, modifiedZip);
    log.info("ZIP", "Modified artifact created", { outputZipPath });
    const outputZipReference = options.artifactArchive
      ? await options.artifactArchive.save("output", path.basename(outputZipPath), modifiedZip, "application/zip")
      : outputZipPath;

    const report: ExternalizationReport = {
      iflowId: config.iflowId,
      iflowName: metadata.Name,
      version: config.iflowVersion,
      generatedAt: new Date().toISOString(),
      dryRun: config.dryRun,
      detectedComponents: result.detectedComponents,
      externalizableProperties: result.externalizableProperties,
      alreadyExternalized: result.existingParameters.length,
      newExternalizedParameters: result.parameters.filter((parameter) => !parameter.alreadyExternalized && parameter.applied).length,
      adapterParameters: result.parameters.filter((parameter) => parameter.sourceType === "adapter" && !parameter.alreadyExternalized && parameter.applied).length,
      contentModifierParameters: result.parameters.filter((parameter) => parameter.sourceType === "content-modifier" && !parameter.alreadyExternalized && parameter.applied).length,
      skippedDynamicExpressions: result.skipped.filter((item) => item.reason === "dynamic-expression").length,
      skippedUnsupportedProperties: result.skipped.filter((item) => item.reason !== "dynamic-expression" && item.reason !== "empty").length,
      parameters: result.parameters,
      skipped: result.skipped
    };
    const reportPath = path.join(outputDirectory, "externalization-report.json");
    await writeChangeReport(report, reportPath, log);
    const reportReference = options.artifactArchive
      ? await options.artifactArchive.save("report", path.basename(reportPath), await readFile(reportPath), "application/json")
      : reportPath;

    if (config.dryRun) {
      log.warn("DRY-RUN", "DRY RUN ENABLED");
      log.warn("DRY-RUN", "SAP Integration Suite was NOT modified.");
      return {
        metadata, result, backupPath, outputZipPath, backupReference, outputZipReference, reportReference,
        uploaded: false, deployed: false
      };
    }

    if (!result.changed) {
      log.info("UPLOAD", "No update required.");
      return {
        metadata, result, backupPath, outputZipPath, backupReference, outputZipReference, reportReference,
        uploaded: false, deployed: false
      };
    }

    log.info("UPLOAD", "Updating SAP artifact");
    await sap.updateIFlow(config.iflowId, config.iflowVersion, metadata.Name, modifiedZip);
    const validation = await sap.validateIFlow(config.iflowId, config.iflowVersion);
    if (!validation.passed) {
      log.error("SAP-VALIDATE", "SAP VALIDATION FAILED");
      for (const error of validation.errors) {
        log.error("SAP-VALIDATE", error.message, {
          component: error.sourceObject,
          resource: [error.resourcePath, error.resourceName].filter(Boolean).join("/")
        });
      }
      let rolledBack = false;
      if (config.autoRollbackOnFailure) {
        await sap.restoreOriginalIFlow(config.iflowId, config.iflowVersion, metadata.Name, originalZip);
        const rollbackValidation = await sap.validateIFlow(config.iflowId, config.iflowVersion);
        if (!rollbackValidation.passed) throw new Error(`SAP validation failed and automatic rollback could not be validated. Backup: ${backupReference}`);
        log.warn("ROLLBACK", "Original artifact restored and validated");
        rolledBack = true;
      } else {
        log.warn("ROLLBACK", `Automatic rollback is disabled. Original backup: ${backupReference}`);
      }
      throw new SapArtifactValidationError(validation, backupPath, backupReference, rolledBack);
    }
    log.info("SAP-VALIDATE", "Validation passed");

    const configurations = await sap.getConfigurations(config.iflowId, config.iflowVersion);
    const found = new Set(configurations.map((item) => item.ParameterKey));
    const expected = uniqueParameterNames(result);
    const missing = expected.filter((name) => !found.has(name));
    log.info("VERIFY", `Configuration verification — Expected: ${expected.length}, Found in SAP: ${expected.length - missing.length}`);
    for (const name of expected) log.info("VERIFY", `${found.has(name) ? "✓" : "✗"} ${name}`);
    if (missing.length) {
      throw new Error(`SAP configuration verification is missing parameters: ${missing.join(", ")}. Deployment was not attempted.`);
    }

    let deployed = false;
    if (config.deployAfterUpdate) {
      log.warn("DEPLOY", "DEPLOY_AFTER_UPDATE is enabled; deploying validated artifact");
      await sap.deployIFlow(config.iflowId, config.iflowVersion);
      deployed = true;
    } else {
      log.info("DEPLOY", "Design-time artifact updated; deployment was not requested");
    }
    return {
      metadata, result, backupPath, outputZipPath, backupReference, outputZipReference, reportReference,
      uploaded: true, deployed, configurations,
      sapValidation: validation,
      configurationVerification: { expected: expected.length, found: expected.length - missing.length, missing }
    };
  } finally {
    if (extractedDirectory) await rm(extractedDirectory, { recursive: true, force: true });
    if (workspaceMode === "ephemeral") await rm(root, { recursive: true, force: true });
  }
}
