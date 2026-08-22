import type { Direction } from "../models/externalization.js";
import { assertValidXml, localName, xmlBuilder, xmlParser } from "../utils/xmlUtils.js";

export type OrderedXmlNode = Record<string, unknown>;

export interface IFlowPropertyNode {
  name: string;
  value: string;
  valueChildren: OrderedXmlNode[];
}

export interface IFlowComponent {
  adapterType: string;
  componentName: string;
  componentId: string;
  attributeCategory: string;
  direction: Direction;
  cmdVariantUri?: string;
  properties: IFlowPropertyNode[];
}

export interface ParsedIFlow {
  document: OrderedXmlNode[];
  components: IFlowComponent[];
}

const COMPONENT_TAGS = new Set([
  "messageFlow", "serviceTask", "callActivity", "startEvent", "endEvent",
  "intermediateCatchEvent", "intermediateThrowEvent", "participant"
]);

function nodeElementName(node: OrderedXmlNode): string | undefined {
  return Object.keys(node).find((key) => key !== ":@" && !key.startsWith("#"));
}

function elementChildren(node: OrderedXmlNode): OrderedXmlNode[] {
  const name = nodeElementName(node);
  const value = name ? node[name] : undefined;
  return Array.isArray(value) ? value as OrderedXmlNode[] : [];
}

function attributes(node: OrderedXmlNode): Record<string, string> {
  const raw = node[":@"];
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, string> : {};
}

export function readOrderedText(children: OrderedXmlNode[]): string {
  return children.map((child) => typeof child["#text"] === "string" ? child["#text"] : "").join("").trim();
}

export function writeOrderedText(children: OrderedXmlNode[], value: string): void {
  const textNodes = children.filter((child) => typeof child["#text"] === "string");
  if (textNodes.length === 0) {
    children.push({ "#text": value });
    return;
  }
  const first = textNodes[0]!;
  const current = String(first["#text"]);
  const leading = current.match(/^\s*/)?.[0] ?? "";
  const trailing = current.match(/\s*$/)?.[0] ?? "";
  first["#text"] = `${leading}${value}${trailing}`;
  for (const extra of textNodes.slice(1)) extra["#text"] = "";
}

function findElements(nodes: OrderedXmlNode[], expectedLocalName: string): OrderedXmlNode[] {
  const found: OrderedXmlNode[] = [];
  const visit = (items: OrderedXmlNode[]): void => {
    for (const item of items) {
      const name = nodeElementName(item);
      if (!name) continue;
      if (localName(name) === expectedLocalName) found.push(item);
      visit(elementChildren(item));
    }
  };
  visit(nodes);
  return found;
}

function readProperties(componentNode: OrderedXmlNode): IFlowPropertyNode[] {
  return findElements(elementChildren(componentNode), "property").flatMap((propertyNode) => {
    const children = elementChildren(propertyNode);
    const keyNode = children.find((node) => {
      const name = nodeElementName(node);
      return name ? localName(name) === "key" : false;
    });
    const valueNode = children.find((node) => {
      const name = nodeElementName(node);
      return name ? localName(name) === "value" : false;
    });
    if (!keyNode || !valueNode) return [];
    const name = readOrderedText(elementChildren(keyNode));
    if (!name) return [];
    const valueChildren = elementChildren(valueNode);
    return [{ name, value: readOrderedText(valueChildren), valueChildren }];
  });
}

function valueOf(properties: IFlowPropertyNode[], ...keys: string[]): string | undefined {
  const wanted = new Set(keys.map((key) => key.toLowerCase()));
  return properties.find((property) => wanted.has(property.name.toLowerCase()))?.value || undefined;
}

function adapterFrom(properties: IFlowPropertyNode[]): string | undefined {
  const explicit = valueOf(properties, "ComponentType", "componentType");
  if (explicit) return explicit;
  const uri = valueOf(properties, "cmdVariantUri");
  return uri?.match(/(?:^|\/)cname::([^/]+)/i)?.[1];
}

function directionFrom(properties: IFlowPropertyNode[], attrs: Record<string, string>): Direction {
  const raw = valueOf(properties, "direction")
    ?? valueOf(properties, "cmdVariantUri")?.match(/direction::([^/]+)/i)?.[1]
    ?? attrs["@_ifl:type"]
    ?? "step";
  if (/sender/i.test(raw)) return "sender";
  if (/receiv/i.test(raw)) return "receiver";
  return "step";
}

function collectParticipants(document: OrderedXmlNode[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const participant of findElements(document, "participant")) {
    const attrs = attributes(participant);
    const id = attrs["@_id"];
    if (id) result.set(id, attrs["@_name"] || id);
  }
  return result;
}

function connectedComponentName(
  attrs: Record<string, string>,
  direction: Direction,
  participants: Map<string, string>,
  adapter: string
): string {
  const participantRef = direction === "sender" ? attrs["@_sourceRef"] : direction === "receiver" ? attrs["@_targetRef"] : undefined;
  return (participantRef ? participants.get(participantRef) : undefined) || attrs["@_name"] || adapter;
}

export function parseIFlow(iflowXml: string): ParsedIFlow {
  assertValidXml(iflowXml, ".iflw XML");
  const document = xmlParser.parse(iflowXml) as OrderedXmlNode[];
  const participants = collectParticipants(document);
  const components: IFlowComponent[] = [];

  const visit = (nodes: OrderedXmlNode[]): void => {
    for (const node of nodes) {
      const qualifiedName = nodeElementName(node);
      if (!qualifiedName) continue;
      if (COMPONENT_TAGS.has(localName(qualifiedName))) {
        const properties = readProperties(node);
        const adapter = adapterFrom(properties);
        if (adapter) {
          const attrs = attributes(node);
          const direction = directionFrom(properties, attrs);
          const componentName = connectedComponentName(attrs, direction, participants, adapter);
          const system = valueOf(properties, "system");
          const cmdVariantUri = valueOf(properties, "cmdVariantUri");
          components.push({
            adapterType: adapter,
            componentName,
            componentId: attrs["@_id"] || componentName,
            attributeCategory: componentName || system || adapter,
            direction,
            ...(cmdVariantUri ? { cmdVariantUri } : {}),
            properties
          });
        }
      }
      visit(elementChildren(node));
    }
  };
  visit(document);
  return { document, components };
}

export function serializeIFlow(parsed: ParsedIFlow): string {
  const xml = xmlBuilder.build(parsed.document) as string;
  assertValidXml(xml, "serialized .iflw XML");
  return xml;
}

export function countElementByLocalName(iflowXml: string, expected: string): number {
  const parsed = parseIFlow(iflowXml);
  return findElements(parsed.document, expected).length;
}
