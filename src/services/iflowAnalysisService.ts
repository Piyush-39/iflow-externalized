import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import type { ArtifactExternalizationResult, ArtifactMetadata } from "../models/externalization.js";
import { externalizeArtifactFiles } from "./externalizationService.js";
import type { SapIntegrationClient } from "./sapIntegrationService.js";
import { extractIFlow } from "./zipService.js";

const PARAMETERS_PATH = "src/main/resources/parameters.prop";
const PARAMDEF_PATH = "src/main/resources/parameters.propdef";

export interface IFlowAnalysis {
  metadata: ArtifactMetadata;
  result: ArtifactExternalizationResult;
}

async function optionalText(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function analyzeIFlow(
  sap: SapIntegrationClient,
  id: string,
  version: string,
  projectRoot = process.cwd(),
  externalizeContentModifierBody = false
): Promise<IFlowAnalysis> {
  const [metadata, artifact] = await Promise.all([
    sap.getArtifactMetadata(id, version),
    sap.downloadIFlow(id, version)
  ]);
  const temporaryRoot = path.resolve(projectRoot, ".tmp");
  await mkdir(temporaryRoot, { recursive: true });
  const extracted = await extractIFlow(artifact, temporaryRoot);
  try {
    const propertiesPath = path.join(extracted.directory, ...PARAMETERS_PATH.split("/"));
    const propdefPath = path.join(extracted.directory, ...PARAMDEF_PATH.split("/"));
    const [iflowXml, parametersProperties, parametersDefinitionXml] = await Promise.all([
      readFile(extracted.iflowPath, "utf8"),
      optionalText(propertiesPath),
      optionalText(propdefPath)
    ]);
    const result = await externalizeArtifactFiles(
      iflowXml,
      { parametersProperties, parametersDefinitionXml },
      { applyChanges: false, externalizeContentModifierBody }
    );
    return { metadata, result };
  } finally {
    await rm(extracted.directory, { recursive: true, force: true });
  }
}
