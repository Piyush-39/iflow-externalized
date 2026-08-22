import AdmZip from "adm-zip";
import type { SapValidationError, SapValidationResult } from "../models/externalization.js";
import { assertValidXml } from "../utils/xmlUtils.js";
import { parseIFlow } from "./iflowParserService.js";
import { listZipFiles, locateIFlowPath, readZipEntry } from "./zipService.js";

export interface ZipValidationResult {
  fileList: string[];
  iflowPath: string;
}

export function validateIFlowZip(
  originalZip: Buffer,
  modifiedZip: Buffer,
  allowedAddedFiles: string[] = [],
  expectedNewParameters: string[] = []
): ZipValidationResult {
  // Opening both archives also validates each central directory.
  new AdmZip(originalZip).getEntries();
  new AdmZip(modifiedZip).getEntries();
  const originalFiles = listZipFiles(originalZip);
  const modifiedFiles = listZipFiles(modifiedZip);
  const allowed = new Set(allowedAddedFiles);
  const missing = originalFiles.filter((file) => !modifiedFiles.includes(file));
  const unexpected = modifiedFiles.filter((file) => !originalFiles.includes(file) && !allowed.has(file));
  if (missing.length) throw new Error(`Modified ZIP removed resources: ${missing.join(", ")}`);
  if (unexpected.length) throw new Error(`Modified ZIP added unexpected resources: ${unexpected.join(", ")}`);

  const iflowPath = locateIFlowPath(modifiedFiles);
  const iflowXml = readZipEntry(modifiedZip, iflowPath).toString("utf8");
  parseIFlow(iflowXml);

  const propdefPath = "src/main/resources/parameters.propdef";
  if (modifiedFiles.includes(propdefPath)) assertValidXml(readZipEntry(modifiedZip, propdefPath).toString("utf8"), "parameters.propdef");
  if (expectedNewParameters.length > 0) {
    const propertiesPath = "src/main/resources/parameters.prop";
    if (!modifiedFiles.includes(propertiesPath) || !modifiedFiles.includes(propdefPath)) {
      throw new Error("Generated externalized parameters require both parameters.prop and parameters.propdef");
    }
    const properties = readZipEntry(modifiedZip, propertiesPath).toString("utf8");
    const propdef = readZipEntry(modifiedZip, propdefPath).toString("utf8");
    for (const name of expectedNewParameters) {
      const propertyKey = new RegExp(`^${name}=`, "m");
      if (!propertyKey.test(properties)) throw new Error(`parameters.prop is missing generated default: ${name}`);
      if (!propdef.includes(`<name>${name}</name>`) || !propdef.includes(`param_key="${name}"`)) {
        throw new Error(`parameters.propdef is missing generated definition/reference: ${name}`);
      }
    }
  }

  const intentionallyChanged = new Set([iflowPath, "src/main/resources/parameters.prop", propdefPath]);
  for (const file of originalFiles) {
    if (intentionallyChanged.has(file)) continue;
    if (!readZipEntry(originalZip, file).equals(readZipEntry(modifiedZip, file))) {
      throw new Error(`Unrelated ZIP resource changed unexpectedly: ${file}`);
    }
  }
  return { fileList: modifiedFiles, iflowPath };
}

function validationErrors(value: unknown): SapValidationError[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return {
      message: String(record.message ?? record.Message ?? item),
      ...(record.severity ? { severity: String(record.severity) } : {}),
      ...(record.sourceObject ? { sourceObject: String(record.sourceObject) } : {}),
      ...(record.resourcePath ? { resourcePath: String(record.resourcePath) } : {}),
      ...(record.resourceName ? { resourceName: String(record.resourceName) } : {})
    };
  });
}

export function parseSapValidationResult(raw: unknown): SapValidationResult {
  let parsed = raw;
  if (typeof raw === "string") {
    const text = raw.trim();
    const jsonStart = text.indexOf("[");
    if (jsonStart >= 0) {
      try { parsed = JSON.parse(text.slice(jsonStart)); } catch { parsed = raw; }
    } else {
      try { parsed = JSON.parse(text); } catch { parsed = raw; }
    }
  }
  const serialized = typeof raw === "string" ? raw : JSON.stringify(raw);
  const failed = /Checkexecutionresult\s*:\s*Failed/i.test(serialized)
    || (parsed && typeof parsed === "object" && /failed/i.test(String((parsed as Record<string, unknown>).Checkexecutionresult ?? "")));
  const errors = validationErrors(parsed);
  if (failed && errors.length === 0) errors.push({ message: serialized || "SAP validation failed" });
  return { passed: !failed, raw, errors };
}
