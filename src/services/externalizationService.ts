import { XMLBuilder, XMLParser } from "fast-xml-parser";
import type {
  ArtifactExternalizationResult,
  ExistingParameter,
  ExternalizedParameter,
  SkippedExternalization
} from "../models/externalization.js";
import { findExternalizationRule, NEVER_EXTERNALIZE } from "../rules/externalizationRules.js";
import {
  buildContentModifierParameterBaseName,
  buildParameterBaseName,
  ParameterNameRegistry
} from "../utils/parameterName.js";
import { assertValidXml } from "../utils/xmlUtils.js";
import {
  inspectContentModifier,
  isContentModifier,
  isStaticExternalizableValue
} from "./contentModifierService.js";
import { parseIFlow, serializeIFlow, writeOrderedText } from "./iflowParserService.js";

export interface ExternalizationResources {
  parametersProperties?: string | undefined;
  parametersDefinitionXml?: string | undefined;
}

export interface ExternalizationOptions {
  applyChanges?: boolean;
  selectedParameters?: readonly string[];
  externalizeContentModifierBody?: boolean;
  maxContentModifierBodyLength?: number;
}

interface ParameterReference {
  attributeCategory: string;
  attributeId: string;
  attributeUiLabel: string;
  paramKey: string;
}

interface ParameterDefinition {
  name: string;
  type: string;
}

const PARAMETER_REFERENCE = /\{\{([A-Za-z0-9_]+)\}\}/;

function parseProperties(source = ""): Map<string, string> {
  const values = new Map<string, string>();
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  for (const line of lines) {
    const trimmed = line.trimStart();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("!")) continue;
    let separator = -1;
    let escaped = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index]!;
      if (!escaped && (char === "=" || char === ":" || /\s/.test(char))) { separator = index; break; }
      escaped = !escaped && char === "\\";
      if (char !== "\\") escaped = false;
    }
    const rawKey = separator < 0 ? line : line.slice(0, separator);
    let rawValue = separator < 0 ? "" : line.slice(separator + 1);
    rawValue = rawValue.replace(/^\s*[=:]?\s*/, "");
    values.set(unescapeProperty(rawKey.trim()), unescapeProperty(rawValue));
  }
  return values;
}

function unescapeProperty(value: string): string {
  return value.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\([nrtf\\:=#! ])/g, (_, char: string) => ({ n: "\n", r: "\r", t: "\t", f: "\f" }[char] ?? char));
}

function escapeProperty(value: string, key = false): string {
  let escaped = value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
  escaped = escaped.replace(/([:=])/g, "\\$1");
  if (key) escaped = escaped.replace(/ /g, "\\ ").replace(/^([#!])/, "\\$1");
  else escaped = escaped.replace(/^ /, "\\ ");
  return escaped;
}

function appendProperties(source: string, additions: ExternalizedParameter[]): string {
  if (additions.length === 0) return source;
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const existing = parseProperties(source);
  const lines = additions
    .filter((parameter) => !existing.has(parameter.parameterName))
    .map((parameter) => `${escapeProperty(parameter.parameterName, true)}=${escapeProperty(parameter.originalValue)}`);
  if (lines.length === 0) return source;
  const prefix = source.length > 0 && !source.endsWith("\n") && !source.endsWith("\r") ? newline : "";
  return `${source}${prefix}${lines.join(newline)}${newline}`;
}

const propdefParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
  parseTagValue: false,
  isArray: (name) => name === "parameter" || name === "reference"
});

const propdefBuilder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  format: true,
  indentBy: "  ",
  suppressEmptyNode: true
});

function emptyPropdef(): Record<string, unknown> {
  return {
    "?xml": { "@_version": "1.0", "@_encoding": "UTF-8", "@_standalone": "no" },
    parameters: { parameter: [], param_references: { reference: [] } }
  };
}

function parsePropdef(source?: string): Record<string, unknown> {
  if (!source?.trim()) return emptyPropdef();
  assertValidXml(source, "parameters.propdef");
  const parsed = propdefParser.parse(source) as Record<string, unknown>;
  if (!parsed.parameters || typeof parsed.parameters !== "object") throw new Error("parameters.propdef must have a <parameters> root");
  return parsed;
}

function propdefRoot(document: Record<string, unknown>): Record<string, unknown> {
  return document.parameters as Record<string, unknown>;
}

function definitionsFrom(document: Record<string, unknown>): ParameterDefinition[] {
  const root = propdefRoot(document);
  const parameters = Array.isArray(root.parameter) ? root.parameter as Record<string, unknown>[] : [];
  return parameters.map((item) => ({ name: String(item.name ?? ""), type: String(item.type ?? "xsd:string") })).filter((item) => item.name);
}

function referencesFrom(document: Record<string, unknown>): ParameterReference[] {
  const root = propdefRoot(document);
  const container = root.param_references && typeof root.param_references === "object"
    ? root.param_references as Record<string, unknown>
    : {};
  const references = Array.isArray(container.reference) ? container.reference as Record<string, unknown>[] : [];
  return references.map((item) => ({
    attributeCategory: String(item["@_attribute_category"] ?? ""),
    attributeId: String(item["@_attribute_id"] ?? ""),
    attributeUiLabel: String(item["@_attribute_uilabel"] ?? ""),
    paramKey: String(item["@_param_key"] ?? "")
  })).filter((item) => item.paramKey);
}

function addPropdefEntries(document: Record<string, unknown>, additions: ExternalizedParameter[]): string {
  const root = propdefRoot(document);
  const parameters = Array.isArray(root.parameter) ? root.parameter as Record<string, unknown>[] : [];
  root.parameter = parameters;
  const definitions = new Set(definitionsFrom(document).map((item) => item.name));
  let referenceContainer = root.param_references as Record<string, unknown> | undefined;
  if (!referenceContainer || typeof referenceContainer !== "object") {
    referenceContainer = { reference: [] };
    root.param_references = referenceContainer;
  }
  const references = Array.isArray(referenceContainer.reference) ? referenceContainer.reference as Record<string, unknown>[] : [];
  referenceContainer.reference = references;
  const referenceKeys = new Set(referencesFrom(document).map((item) => `${item.paramKey}\u0000${item.attributeCategory}\u0000${item.attributeId}`));

  for (const addition of additions) {
    if (!definitions.has(addition.parameterName)) {
      parameters.push({
        key: "",
        name: addition.parameterName,
        type: addition.dataType ?? "xsd:string",
        isRequired: "false",
        constraint: "",
        description: "",
        additionalMetadata: ""
      });
      definitions.add(addition.parameterName);
    }
    const referenceKey = `${addition.parameterName}\u0000${addition.attributeCategory}\u0000${addition.attributeId}`;
    if (!referenceKeys.has(referenceKey)) {
      references.push({
        "@_attribute_category": addition.attributeCategory ?? "",
        "@_attribute_id": addition.attributeId ?? "",
        "@_attribute_uilabel": addition.attributeUiLabel ?? addition.propertyName,
        "@_param_key": addition.parameterName
      });
      referenceKeys.add(referenceKey);
    }
  }
  const xml = propdefBuilder.build(document) as string;
  assertValidXml(xml, "generated parameters.propdef");
  return xml;
}

function propertyDisplayName(propertyName: string): string {
  const known: Record<string, string> = {
    urlpath: "Address", address: "Address", credentialname: "Credential Name",
    credential: "Credential Name", server: "Address", servicurl: "Service URL",
    serviceurl: "Service URL", queuename: "Queue Name", proxytype: "Proxy Type"
  };
  return known[propertyName.replace(/[^A-Za-z0-9]/g, "").toLowerCase()] ?? propertyName;
}

function parameterPropertyName(propertyName: string): string {
  const token = propertyName.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
  if (["credential", "credentialname", "usercredential", "securitymaterial", "keystorealias", "privatekeyalias"].includes(token)) return "Credential";
  if (["url", "urlpath", "httpaddress", "httpsaddress", "serviceurl", "serviceendpoint", "endpoint"].includes(token)) return "Address";
  return propertyDisplayName(propertyName);
}

function externalReferenceName(value: string): string | undefined {
  return value.match(PARAMETER_REFERENCE)?.[1];
}

export async function externalizeIFlow(iflowXml: string): Promise<ArtifactExternalizationResult> {
  return externalizeArtifactFiles(iflowXml, {}, {});
}

export async function externalizeArtifactFiles(
  iflowXml: string,
  resources: ExternalizationResources,
  options: ExternalizationOptions = {}
): Promise<ArtifactExternalizationResult> {
  const parsed = parseIFlow(iflowXml);
  const defaults = parseProperties(resources.parametersProperties);
  const propdef = parsePropdef(resources.parametersDefinitionXml);
  const definitions = definitionsFrom(propdef);
  const references = referencesFrom(propdef);
  const names = new Set<string>([...defaults.keys(), ...definitions.map((item) => item.name), ...references.map((item) => item.paramKey)]);
  const existingParameters = new Map<string, ExistingParameter>();
  const registry = new ParameterNameRegistry(names);
  const parameters: ExternalizedParameter[] = [];
  const skipped: SkippedExternalization[] = [];
  let externalizableProperties = 0;
  const selected = options.selectedParameters ? new Set(options.selectedParameters) : undefined;
  const shouldApply = (parameterName: string): boolean =>
    (options.applyChanges ?? true) && (!selected || selected.has(parameterName));

  const rememberExisting = (
    name: string,
    componentId: string,
    propertyName: string
  ): void => {
    names.add(name);
    if (existingParameters.has(name)) return;
    const existing: ExistingParameter = { name, location: `${componentId}.${propertyName}` };
    const defaultValue = defaults.get(name);
    if (defaultValue !== undefined) existing.value = defaultValue;
    existingParameters.set(name, existing);
  };

  for (const component of parsed.components) {
    if (isContentModifier(component)) {
      const inspection = inspectContentModifier(component, {
        externalizeBody: options.externalizeContentModifierBody ?? false,
        ...(options.maxContentModifierBodyLength !== undefined
          ? { maxBodyLength: options.maxContentModifierBodyLength }
          : {})
      });
      for (const item of inspection.skipped) {
        skipped.push({
          sourceType: "content-modifier",
          componentName: component.componentName,
          componentId: component.componentId,
          propertyName: item.fieldName,
          section: item.section,
          valueType: item.valueType,
          reason: item.reason,
          sensitive: item.sensitive
        });
      }
      let componentChanged = false;
      for (const field of inspection.fields) {
        const existingName = externalReferenceName(field.value);
        externalizableProperties += 1;
        if (existingName) {
          rememberExisting(existingName, component.componentId, `${field.attributePropertyName}.${field.fieldName}`);
          parameters.push({
            parameterName: existingName,
            originalValue: defaults.get(existingName) ?? "",
            sourceType: "content-modifier",
            componentName: component.componentName,
            componentId: component.componentId,
            propertyName: field.fieldName,
            section: field.section,
            direction: "step",
            alreadyExternalized: true,
            sensitive: field.sensitive,
            dataType: "xsd:string",
            applied: false
          });
          continue;
        }
        if (!component.cmdVariantUri) {
          throw new Error(`Cannot safely externalize ${component.componentId}.${field.fieldName}: Content Modifier cmdVariantUri is missing`);
        }
        const parameterName = registry.reserve(
          buildContentModifierParameterBaseName(component.componentName || component.componentId, field.fieldName),
          { componentId: component.componentId, propertyName: `${field.attributePropertyName}.${field.fieldName}` }
        );
        const applied = shouldApply(parameterName);
        const parameter: ExternalizedParameter = {
          parameterName,
          originalValue: field.value,
          sourceType: "content-modifier",
          componentName: component.componentName,
          componentId: component.componentId,
          propertyName: field.fieldName,
          section: field.section,
          direction: "step",
          alreadyExternalized: false,
          sensitive: field.sensitive,
          dataType: "xsd:string",
          attributeCategory: component.componentName || component.componentId,
          attributeId: `${component.cmdVariantUri.replace(/\/$/, "")}/attrId::${field.attributePropertyName}`,
          attributeUiLabel: field.fieldName,
          applied
        };
        if (applied) {
          field.setValue(`{{${parameterName}}}`);
          componentChanged = true;
        }
        parameters.push(parameter);
        names.add(parameterName);
      }
      if (componentChanged) inspection.commit();
      continue;
    }

    for (const property of component.properties) {
      const existingName = externalReferenceName(property.value);
      if (existingName) {
        rememberExisting(existingName, component.componentId, property.name);
      }

      if (NEVER_EXTERNALIZE.test(property.name)) continue;
      const rule = findExternalizationRule(component.adapterType, property.name);
      if (!rule) continue;
      if (!property.value.trim()) {
        skipped.push({
          sourceType: "adapter", adapterType: rule.adapterType,
          componentName: component.componentName, componentId: component.componentId,
          propertyName: property.name, reason: "empty", sensitive: rule.sensitive ?? false
        });
        continue;
      }
      externalizableProperties += 1;

      if (existingName) {
        parameters.push({
          parameterName: existingName,
          originalValue: defaults.get(existingName) ?? "",
          sourceType: "adapter",
          adapterType: rule.adapterType,
          componentName: component.componentName,
          componentId: component.componentId,
          propertyName: property.name,
          direction: component.direction,
          alreadyExternalized: true,
          sensitive: rule.sensitive ?? false,
          dataType: rule.dataType ?? "xsd:string",
          applied: false
        });
        continue;
      }

      if (!isStaticExternalizableValue(property.value)) {
        skipped.push({
          sourceType: "adapter", adapterType: rule.adapterType,
          componentName: component.componentName, componentId: component.componentId,
          propertyName: property.name, reason: "dynamic-expression", sensitive: rule.sensitive ?? false
        });
        externalizableProperties -= 1;
        continue;
      }

      if (!component.cmdVariantUri) {
        throw new Error(`Cannot safely externalize ${component.componentId}.${property.name}: adapter cmdVariantUri is missing`);
      }
      const parameterName = registry.reserve(
        buildParameterBaseName(component.direction, component.componentName, rule.adapterType, parameterPropertyName(property.name)),
        { componentId: component.componentId, propertyName: property.name }
      );
      const parameter: ExternalizedParameter = {
        parameterName,
        originalValue: property.value,
        sourceType: "adapter",
        adapterType: rule.adapterType,
        componentName: component.componentName,
        componentId: component.componentId,
        propertyName: property.name,
        direction: component.direction,
        alreadyExternalized: false,
        sensitive: rule.sensitive ?? false,
        dataType: rule.dataType ?? "xsd:string",
        attributeCategory: component.attributeCategory,
        attributeId: `${component.cmdVariantUri.replace(/\/$/, "")}/attrId::${property.name}`,
        attributeUiLabel: propertyDisplayName(property.name),
        applied: shouldApply(parameterName)
      };
      if (parameter.applied) writeOrderedText(property.valueChildren, `{{${parameterName}}}`);
      parameters.push(parameter);
      names.add(parameterName);
    }
  }

  const additions = parameters.filter((parameter) => !parameter.alreadyExternalized && parameter.applied);
  const modifiedXml = additions.length > 0 ? serializeIFlow(parsed) : iflowXml;
  const parametersProperties = appendProperties(resources.parametersProperties ?? "", additions);
  const parametersDefinitionXml = additions.length > 0
    ? addPropdefEntries(propdef, additions)
    : resources.parametersDefinitionXml ?? (propdefBuilder.build(propdef) as string);

  return {
    modifiedXml,
    parametersProperties,
    parametersDefinitionXml,
    parameters,
    existingParameters: [...existingParameters.values()],
    changed: additions.length > 0,
    detectedComponents: parsed.components.length,
    externalizableProperties,
    skipped
  };
}
