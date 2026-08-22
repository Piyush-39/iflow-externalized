import { loadCliConfig } from "./config/env.js";
import { SapAuthService } from "./services/sapAuthService.js";
import { SapIntegrationService } from "./services/sapIntegrationService.js";
import { runExternalization } from "./services/workflowService.js";
import { logger } from "./utils/logger.js";

async function main(): Promise<void> {
  const config = loadCliConfig();
  const auth = new SapAuthService(config, logger);
  const sap = new SapIntegrationService(config, auth, logger);
  await runExternalization({ config, sap, projectRoot: process.cwd(), log: logger });
}

main().catch((error: unknown) => {
  logger.error("FATAL", error instanceof Error ? error.message : "Unknown failure");
  process.exitCode = 1;
});
