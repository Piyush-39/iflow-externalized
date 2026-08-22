import "dotenv/config";

export interface ServerConfig {
  sapBaseUrl: string;
  sapClientId: string;
  sapClientSecret: string;
  sapTokenUrl: string;
  deployAfterUpdate: boolean;
  autoRollbackOnFailure: boolean;
  externalizeContentModifierBody: boolean;
  enableUpdateApi: boolean;
}

export interface AppConfig extends ServerConfig {
  iflowId: string;
  iflowVersion: string;
  dryRun: boolean;
}

function required(name: string, source: NodeJS.ProcessEnv): string {
  const value = source[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function booleanValue(name: string, defaultValue: boolean, source: NodeJS.ProcessEnv): boolean {
  const raw = source[name]?.trim().toLowerCase();
  if (!raw) return defaultValue;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`${name} must be either true or false`);
}

function validUrl(name: string, value: string): string {
  try {
    return new URL(value).toString().replace(/\/$/, "");
  } catch {
    throw new Error(`${name} must be a valid absolute URL`);
  }
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    ...loadServerConfig(source),
    iflowId: required("SAP_IFLOW_ID", source),
    iflowVersion: source.SAP_IFLOW_VERSION?.trim() || "active",
    dryRun: booleanValue("DRY_RUN", true, source)
  };
}

export function loadCliConfig(args: readonly string[] = process.argv.slice(2), source: NodeJS.ProcessEnv = process.env): AppConfig {
  let iflowId = source.SAP_IFLOW_ID?.trim() ?? "";
  let iflowVersion = source.SAP_IFLOW_VERSION?.trim() || "active";
  let dryRun = booleanValue("DRY_RUN", true, source);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--id" || argument === "--version") {
      const value = args[index + 1]?.trim();
      if (!value) throw new Error(`${argument} requires a value`);
      if (argument === "--id") iflowId = value;
      else iflowVersion = value;
      index += 1;
    } else if (argument === "--dry-run") {
      dryRun = true;
    } else if (argument === "--update") {
      dryRun = false;
    } else {
      throw new Error(`Unknown CLI argument: ${argument}`);
    }
  }
  if (!iflowId) throw new Error("Missing iFlow ID. Set SAP_IFLOW_ID or pass --id <id>");
  return { ...loadServerConfig(source), iflowId, iflowVersion, dryRun };
}

export function loadServerConfig(source: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    sapBaseUrl: validUrl("SAP_IS_BASE_URL", required("SAP_IS_BASE_URL", source)),
    sapClientId: required("SAP_CLIENT_ID", source),
    sapClientSecret: required("SAP_CLIENT_SECRET", source),
    sapTokenUrl: validUrl("SAP_TOKEN_URL", required("SAP_TOKEN_URL", source)),
    deployAfterUpdate: booleanValue("DEPLOY_AFTER_UPDATE", false, source),
    autoRollbackOnFailure: booleanValue("AUTO_ROLLBACK_ON_FAILURE", false, source),
    externalizeContentModifierBody: booleanValue("EXTERNALIZE_CONTENT_MODIFIER_BODY", false, source),
    enableUpdateApi: booleanValue("ENABLE_UPDATE_API", false, source)
  };
}
