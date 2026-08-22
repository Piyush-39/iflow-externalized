import type { ExternalizationRule } from "../models/externalization.js";

const rule = (
  adapterType: string,
  aliases: string[],
  propertyNames: string[],
  sensitive = false
): ExternalizationRule => ({ adapterType, aliases, propertyNames, sensitive, dataType: "xsd:string" });

export const externalizationRules: ExternalizationRule[] = [
  rule("HTTP", ["HTTP", "HTTPS"], ["Address", "URL", "url", "urlPath", "httpAddress", "httpsAddress", "timeout", "authentication", "proxyType"]),
  rule("HTTP", ["HTTP", "HTTPS"], ["credentialName", "credential", "userCredential", "securityMaterial", "keystoreAlias"], true),
  rule("SOAP", ["SOAP", "SOAP1.X", "SOAPRM"], ["Address", "serviceEndpoint", "endpoint", "timeout"]),
  rule("SOAP", ["SOAP", "SOAP1.X", "SOAPRM"], ["credential", "credentialName", "userCredential", "keystoreAlias"], true),
  rule("ODATA", ["ODATA", "ODATAV2", "ODATAV4"], ["Address", "serviceUrl", "url", "authentication"]),
  rule("ODATA", ["ODATA", "ODATAV2", "ODATAV4"], ["credential", "credentialName", "userCredential"], true),
  rule("SFTP", ["SFTP"], ["host", "port", "directory", "path", "user", "proxyType", "timeout"]),
  rule("SFTP", ["SFTP"], ["credential", "credentialName", "userCredential", "privateKeyAlias", "securityMaterial"], true),
  rule("FTP", ["FTP", "FTPS"], ["host", "port", "directory", "path"]),
  rule("FTP", ["FTP", "FTPS"], ["credential", "credentialName", "userCredential"], true),
  rule("MAIL", ["MAIL", "SMTP", "IMAP", "POP3"], ["host", "server", "port", "username", "address", "timeout"]),
  rule("MAIL", ["MAIL", "SMTP", "IMAP", "POP3"], ["credential", "credentialName", "user", "userCredential"], true),
  rule("JMS", ["JMS"], ["queueName"]),
  rule("PROCESSDIRECT", ["PROCESSDIRECT"], ["Address", "address"]),
  rule("XI", ["XI"], ["Address", "url", "proxyType", "timeout", "senderParty", "receiverParty", "senderService", "receiverService", "serviceInterface", "serviceInterfaceNamespace"]),
  rule("XI", ["XI"], ["credential", "credentialName", "privateKeyAlias", "securityMaterial"], true),
  rule("IDOC", ["IDOC"], ["Address", "url", "systemId", "client", "proxyType", "timeout"]),
  rule("IDOC", ["IDOC"], ["credential", "credentialName", "userCredential"], true)
];

export const NEVER_EXTERNALIZE = /^(?:id|processid|sequenceflowid|componentid|processref|sourceref|targetref|componentversion|cmdvarianturi|componentns|componentswcvid|componentswcvname|vendor|name|description|direction|transportprotocol|transportprotocolversion|messageprotocol|messageprotocolversion|ifl:type|namespaceMapping|allowedHeaderList|script|scriptname|mapping|mappingname|resource|filename)$/i;

export function normalizeRuleToken(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

export function findExternalizationRule(adapter: string, propertyName: string): ExternalizationRule | undefined {
  const adapterToken = normalizeRuleToken(adapter);
  const propertyToken = normalizeRuleToken(propertyName);
  return externalizationRules.find((candidate) =>
    candidate.aliases.some((alias) => normalizeRuleToken(alias) === adapterToken) &&
    candidate.propertyNames.some((name) => normalizeRuleToken(name) === propertyToken)
  );
}
