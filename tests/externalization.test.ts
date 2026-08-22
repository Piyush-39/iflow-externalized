import AdmZip from "adm-zip";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../src/config/env.js";
import type { ExternalizationReport } from "../src/models/externalization.js";
import { externalizeArtifactFiles } from "../src/services/externalizationService.js";
import { isStaticExternalizableValue } from "../src/services/contentModifierService.js";
import { writeChangeReport } from "../src/services/reportService.js";
import type { SapIntegrationClient } from "../src/services/sapIntegrationService.js";
import { validateIFlowZip } from "../src/services/validationService.js";
import { runExternalization } from "../src/services/workflowService.js";
import { StructuredLogger } from "../src/utils/logger.js";

const fixtureRoot = path.resolve("tests/fixtures");
const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fixture(name: string): Promise<string> {
  return readFile(path.join(fixtureRoot, name), "utf8");
}

async function externalize(xml?: string, prop = "", propdef?: string) {
  return externalizeArtifactFiles(
    xml ?? await fixture("http-receiver.iflw"),
    { parametersProperties: prop, parametersDefinitionXml: propdef ?? await fixture("parameters.propdef") }
  );
}

function withAddress(xml: string, value: string): string {
  return xml.replace("https://dev.example.com/orders", value);
}

function secondReceiver(xml: string): string {
  const first = xml
    .replace('Participant_Receiver" ifl:type="EndpointRecevier" name="Receiver"', 'Participant_S4" ifl:type="EndpointRecevier" name="S4"')
    .replace('targetRef="Participant_Receiver"', 'targetRef="Participant_S4"');
  const addition = `
    <bpmn2:participant id="Participant_CRM" ifl:type="EndpointRecevier" name="CRM"/>
    <bpmn2:messageFlow id="MessageFlow_HTTP_2" name="HTTP CRM" sourceRef="Participant_Process" targetRef="Participant_CRM">
      <bpmn2:extensionElements>
        <ifl:property><key>ComponentType</key><value>HTTP</value></ifl:property>
        <ifl:property><key>Address</key><value>https://crm.example.com/orders</value></ifl:property>
        <ifl:property><key>cmdVariantUri</key><value>ctype::AdapterVariant/cname::HTTP/tp::HTTP/mp::HTTP/direction::Receiver/version::1.0.0</value></ifl:property>
        <ifl:property><key>direction</key><value>Receiver</value></ifl:property>
      </bpmn2:extensionElements>
    </bpmn2:messageFlow>`;
  return first.replace("  </bpmn2:collaboration>", `${addition}\n  </bpmn2:collaboration>`);
}

function artifactZip(iflowXml: string, properties = "", propdef = '<?xml version="1.0"?><parameters><param_references/></parameters>'): Buffer {
  const zip = new AdmZip();
  zip.addFile("META-INF/MANIFEST.MF", Buffer.from("Manifest-Version: 1.0\n"));
  zip.addFile("src/main/resources/scenarioflows/integrationflow/Test.iflw", Buffer.from(iflowXml));
  zip.addFile("src/main/resources/parameters.prop", Buffer.from(properties));
  zip.addFile("src/main/resources/parameters.propdef", Buffer.from(propdef));
  zip.addFile("src/main/resources/script/processOrders.groovy", Buffer.from("// unchanged\n"));
  return zip.toBuffer();
}

describe("SAP-compatible externalization", () => {
  it("externalizes an HTTP URL and preserves its default value", async () => {
    const result = await externalize();
    expect(result.modifiedXml).toContain("{{Receiver_HTTP_Address}}");
    expect(result.parametersProperties).toContain("Receiver_HTTP_Address=https\\://dev.example.com/orders");
    expect(result.parametersDefinitionXml).toContain("<name>Receiver_HTTP_Address</name>");
    expect(result.parametersDefinitionXml).toContain('param_key="Receiver_HTTP_Address"');
    expect(result.parameters[0]).toMatchObject({
      parameterName: "Receiver_HTTP_Address",
      originalValue: "https://dev.example.com/orders",
      alreadyExternalized: false
    });
  });

  it("leaves an already externalized value unchanged", async () => {
    const xml = withAddress(await fixture("http-receiver.iflw"), "{{Receiver_HTTP_Address}}");
    const result = await externalize(xml, "Receiver_HTTP_Address=https://dev.example.com/orders\n");
    expect(result.changed).toBe(false);
    expect(result.modifiedXml).toBe(xml);
    expect(result.parameters).toHaveLength(1);
    expect(result.parameters[0]?.alreadyExternalized).toBe(true);
  });

  it("generates distinct names for two receivers", async () => {
    const result = await externalize(secondReceiver(await fixture("http-receiver.iflw")));
    expect(result.parameters.map((item) => item.parameterName)).toEqual(["Receiver_S4_Address", "Receiver_CRM_Address"]);
  });

  it("ignores empty configuration values", async () => {
    const result = await externalize(withAddress(await fixture("http-receiver.iflw"), ""));
    expect(result.changed).toBe(false);
    expect(result.parameters).toHaveLength(0);
  });

  it("does not modify BPMN IDs", async () => {
    const result = await externalize();
    expect(result.modifiedXml).toContain('id="Definitions_1"');
    expect(result.modifiedXml).toContain('id="Process_1"');
    expect(result.modifiedXml).toContain('id="MessageFlow_HTTP"');
  });

  it("does not modify sequence flow IDs or references", async () => {
    const result = await externalize();
    expect(result.modifiedXml).toContain('id="SequenceFlow_Original"');
    expect(result.modifiedXml).toContain('sourceRef="StartEvent_1"');
    expect(result.modifiedXml).toContain('targetRef="EndEvent_1"');
  });

  it("does not modify scripts or mappings", async () => {
    const result = await externalize();
    expect(result.modifiedXml).toContain("processOrders.groovy");
    expect(result.modifiedXml).toContain("Orders.mmap");
    expect(result.parameters.some((item) => /script|mapping/i.test(item.propertyName))).toBe(false);
  });

  it("keeps every original ZIP resource and byte-preserves unrelated files", async () => {
    const originalXml = await fixture("http-receiver.iflw");
    const original = artifactZip(originalXml);
    const result = await externalize(originalXml);
    const modified = artifactZip(result.modifiedXml, result.parametersProperties, result.parametersDefinitionXml);
    const validation = validateIFlowZip(original, modified, [], ["Receiver_HTTP_Address"]);
    expect(validation.fileList).toHaveLength(5);
    expect(validation.fileList).toContain("src/main/resources/script/processOrders.groovy");
  });

  it("prevents upload when XML is malformed", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "iflow-malformed-"));
    tempRoots.push(root);
    const updateIFlow = vi.fn();
    const sap = fakeSap(artifactZip("<broken>"), updateIFlow);
    await expect(runExternalization({ config: config(false), sap, projectRoot: root, log: silentLogger() })).rejects.toThrow(/malformed/i);
    expect(updateIFlow).not.toHaveBeenCalled();
  });

  it("never invokes SAP update during dry run", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "iflow-dryrun-"));
    tempRoots.push(root);
    const updateIFlow = vi.fn();
    const sap = fakeSap(artifactZip(await fixture("http-receiver.iflw")), updateIFlow);
    const result = await runExternalization({ config: config(true), sap, projectRoot: root, log: silentLogger() });
    expect(result.uploaded).toBe(false);
    expect(updateIFlow).not.toHaveBeenCalled();
  });

  it("is idempotent on a second execution", async () => {
    const first = await externalize();
    const second = await externalize(first.modifiedXml, first.parametersProperties, first.parametersDefinitionXml);
    expect(second.changed).toBe(false);
    expect(second.modifiedXml).toBe(first.modifiedXml);
    expect(second.parameters.filter((item) => !item.alreadyExternalized)).toHaveLength(0);
  });

  it("redacts sensitive values from logs and report JSON", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "iflow-report-"));
    tempRoots.push(root);
    const lines: string[] = [];
    const log = new StructuredLogger({ log: (line) => lines.push(String(line)), warn: (line) => lines.push(String(line)), error: (line) => lines.push(String(line)) });
    const report: ExternalizationReport = {
      iflowId: "Flow", iflowName: "Flow", version: "active", generatedAt: new Date().toISOString(), dryRun: true,
      detectedComponents: 1, externalizableProperties: 1, alreadyExternalized: 0, newExternalizedParameters: 1,
      adapterParameters: 1, contentModifierParameters: 0, skippedDynamicExpressions: 0, skippedUnsupportedProperties: 0,
      parameters: [{ parameterName: "Receiver_HTTP_Credential", originalValue: "DO_NOT_PRINT_ALIAS", sourceType: "adapter", propertyName: "credentialName", alreadyExternalized: false, sensitive: true }],
      skipped: []
    };
    const reportPath = path.join(root, "report.json");
    await writeChangeReport(report, reportPath, log);
    expect(lines.join("\n")).not.toContain("DO_NOT_PRINT_ALIAS");
    expect(await readFile(reportPath, "utf8")).not.toContain("DO_NOT_PRINT_ALIAS");
    expect(await readFile(reportPath, "utf8")).toContain("[REDACTED]");
  });
});

describe("Content Modifier externalization", () => {
  async function contentModifier(xml?: string, properties = "") {
    return externalizeArtifactFiles(
      xml ?? await fixture("content-modifier.iflw"),
      { parametersProperties: properties, parametersDefinitionXml: await fixture("parameters.propdef") }
    );
  }

  it("externalizes a constant header without changing its field name", async () => {
    const result = await contentModifier();
    const parameter = result.parameters.find((item) => item.propertyName === "API_URL");
    expect(parameter).toMatchObject({
      parameterName: "CM_Set_Target_Configuration_API_URL",
      originalValue: "https://dev.example.com",
      sourceType: "content-modifier",
      section: "header",
      alreadyExternalized: false
    });
    expect(result.modifiedXml).toContain("API_URL");
    expect(result.modifiedXml).toContain("{{CM_Set_Target_Configuration_API_URL}}");
  });

  it("externalizes a constant Exchange Property", async () => {
    const result = await contentModifier();
    expect(result.parameters).toContainEqual(expect.objectContaining({
      parameterName: "CM_Set_Target_Configuration_TARGET_DIRECTORY",
      originalValue: "/dev/outbound",
      section: "property"
    }));
  });

  it.each(["${property.targetUrl}", "${header.Authorization}"])("does not externalize runtime expression %s", async (expression) => {
    expect(isStaticExternalizableValue(expression)).toBe(false);
    const xml = (await fixture("content-modifier.iflw")).replace("${property.runtimeUrl}", expression);
    const result = await contentModifier(xml);
    expect(result.modifiedXml).toContain(expression);
    expect(result.parameters.some((item) => item.propertyName === "DYNAMIC_URL")).toBe(false);
    expect(result.skipped).toContainEqual(expect.objectContaining({ propertyName: "DYNAMIC_URL", reason: "dynamic-expression" }));
  });

  it("leaves an already externalized Content Modifier value unchanged", async () => {
    const xml = (await fixture("content-modifier.iflw"))
      .replace("https://dev.example.com", "{{CM_Set_Target_Configuration_API_URL}}");
    const result = await contentModifier(xml, "CM_Set_Target_Configuration_API_URL=https://dev.example.com\n");
    const parameter = result.parameters.find((item) => item.propertyName === "API_URL");
    expect(parameter?.alreadyExternalized).toBe(true);
    expect(result.modifiedXml).toContain("{{CM_Set_Target_Configuration_API_URL}}");
    expect(result.parameters.filter((item) => item.parameterName === "CM_Set_Target_Configuration_API_URL")).toHaveLength(1);
  });

  it("does not modify Content Modifier component IDs or names", async () => {
    const result = await contentModifier();
    expect(result.modifiedXml).toContain('id="CallActivity_10"');
    expect(result.modifiedXml).toContain('name="Set Target Configuration"');
    expect(result.modifiedXml).toContain('id="SequenceFlow_CM"');
  });

  it("ignores a structured Message Body by default", async () => {
    const result = await contentModifier();
    expect(result.parameters.some((item) => item.section === "body")).toBe(false);
    expect(result.skipped).toContainEqual(expect.objectContaining({ section: "body", reason: "body-disabled" }));
    expect(result.modifiedXml).toContain("This is intentionally a structured message body");
  });

  it("externalizes multiple constant headers in the same Content Modifier", async () => {
    const result = await contentModifier();
    expect(result.parameters.filter((item) => item.section === "header").map((item) => item.propertyName)).toEqual([
      "API_URL", "SOURCE_SYSTEM"
    ]);
  });

  it("uses separate deterministic names for identical fields in two Content Modifiers", async () => {
    const source = await fixture("content-modifier.iflw");
    const original = source.match(/ {4}<bpmn2:callActivity[\s\S]*? {4}<\/bpmn2:callActivity>/)?.[0];
    expect(original).toBeTruthy();
    const second = original!
      .replace("CallActivity_10", "CallActivity_20")
      .replace("Set Target Configuration", "Set Invoice");
    const xml = source.replace("    <bpmn2:sequenceFlow", `${second}\n    <bpmn2:sequenceFlow`);
    const result = await contentModifier(xml);
    expect(result.parameters.filter((item) => item.propertyName === "API_URL").map((item) => item.parameterName)).toEqual([
      "CM_Set_Target_Configuration_API_URL",
      "CM_Set_Invoice_API_URL"
    ]);
  });

  it("can analyze without mutating and only applies selected parameters", async () => {
    const xml = await fixture("content-modifier.iflw");
    const analysis = await externalizeArtifactFiles(xml, {}, { applyChanges: false });
    expect(analysis.changed).toBe(false);
    expect(analysis.modifiedXml).toBe(xml);
    const selected = await externalizeArtifactFiles(xml, {}, {
      selectedParameters: ["CM_Set_Target_Configuration_SOURCE_SYSTEM"]
    });
    expect(selected.modifiedXml).toContain("{{CM_Set_Target_Configuration_SOURCE_SYSTEM}}");
    expect(selected.modifiedXml).toContain("https://dev.example.com");
    expect(selected.parameters.filter((item) => item.applied)).toHaveLength(1);
  });

  it("finds the expected HTTP plus Content Modifier end-to-end scenario", async () => {
    const http = await fixture("http-receiver.iflw");
    const collaboration = http.match(/ {2}<bpmn2:collaboration[\s\S]*? {2}<\/bpmn2:collaboration>/)?.[0];
    expect(collaboration).toBeTruthy();
    const content = (await fixture("content-modifier.iflw"))
      .replace("https://dev.example.com", "https://dev.example.com/orders")
      .replace("API_URL", "TARGET_URL")
      .replace(/<ifl:property><key>propertyTable<\/key><value>[\s\S]*?<\/value><\/ifl:property>/, "<ifl:property><key>propertyTable</key><value/></ifl:property>")
      .replace("  <bpmn2:process", `${collaboration}\n  <bpmn2:process`);
    const result = await contentModifier(content);
    expect(result.parameters.filter((item) => !item.alreadyExternalized).map((item) => item.parameterName)).toEqual([
      "Receiver_HTTP_Address",
      "CM_Set_Target_Configuration_TARGET_URL",
      "CM_Set_Target_Configuration_SOURCE_SYSTEM"
    ]);
    expect(result.skipped.filter((item) => item.reason === "dynamic-expression")).toHaveLength(1);
    expect(result.modifiedXml).toContain("${property.runtimeUrl}");
  });
});

function config(dryRun: boolean): AppConfig {
  return {
    sapBaseUrl: "https://tenant.example.com", sapClientId: "id", sapClientSecret: "secret",
    sapTokenUrl: "https://auth.example.com/token", iflowId: "TestFlow", iflowVersion: "active",
    dryRun, deployAfterUpdate: false, autoRollbackOnFailure: false,
    externalizeContentModifierBody: false
  };
}

function fakeSap(zip: Buffer, updateIFlow: ReturnType<typeof vi.fn>): SapIntegrationClient {
  return {
    getArtifactMetadata: vi.fn().mockResolvedValue({ Id: "TestFlow", Name: "Test Flow", Version: "active" }),
    downloadIFlow: vi.fn().mockResolvedValue(zip),
    updateIFlow,
    restoreOriginalIFlow: vi.fn(),
    validateIFlow: vi.fn().mockResolvedValue({ passed: true, errors: [], raw: "Passed" }),
    getConfigurations: vi.fn().mockResolvedValue([]),
    deployIFlow: vi.fn()
  };
}

function silentLogger(): StructuredLogger {
  return new StructuredLogger({ log: () => undefined, warn: () => undefined, error: () => undefined });
}
