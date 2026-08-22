export type LogLevel = "info" | "warn" | "error";

export interface Logger {
  info(scope: string, message: string, details?: Record<string, unknown>): void;
  warn(scope: string, message: string, details?: Record<string, unknown>): void;
  error(scope: string, message: string, details?: Record<string, unknown>): void;
}

const SENSITIVE_KEY = /secret|password|passphrase|private.?key|access.?token|authorization|client.?secret/i;

export function redact(value: unknown, key = ""): unknown {
  if (SENSITIVE_KEY.test(key)) return "[REDACTED]";
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, redact(child, childKey)]));
  }
  return value;
}

export class StructuredLogger implements Logger {
  constructor(private readonly sink: Pick<Console, "log" | "warn" | "error"> = console) {}

  info(scope: string, message: string, details?: Record<string, unknown>): void {
    this.write("info", scope, message, details);
  }

  warn(scope: string, message: string, details?: Record<string, unknown>): void {
    this.write("warn", scope, message, details);
  }

  error(scope: string, message: string, details?: Record<string, unknown>): void {
    this.write("error", scope, message, details);
  }

  private write(level: LogLevel, scope: string, message: string, details?: Record<string, unknown>): void {
    const safeDetails = details ? ` ${JSON.stringify(redact(details))}` : "";
    const line = `[${scope.toUpperCase()}] ${message}${safeDetails}`;
    if (level === "error") this.sink.error(line);
    else if (level === "warn") this.sink.warn(line);
    else this.sink.log(line);
  }
}

export const logger = new StructuredLogger();
