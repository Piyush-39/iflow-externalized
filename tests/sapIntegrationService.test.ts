import axios, { AxiosError } from "axios";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SapIntegrationService } from "../src/services/sapIntegrationService.js";
import { StructuredLogger } from "../src/utils/logger.js";

afterEach(() => vi.restoreAllMocks());

describe("SAP tenant compatibility", () => {
  it("falls back to package navigation when direct streamed-entity metadata returns 501", async () => {
    const directError = new AxiosError("Not implemented");
    Object.assign(directError, {
      response: {
        status: 501,
        statusText: "Not Implemented",
        headers: {},
        config: {},
        data: { error: { message: { value: "No message reference given. Inherit message is = 'null'" } } }
      }
    });
    const request = vi.spyOn(axios, "request")
      .mockRejectedValueOnce(directError)
      .mockResolvedValueOnce({ status: 200, headers: {}, data: { d: { results: [{ Id: "Test" }] } } } as never)
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        data: { d: { results: [{ Id: "Flow", Name: "My Flow", Version: "1.0.1", PackageId: "Test" }] } }
      } as never);
    const service = new SapIntegrationService(
      { sapBaseUrl: "https://tenant.example.com" },
      { getAccessToken: vi.fn().mockResolvedValue("not-a-real-token") },
      new StructuredLogger({ log: () => undefined, warn: () => undefined, error: () => undefined })
    );

    await expect(service.getArtifactMetadata("Flow", "active")).resolves.toMatchObject({
      Id: "Flow",
      Name: "My Flow",
      Version: "1.0.1",
      PackageId: "Test"
    });
    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls[2]?.[0].url).toContain("IntegrationPackages('Test')/IntegrationDesigntimeArtifacts");
  });

  it("fetches CSRF from OData metadata before updating a streamed artifact", async () => {
    const request = vi.spyOn(axios, "request")
      .mockResolvedValueOnce({
        status: 200,
        headers: { "x-csrf-token": "csrf-value", "set-cookie": ["SESSION=abc; Path=/; Secure"] },
        data: "<metadata/>"
      } as never)
      .mockResolvedValueOnce({ status: 202, headers: {}, data: undefined } as never);
    const service = new SapIntegrationService(
      { sapBaseUrl: "https://tenant.example.com" },
      { getAccessToken: vi.fn().mockResolvedValue("not-a-real-token") },
      new StructuredLogger({ log: () => undefined, warn: () => undefined, error: () => undefined })
    );

    await service.updateIFlow("Flow", "active", "My Flow", Buffer.from("ZIP"));

    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0]?.[0]).toMatchObject({
      method: "GET",
      url: "https://tenant.example.com/api/v1/$metadata",
      headers: expect.objectContaining({ "X-CSRF-Token": "Fetch" })
    });
    expect(request.mock.calls[1]?.[0]).toMatchObject({
      method: "PUT",
      headers: expect.objectContaining({ "X-CSRF-Token": "csrf-value", Cookie: "SESSION=abc" }),
      data: { Name: "My Flow", ArtifactContent: Buffer.from("ZIP").toString("base64") }
    });
  });
});
