import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ExternalizationReport, ExternalizedParameter } from "../models/externalization.js";
import type { Logger } from "../utils/logger.js";
import { logger } from "../utils/logger.js";

function safeParameter(parameter: ExternalizedParameter): ExternalizedParameter {
  return parameter.sensitive ? { ...parameter, originalValue: "[REDACTED]" } : parameter;
}

export async function writeChangeReport(
  report: ExternalizationReport,
  outputPath = path.resolve("output/externalization-report.json"),
  log: Logger = logger
): Promise<void> {
  const safeReport = { ...report, parameters: report.parameters.map(safeParameter) };
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(safeReport, null, 2)}\n`, { encoding: "utf8", flag: "w" });

  log.info("REPORT", `iFlow: ${report.iflowName}`);
  log.info("REPORT", `Version: ${report.version}`);
  log.info("REPORT", `Detected components: ${report.detectedComponents}`);
  log.info("REPORT", `Externalizable properties: ${report.externalizableProperties}`);
  log.info("REPORT", `Already externalized: ${report.alreadyExternalized}`);
  log.info("REPORT", `New externalized parameters: ${report.newExternalizedParameters}`);
  log.info("REPORT", `Adapter parameters: ${report.adapterParameters}`);
  log.info("REPORT", `Content Modifier parameters: ${report.contentModifierParameters}`);
  log.info("REPORT", `Skipped dynamic expressions: ${report.skippedDynamicExpressions}`);
  log.info("REPORT", `Skipped unsupported properties: ${report.skippedUnsupportedProperties}`);
  for (const parameter of report.parameters.filter((item) => !item.alreadyExternalized && item.applied !== false)) {
    const source = parameter.sourceType === "content-modifier"
      ? `Content Modifier ${parameter.section ?? "field"}`
      : parameter.adapterType ?? "Adapter";
    log.info("EXTERNALIZE", `${source} ${parameter.componentName ?? ""}.${parameter.propertyName} -> ${parameter.parameterName}`, {
      originalValue: parameter.sensitive ? "[REDACTED]" : parameter.originalValue
    });
  }
}
