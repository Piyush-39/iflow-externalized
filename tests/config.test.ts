import { describe, expect, it } from "vitest";
import { loadCliConfig } from "../src/config/env.js";

const environment = {
  SAP_IS_BASE_URL: "https://tenant.example.com",
  SAP_CLIENT_ID: "client",
  SAP_CLIENT_SECRET: "secret",
  SAP_TOKEN_URL: "https://auth.example.com/token",
  DRY_RUN: "false"
};

describe("CLI configuration", () => {
  it("supports an iFlow ID and safe dry-run override from command-line arguments", () => {
    const config = loadCliConfig(["--id", "OrderProcessing", "--version", "active", "--dry-run"], environment);
    expect(config).toMatchObject({ iflowId: "OrderProcessing", iflowVersion: "active", dryRun: true });
  });

  it("rejects unknown arguments", () => {
    expect(() => loadCliConfig(["--deploy"], environment)).toThrow(/Unknown CLI argument/);
  });
});
