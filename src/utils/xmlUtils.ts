import { XMLBuilder, XMLParser, XMLValidator } from "fast-xml-parser";

export const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
  allowBooleanAttributes: true,
  preserveOrder: true,
  commentPropName: "#comment"
});

export const xmlBuilder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  preserveOrder: true,
  commentPropName: "#comment",
  suppressEmptyNode: true,
  format: true,
  indentBy: "  "
});

export function assertValidXml(xml: string, label = "XML"): void {
  const result = XMLValidator.validate(xml, { allowBooleanAttributes: true });
  if (result !== true) {
    throw new Error(`${label} is malformed at line ${result.err.line}, column ${result.err.col}: ${result.err.msg}`);
  }
}

export function localName(qualifiedName: string): string {
  return qualifiedName.includes(":") ? qualifiedName.slice(qualifiedName.indexOf(":") + 1) : qualifiedName;
}

export function escapeODataString(value: string): string {
  return value.replace(/'/g, "''");
}

export function odataEntityPath(id: string, version: string): string {
  const escapedId = encodeURIComponent(escapeODataString(id));
  const escapedVersion = encodeURIComponent(escapeODataString(version));
  return `IntegrationDesigntimeArtifacts(Id='${escapedId}',Version='${escapedVersion}')`;
}

export function odataQueryLiteral(value: string): string {
  return `'${escapeODataString(value)}'`;
}
