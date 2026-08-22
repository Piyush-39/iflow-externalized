import type { Direction } from "../models/externalization.js";

export function sanitizeParameterPart(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9_]+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "") || "Component";
}

const MAX_PARAMETER_NAME_LENGTH = 120;

function titlePart(value: string): string {
  const sanitized = sanitizeParameterPart(value);
  return sanitized.length ? sanitized[0]!.toUpperCase() + sanitized.slice(1) : "Property";
}

export interface ParameterIdentity {
  componentId: string;
  propertyName: string;
}

export class ParameterNameRegistry {
  private readonly identities = new Map<string, ParameterIdentity>();

  constructor(existingNames: Iterable<string> = []) {
    for (const name of existingNames) this.identities.set(name, { componentId: "existing", propertyName: "existing" });
  }

  reserve(baseName: string, identity: ParameterIdentity): string {
    const base = sanitizeParameterPart(baseName).slice(0, MAX_PARAMETER_NAME_LENGTH).replace(/_+$/, "") || "Parameter";
    let candidate = base;
    let suffix = 2;
    while (this.identities.has(candidate)) {
      const current = this.identities.get(candidate);
      if (current?.componentId === identity.componentId && current.propertyName === identity.propertyName) return candidate;
      const suffixValue = `_${suffix++}`;
      candidate = `${base.slice(0, MAX_PARAMETER_NAME_LENGTH - suffixValue.length).replace(/_+$/, "")}${suffixValue}`;
    }
    this.identities.set(candidate, identity);
    return candidate;
  }
}

export function buildContentModifierParameterBaseName(stepName: string, fieldName: string): string {
  return ["CM", sanitizeParameterPart(stepName), sanitizeParameterPart(fieldName)].join("_");
}

export function buildParameterBaseName(
  direction: Direction,
  componentName: string,
  adapterType: string,
  propertyName: string
): string {
  const prefix = titlePart(direction);
  const generic = normalizeForComparison(componentName) === normalizeForComparison(direction);
  const component = generic ? adapterType : componentName;
  return [prefix, sanitizeParameterPart(component), titlePart(propertyName)].join("_");
}

function normalizeForComparison(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
}
