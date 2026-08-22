import { XMLBuilder } from "fast-xml-parser";
import type { ContentModifierSection, SkipReason } from "../models/externalization.js";
import { assertValidXml, localName, xmlParser } from "../utils/xmlUtils.js";
import type { IFlowComponent, IFlowPropertyNode, OrderedXmlNode } from "./iflowParserService.js";
import { readOrderedText, writeOrderedText } from "./iflowParserService.js";

export const MAX_CONTENT_MODIFIER_BODY_EXTERNALIZATION_LENGTH = 200;

export interface ContentModifierField {
  section: ContentModifierSection;
  fieldName: string;
  value: string;
  valueType: string;
  propertyNode: IFlowPropertyNode;
  attributePropertyName: string;
  sensitive: boolean;
  setValue(value: string): void;
}

export interface ContentModifierSkippedField {
  section: ContentModifierSection;
  fieldName: string;
  valueType: string;
  sensitive: boolean;
  reason: SkipReason;
}

export interface ContentModifierInspection {
  fields: ContentModifierField[];
  skipped: ContentModifierSkippedField[];
  commit(): void;
}

export interface ContentModifierOptions {
  externalizeBody?: boolean;
  maxBodyLength?: number;
}

const fragmentBuilder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  preserveOrder: true,
  suppressEmptyNode: true,
  format: false
});

function nodeElementName(node: OrderedXmlNode): string | undefined {
  return Object.keys(node).find((key) => key !== ":@" && !key.startsWith("#"));
}

function elementChildren(node: OrderedXmlNode): OrderedXmlNode[] {
  const name = nodeElementName(node);
  const value = name ? node[name] : undefined;
  return Array.isArray(value) ? value as OrderedXmlNode[] : [];
}

function attributes(node: OrderedXmlNode): Record<string, string> {
  const value = node[":@"];
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, string>
    : {};
}

function property(component: IFlowComponent, name: string): IFlowPropertyNode | undefined {
  return component.properties.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase());
}

export function isContentModifier(component: IFlowComponent): boolean {
  const activityType = property(component, "activityType")?.value ?? "";
  const uri = component.cmdVariantUri ?? "";
  return component.adapterType.toLowerCase() === "enricher"
    && activityType.toLowerCase() === "enricher"
    && /(?:^|\/)ctype::FlowstepVariant\/cname::Enricher(?:\/|$)/i.test(uri)
    && component.properties.some((candidate) => /^(?:headerTable|propertyTable|wrapContent)$/i.test(candidate.name));
}

export function isStaticExternalizableValue(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || /\{\{[^{}]+\}\}/.test(trimmed)) return false;
  if (/\$\{[^{}]*\}|#\{[^{}]*\}/.test(trimmed)) return false;
  if (/^(?:xpath|jsonpath|simple|groovy|script|resource|classpath)\s*:/i.test(trimmed)) return false;
  if (/^(?:\$\.|\$\[|@\.|\/\/)/.test(trimmed)) return false;
  if (/^\/(?:[^/]+\/)*[^/]*(?:\[|@|\(|\)|\s(?:and|or)\s|\s*=)/i.test(trimmed)) return false;
  if (/^<\??[A-Za-z_][\s\S]*>$/m.test(trimmed)) return false;
  if (/\.(?:groovy|gsh|js|xsl|xslt|mmap)$/i.test(trimmed)) return false;
  return true;
}

export function isSensitiveContentModifierField(fieldName: string): boolean {
  return /(?:password|passwd|secret|authorization|auth_token|access_token|client_secret|api[_-]?key|private[_-]?key|credential)/i.test(fieldName);
}

function existingReference(value: string): boolean {
  return /^\s*\{\{[A-Za-z0-9_]+\}\}\s*$/.test(value);
}

function rejectedReason(value: string): SkipReason {
  if (!value.trim()) return "empty";
  if (/\$\{|#\{|^(?:xpath|jsonpath|simple|groovy|script|resource|classpath)\s*:|^(?:\$\.|\$\[|@\.|\/\/)/i.test(value.trim())) {
    return "dynamic-expression";
  }
  return "unsupported-value";
}

interface ParsedTable {
  propertyNode: IFlowPropertyNode;
  document: OrderedXmlNode[];
  wrapper: OrderedXmlNode;
}

function parseTable(propertyNode: IFlowPropertyNode): ParsedTable | undefined {
  if (!propertyNode.value.trim()) return undefined;
  const wrapped = `<table>${propertyNode.value}</table>`;
  assertValidXml(wrapped, `${propertyNode.name} Content Modifier table`);
  const document = xmlParser.parse(wrapped) as OrderedXmlNode[];
  const wrapper = document.find((node) => {
    const name = nodeElementName(node);
    return name ? localName(name) === "table" : false;
  });
  return wrapper ? { propertyNode, document, wrapper } : undefined;
}

function tableRows(table: ParsedTable): OrderedXmlNode[] {
  return elementChildren(table.wrapper).filter((node) => {
    const name = nodeElementName(node);
    return name ? localName(name) === "row" : false;
  });
}

function rowCell(row: OrderedXmlNode, id: string): OrderedXmlNode | undefined {
  return elementChildren(row).find((node) => {
    const name = nodeElementName(node);
    return name && localName(name) === "cell" && attributes(node)["@_id"]?.toLowerCase() === id.toLowerCase();
  });
}

function cellText(cell: OrderedXmlNode | undefined): string {
  return cell ? readOrderedText(elementChildren(cell)) : "";
}

function serializeTable(table: ParsedTable): string {
  const xml = fragmentBuilder.build(table.document) as string;
  return xml.replace(/^<table>/, "").replace(/<\/table>$/, "");
}

function inspectTable(
  table: ParsedTable,
  section: "header" | "property",
  fields: ContentModifierField[],
  skipped: ContentModifierSkippedField[]
): void {
  for (const row of tableRows(table)) {
    const nameCell = rowCell(row, "Name");
    const typeCell = rowCell(row, "Type");
    const valueCell = rowCell(row, "Value");
    const fieldName = cellText(nameCell).trim();
    const valueType = cellText(typeCell).trim();
    const value = cellText(valueCell);
    const sensitive = isSensitiveContentModifierField(fieldName);
    if (!fieldName || !valueCell) {
      skipped.push({ section, fieldName: fieldName || "Unnamed field", valueType, sensitive, reason: "malformed-table" });
      continue;
    }
    if (existingReference(value)) {
      fields.push({
        section, fieldName, value, valueType, sensitive,
        propertyNode: table.propertyNode,
        attributePropertyName: table.propertyNode.name,
        setValue: (next) => writeOrderedText(elementChildren(valueCell), next)
      });
      continue;
    }
    if (valueType.toLowerCase() !== "constant") {
      skipped.push({
        section, fieldName, valueType, sensitive,
        reason: value.trim() ? "dynamic-expression" : "unsupported-type"
      });
      continue;
    }
    if (!isStaticExternalizableValue(value)) {
      skipped.push({ section, fieldName, valueType, sensitive, reason: rejectedReason(value) });
      continue;
    }
    fields.push({
      section, fieldName, value, valueType, sensitive,
      propertyNode: table.propertyNode,
      attributePropertyName: table.propertyNode.name,
      setValue: (next) => writeOrderedText(elementChildren(valueCell), next)
    });
  }
}

export function inspectContentModifier(
  component: IFlowComponent,
  options: ContentModifierOptions = {}
): ContentModifierInspection {
  const fields: ContentModifierField[] = [];
  const skipped: ContentModifierSkippedField[] = [];
  const tables: ParsedTable[] = [];

  for (const [propertyName, section] of [["headerTable", "header"], ["propertyTable", "property"]] as const) {
    const propertyNode = property(component, propertyName);
    if (!propertyNode?.value.trim()) continue;
    try {
      const table = parseTable(propertyNode);
      if (table) {
        tables.push(table);
        inspectTable(table, section, fields, skipped);
      }
    } catch {
      skipped.push({ section, fieldName: propertyName, valueType: "", sensitive: false, reason: "malformed-table" });
    }
  }

  const body = property(component, "wrapContent");
  const bodyType = property(component, "bodyType")?.value ?? "";
  if (body?.value.trim()) {
    const sensitive = false;
    const maximum = options.maxBodyLength ?? MAX_CONTENT_MODIFIER_BODY_EXTERNALIZATION_LENGTH;
    if (existingReference(body.value)) {
      fields.push({
        section: "body", fieldName: "Body", value: body.value, valueType: bodyType, sensitive,
        propertyNode: body, attributePropertyName: body.name,
        setValue: (next) => writeOrderedText(body.valueChildren, next)
      });
    } else if (!options.externalizeBody) {
      skipped.push({ section: "body", fieldName: "Body", valueType: bodyType, sensitive, reason: "body-disabled" });
    } else if (bodyType.toLowerCase() !== "constant") {
      skipped.push({ section: "body", fieldName: "Body", valueType: bodyType, sensitive, reason: "unsupported-type" });
    } else if (body.value.length > maximum) {
      skipped.push({ section: "body", fieldName: "Body", valueType: bodyType, sensitive, reason: "body-too-large" });
    } else if (!isStaticExternalizableValue(body.value) || body.value.includes("\n")) {
      skipped.push({ section: "body", fieldName: "Body", valueType: bodyType, sensitive, reason: rejectedReason(body.value) });
    } else {
      fields.push({
        section: "body", fieldName: "Body", value: body.value, valueType: bodyType, sensitive,
        propertyNode: body, attributePropertyName: body.name,
        setValue: (next) => writeOrderedText(body.valueChildren, next)
      });
    }
  }

  return {
    fields,
    skipped,
    commit: () => {
      for (const table of tables) writeOrderedText(table.propertyNode.valueChildren, serializeTable(table));
    }
  };
}
