import AdmZip from "adm-zip";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiApp } from "../src/api/app.js";
import type { ServerConfig } from "../src/config/env.js";
import { SapApiError, type SapIntegrationClient } from "../src/services/sapIntegrationService.js";
import { readZipEntry } from "../src/services/zipService.js";
import { StructuredLogger } from "../src/utils/logger.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(name: string): Promise<string> {
  return readFile(path.resolve("tests/fixtures", name), "utf8");
}

function zipArtifact(iflowXml: string): Buffer {
  const zip = new AdmZip();
  zip.addFile("META-INF/MANIFEST.MF", Buffer.from("Manifest-Version: 1.0\n"));
  zip.addFile("src/main/resources/scenarioflows/integrationflow/Test.iflw", Buffer.from(iflowXml));
  zip.addFile("src/main/resources/parameters.prop", Buffer.from(""));
  zip.addFile("src/main/resources/parameters.propdef", Buffer.from('<?xml version="1.0"?><parameters><param_references/></parameters>'));
  return zip.toBuffer();
}

function serverConfig(): ServerConfig {
  return {
    sapBaseUrl: "https://tenant.example.com",
    sapClientId: "client-id",
    sapClientSecret: "DO_NOT_EXPOSE_CLIENT_SECRET",
    sapTokenUrl: "https://auth.example.com/token",
    deployAfterUpdate: false,
    autoRollbackOnFailure: false,
    externalizeContentModifierBody: false,
    enableUpdateApi: true
  };
}

function fakeSap(artifact: Buffer, updateIFlow = vi.fn()): SapIntegrationClient {
  return {
    getArtifactMetadata: vi.fn().mockResolvedValue({ Id: "Test", Name: "Test Flow", Version: "active" }),
    downloadIFlow: vi.fn().mockResolvedValue(artifact),
    updateIFlow,
    restoreOriginalIFlow: vi.fn(),
    validateIFlow: vi.fn().mockResolvedValue({ passed: true, errors: [], raw: "Passed" }),
    getConfigurations: vi.fn().mockResolvedValue([
      { ParameterKey: "CM_Set_Target_Configuration_SOURCE_SYSTEM", ParameterValue: "DEV" }
    ]),
    deployIFlow: vi.fn()
  };
}

async function testApp(sap: SapIntegrationClient) {
  const root = await mkdtemp(path.join(os.tmpdir(), "iflow-api-"));
  roots.push(root);
  return createApiApp({ config: serverConfig(), sap, projectRoot: root, log: new StructuredLogger({ log() {}, warn() {}, error() {} }) });
}

describe("iFlow REST API", () => {
  it("reports health and server-managed SAP credentials without exposing secrets", async () => {
    const app = await testApp(fakeSap(zipArtifact(await fixture("content-modifier.iflw"))));
    expect((await request(app).get("/api/health")).body).toEqual({ status: "ok" });
    const response = await request(app).get("/api/sap/status");
    expect(response.body).toMatchObject({ configured: true, credentials: "server-managed" });
    expect(JSON.stringify(response.body)).not.toContain("DO_NOT_EXPOSE_CLIENT_SECRET");
  });

  it("analyzes real Content Modifier candidates without mutating SAP", async () => {
    const updateIFlow = vi.fn();
    const app = await testApp(fakeSap(zipArtifact(await fixture("content-modifier.iflw")), updateIFlow));
    const response = await request(app).post("/api/iflow/analyze").send({
      tenantUrl: "https://tenant.example.com", iflowId: "Test", version: "active"
    });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.summary).toMatchObject({ contentModifierParameters: 3, skippedDynamicExpressions: 1 });
    expect(response.body.parameters).toEqual(expect.arrayContaining([
      expect.objectContaining({ parameterName: "CM_Set_Target_Configuration_API_URL", status: "new" })
    ]));
    expect(updateIFlow).not.toHaveBeenCalled();
  });

  it("never updates SAP through the dry-run endpoint", async () => {
    const updateIFlow = vi.fn();
    const app = await testApp(fakeSap(zipArtifact(await fixture("content-modifier.iflw")), updateIFlow));
    const response = await request(app).post("/api/iflow/dry-run").send({
      iflowId: "Test",
      selectedParameters: ["CM_Set_Target_Configuration_SOURCE_SYSTEM"]
    });
    expect(response.status).toBe(200);
    expect(response.body.outcome).toMatchObject({ uploaded: false, deployed: false, localValidation: "passed" });
    expect(updateIFlow).not.toHaveBeenCalled();
  });

  it("updates only selected parameters and never deploys", async () => {
    const updateIFlow = vi.fn();
    const sap = fakeSap(zipArtifact(await fixture("content-modifier.iflw")), updateIFlow);
    const app = await testApp(sap);
    const response = await request(app).post("/api/iflow/externalize").send({
      iflowId: "Test",
      selectedParameters: ["CM_Set_Target_Configuration_SOURCE_SYSTEM"],
      validate: true
    });
    expect(response.status).toBe(200);
    expect(updateIFlow).toHaveBeenCalledOnce();
    const uploaded = updateIFlow.mock.calls[0]?.[3] as Buffer;
    const xml = readZipEntry(uploaded, "src/main/resources/scenarioflows/integrationflow/Test.iflw").toString("utf8");
    expect(xml).toContain("{{CM_Set_Target_Configuration_SOURCE_SYSTEM}}");
    expect(xml).toContain("https://dev.example.com");
    expect(sap.deployIFlow).not.toHaveBeenCalled();
  });

  it("maps SAP authorization failures to a useful API response", async () => {
    const sap = fakeSap(zipArtifact(await fixture("content-modifier.iflw")));
    sap.downloadIFlow = vi.fn().mockRejectedValue(new SapApiError("forbidden", 403));
    const app = await testApp(sap);
    const response = await request(app).post("/api/iflow/analyze").send({ iflowId: "Test" });
    expect(response.status).toBe(403);
    expect(response.body.error.message).toBe("The configured SAP account is not authorized for this operation.");
  });

  it("blocks the update API unless the server explicitly enables it", async () => {
    const updateIFlow = vi.fn();
    const app = createApiApp({
      config: { ...serverConfig(), enableUpdateApi: false },
      sap: fakeSap(zipArtifact(await fixture("content-modifier.iflw")), updateIFlow),
      log: new StructuredLogger({ log() {}, warn() {}, error() {} })
    });
    const response = await request(app).post("/api/iflow/externalize").send({
      iflowId: "Test", selectedParameters: ["CM_Set_Target_Configuration_SOURCE_SYSTEM"]
    });
    expect(response.status).toBe(403);
    expect(response.body.error.message).toMatch(/updates are disabled/i);
    expect(updateIFlow).not.toHaveBeenCalled();
  });
});
