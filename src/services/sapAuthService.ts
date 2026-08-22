import axios, { AxiosError } from "axios";
import type { AppConfig } from "../config/env.js";
import { loadServerConfig } from "../config/env.js";
import type { Logger } from "../utils/logger.js";
import { logger } from "../utils/logger.js";

interface TokenResponse {
  access_token: string;
  expires_in?: number;
  token_type?: string;
}

export class SapAuthService {
  private token?: string;
  private expiresAt = 0;
  private inFlight: Promise<string> | undefined;

  constructor(
    private readonly config: Pick<AppConfig, "sapClientId" | "sapClientSecret" | "sapTokenUrl">,
    private readonly log: Logger = logger
  ) {}

  async getAccessToken(): Promise<string> {
    if (this.token && Date.now() < this.expiresAt) return this.token;
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.retrieveToken();
    try {
      return await this.inFlight;
    } finally {
      this.inFlight = undefined;
    }
  }

  private async retrieveToken(): Promise<string> {
    try {
      const response = await axios.post<TokenResponse>(
        this.config.sapTokenUrl,
        new URLSearchParams({ grant_type: "client_credentials" }).toString(),
        {
          auth: { username: this.config.sapClientId, password: this.config.sapClientSecret },
          headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
          timeout: 20_000
        }
      );
      if (!response.data.access_token) throw new Error("OAuth response did not contain access_token");
      const expiresIn = Math.max(1, response.data.expires_in ?? 300);
      const safetyWindow = Math.min(60, Math.max(5, Math.floor(expiresIn * 0.1)));
      this.token = response.data.access_token;
      this.expiresAt = Date.now() + Math.max(1, expiresIn - safetyWindow) * 1000;
      this.log.info("AUTH", "OAuth token retrieved");
      return this.token;
    } catch (error) {
      const status = error instanceof AxiosError ? error.response?.status : undefined;
      const message = error instanceof Error ? error.message : "Unknown OAuth error";
      throw new Error(`SAP OAuth token request failed${status ? ` (HTTP ${status})` : ""}: ${message}`, { cause: error });
    }
  }
}

let defaultService: SapAuthService | undefined;

export async function getAccessToken(): Promise<string> {
  defaultService ??= new SapAuthService(loadServerConfig());
  return defaultService.getAccessToken();
}
