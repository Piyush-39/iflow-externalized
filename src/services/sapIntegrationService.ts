import axios, { AxiosError, type AxiosRequestConfig, type AxiosResponse } from "axios";
import type { AppConfig } from "../config/env.js";
import type {
  ArtifactMetadata,
  SapConfiguration,
  SapValidationResult
} from "../models/externalization.js";
import type { Logger } from "../utils/logger.js";
import { logger } from "../utils/logger.js";
import { odataEntityPath, odataQueryLiteral } from "../utils/xmlUtils.js";
import { isZipBuffer } from "./zipService.js";
import type { SapAuthService } from "./sapAuthService.js";
import { parseSapValidationResult } from "./validationService.js";

interface CsrfState { token: string; cookie?: string }

export class SapApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly method?: string,
    readonly path?: string
  ) {
    super(message);
    this.name = "SapApiError";
  }
}

function unwrapOData<T>(data: unknown): T {
  if (data && typeof data === "object" && "d" in data) return (data as { d: T }).d;
  return data as T;
}

function resultsOf<T>(data: unknown): T[] {
  const value = unwrapOData<unknown>(data);
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object" && "results" in value) {
    const results = (value as { results: unknown }).results;
    return Array.isArray(results) ? results as T[] : [];
  }
  return [];
}

function base64Candidate(data: unknown): string | undefined {
  if (typeof data === "string") {
    const trimmed = data.trim().replace(/^"|"$/g, "");
    const xmlValue = trimmed.match(/<(?:\w+:)?ArtifactContent[^>]*>([\s\S]*?)<\/(?:\w+:)?ArtifactContent>/i)?.[1];
    return (xmlValue ?? trimmed).replace(/\s/g, "");
  }
  if (!data || typeof data !== "object") return undefined;
  const record = data as Record<string, unknown>;
  return base64Candidate(record.ArtifactContent ?? record.artifactContent ?? record.value ?? record.d);
}

function decodeArtifactResponse(response: AxiosResponse<ArrayBuffer>): Buffer {
  const raw = Buffer.from(response.data);
  if (isZipBuffer(raw)) return raw;
  const contentType = String(response.headers["content-type"] ?? "").toLowerCase();
  let parsed: unknown = raw.toString("utf8");
  if (contentType.includes("json") || /^[\s\r\n]*[{"]/u.test(String(parsed))) {
    try { parsed = JSON.parse(String(parsed)); } catch { /* Fall back to text/base64. */ }
  }
  const encoded = base64Candidate(parsed);
  if (encoded && /^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    const decoded = Buffer.from(encoded, "base64");
    if (isZipBuffer(decoded)) return decoded;
  }
  throw new Error(`SAP download response was not a ZIP or Base64 ZIP (content-type: ${contentType || "missing"})`);
}

export interface SapIntegrationClient {
  getArtifactMetadata(id: string, version: string): Promise<ArtifactMetadata>;
  downloadIFlow(id: string, version: string): Promise<Buffer>;
  updateIFlow(id: string, version: string, name: string, zipBuffer: Buffer): Promise<void>;
  restoreOriginalIFlow(id: string, version: string, name: string, originalZip: Buffer): Promise<void>;
  validateIFlow(id: string, version: string): Promise<SapValidationResult>;
  getConfigurations(id: string, version: string): Promise<SapConfiguration[]>;
  deployIFlow(id: string, version: string): Promise<unknown>;
}

export class SapIntegrationService implements SapIntegrationClient {
  private csrf?: CsrfState;
  private readonly apiRoot: string;

  constructor(
    config: Pick<AppConfig, "sapBaseUrl">,
    private readonly auth: Pick<SapAuthService, "getAccessToken">,
    private readonly log: Logger = logger
  ) {
    this.apiRoot = `${config.sapBaseUrl}/api/v1`;
  }

  async getArtifactMetadata(id: string, version: string): Promise<ArtifactMetadata> {
    try {
      const response = await this.request({
        method: "GET",
        url: `${this.apiRoot}/${odataEntityPath(id, version)}`,
        params: { "$format": "json" }
      });
      const metadata = unwrapOData<ArtifactMetadata>(response.data);
      if (!metadata?.Name) throw new Error("SAP artifact metadata response did not contain Name");
      return metadata;
    } catch (error) {
      if (!(error instanceof SapApiError) || ![404, 405, 501].includes(error.status ?? 0)) throw error;
      this.log.warn("METADATA", `Direct artifact metadata lookup returned HTTP ${error.status}; resolving through integration packages`);
      return this.getArtifactMetadataFromPackages(id, version);
    }
  }

  async downloadIFlow(id: string, version: string): Promise<Buffer> {
    this.log.info("DOWNLOAD", `Downloading ${id}`);
    const response = await this.request<ArrayBuffer>({
      method: "GET",
      url: `${this.apiRoot}/${odataEntityPath(id, version)}/$value`,
      headers: { Accept: "application/zip, application/octet-stream, application/json, text/plain, */*" },
      responseType: "arraybuffer",
      timeout: 90_000
    });
    const buffer = decodeArtifactResponse(response);
    this.log.info("DOWNLOAD", `Artifact downloaded: ${Math.ceil(buffer.length / 1024)} KB`);
    return buffer;
  }

  async updateIFlow(id: string, version: string, name: string, zipBuffer: Buffer): Promise<void> {
    await this.mutatingRequest({
      method: "PUT",
      url: `${this.apiRoot}/${odataEntityPath(id, version)}`,
      data: { Name: name, ArtifactContent: zipBuffer.toString("base64") }
    });
  }

  async restoreOriginalIFlow(id: string, version: string, name: string, originalZip: Buffer): Promise<void> {
    this.log.warn("ROLLBACK", "Restoring original iFlow artifact from backup");
    await this.updateIFlow(id, version, name, originalZip);
  }

  async validateIFlow(id: string, version: string): Promise<SapValidationResult> {
    const response = await this.mutatingRequest({
      method: "POST",
      url: `${this.apiRoot}/ValidateIntegrationDesigntimeArtifact`,
      params: { Id: odataQueryLiteral(id), Version: odataQueryLiteral(version) },
      responseType: "text",
      transformResponse: [(value) => value]
    });
    return parseSapValidationResult(response.data);
  }

  async getConfigurations(id: string, version: string): Promise<SapConfiguration[]> {
    const response = await this.request({
      method: "GET",
      url: `${this.apiRoot}/${odataEntityPath(id, version)}/Configurations`,
      params: { "$format": "json" }
    });
    return resultsOf<SapConfiguration>(response.data);
  }

  async deployIFlow(id: string, version: string): Promise<unknown> {
    const response = await this.mutatingRequest({
      method: "POST",
      url: `${this.apiRoot}/DeployIntegrationDesigntimeArtifact`,
      params: { Id: odataQueryLiteral(id), Version: odataQueryLiteral(version) }
    });
    return response.data;
  }

  private async fetchCsrf(): Promise<CsrfState> {
    const response = await this.request({
      method: "GET",
      // The OData metadata document is a portable CSRF source. Some SAP
      // tenants return 501 for GET on the streamed artifact collection.
      url: `${this.apiRoot}/$metadata`,
      headers: { "X-CSRF-Token": "Fetch", Accept: "application/xml" },
      responseType: "text"
    });
    const token = response.headers["x-csrf-token"];
    if (typeof token !== "string" || !token) throw new Error("SAP did not return an X-CSRF-Token");
    const setCookie = response.headers["set-cookie"] as string[] | undefined;
    const state = { token, ...(setCookie?.length ? { cookie: setCookie.map((item) => item.split(";", 1)[0]).join("; ") } : {}) };
    this.log.info("CSRF", "SAP CSRF token retrieved");
    return state;
  }

  private async mutatingRequest<T = unknown>(config: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    this.csrf ??= await this.fetchCsrf();
    try {
      return await this.request<T>({
        ...config,
        headers: {
          ...config.headers,
          "X-CSRF-Token": this.csrf.token,
          ...(this.csrf.cookie ? { Cookie: this.csrf.cookie } : {})
        }
      });
    } catch (error) {
      if (error instanceof SapApiError && error.status === 403 && /csrf/i.test(error.message)) {
        this.csrf = await this.fetchCsrf();
        return this.request<T>({
          ...config,
          headers: { ...config.headers, "X-CSRF-Token": this.csrf.token, ...(this.csrf.cookie ? { Cookie: this.csrf.cookie } : {}) }
        });
      }
      throw error;
    }
  }

  private async request<T = unknown>(config: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    const token = await this.auth.getAccessToken();
    try {
      return await axios.request<T>({
        timeout: 30_000,
        ...config,
        headers: { Accept: "application/json", ...config.headers, Authorization: `Bearer ${token}` }
      });
    } catch (error) {
      if (error instanceof AxiosError) {
        const sapMessage = this.safeSapError(error.response?.data);
        const method = String(config.method ?? "GET").toUpperCase();
        const requestPath = this.safeRequestPath(config.url);
        const status = error.response?.status;
        throw new SapApiError(
          `SAP API ${method} ${requestPath} failed${status ? ` (HTTP ${status})` : ""}: ${sapMessage || error.message}`,
          status,
          method,
          requestPath
        );
      }
      throw error;
    }
  }

  private async getArtifactMetadataFromPackages(id: string, version: string): Promise<ArtifactMetadata> {
    const packagesResponse = await this.request({
      method: "GET",
      url: `${this.apiRoot}/IntegrationPackages`,
      params: { "$format": "json" }
    });
    const packages = resultsOf<{ Id: string }>(packagesResponse.data).filter((item) => item.Id);
    const matches: ArtifactMetadata[] = [];
    const batchSize = 5;

    for (let offset = 0; offset < packages.length; offset += batchSize) {
      const batch = packages.slice(offset, offset + batchSize);
      const artifactsByPackage = await Promise.all(batch.map(async (item) => {
        const packageId = encodeURIComponent(item.Id.replace(/'/g, "''"));
        const response = await this.request({
          method: "GET",
          url: `${this.apiRoot}/IntegrationPackages('${packageId}')/IntegrationDesigntimeArtifacts`,
          params: { "$format": "json" }
        });
        return resultsOf<ArtifactMetadata>(response.data).filter((artifact) => artifact.Id === id);
      }));
      matches.push(...artifactsByPackage.flat());
    }

    if (matches.length === 0) {
      throw new Error(`SAP design-time artifact '${id}' was not found in any readable integration package`);
    }
    const exactVersion = version.toLowerCase() === "active"
      ? undefined
      : matches.find((artifact) => artifact.Version === version);
    const selected = exactVersion ?? matches.sort((left, right) =>
      right.Version.localeCompare(left.Version, undefined, { numeric: true, sensitivity: "base" })
    )[0]!;
    if (version.toLowerCase() !== "active" && !exactVersion) {
      throw new Error(`SAP design-time artifact '${id}' does not have requested version '${version}'`);
    }
    if (!selected.Name) throw new Error(`SAP design-time artifact '${id}' metadata did not contain Name`);
    this.log.info("METADATA", `Resolved ${selected.Name} from package metadata`, { version: selected.Version, packageId: selected.PackageId });
    return selected;
  }

  private safeRequestPath(url: string | undefined): string {
    if (!url) return "<unknown path>";
    try {
      const parsed = new URL(url);
      return parsed.pathname;
    } catch {
      return url.replace(/[?#].*$/, "");
    }
  }

  private safeSapError(data: unknown): string | undefined {
    if (!data) return undefined;
    if (typeof data === "string") return data.slice(0, 500).replace(/(secret|password|token)\s*[=:]\s*\S+/gi, "$1=[REDACTED]");
    const record = data as Record<string, unknown>;
    const error = record.error as Record<string, unknown> | undefined;
    const message = error?.message;
    if (typeof message === "string") return message;
    if (message && typeof message === "object" && typeof (message as Record<string, unknown>).value === "string") return String((message as Record<string, unknown>).value);
    return "SAP returned an error response";
  }
}
