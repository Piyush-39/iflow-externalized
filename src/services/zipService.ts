import AdmZip from "adm-zip";
import { mkdtemp, readdir, stat } from "node:fs/promises";
import path from "node:path";

export interface ExtractedIFlow {
  directory: string;
  iflowPath: string;
  iflowRelativePath: string;
  fileList: string[];
}

function normalizedEntryName(name: string): string {
  return name.replace(/\\/g, "/").replace(/^\.\//, "");
}

function assertSafeEntry(name: string): void {
  const normalized = normalizedEntryName(name);
  if (path.posix.isAbsolute(normalized) || normalized.split("/").includes("..")) {
    throw new Error(`Unsafe ZIP entry path: ${name}`);
  }
}

export function listZipFiles(zipBuffer: Buffer): string[] {
  const zip = new AdmZip(zipBuffer);
  return zip.getEntries()
    .filter((entry) => !entry.isDirectory)
    .map((entry) => normalizedEntryName(entry.entryName))
    .sort();
}

export function locateIFlowPath(fileList: string[]): string {
  const candidates = fileList.filter((file) => file.toLowerCase().endsWith(".iflw"));
  if (candidates.length === 0) throw new Error("No .iflw file exists in the downloaded artifact");
  if (candidates.length === 1) return candidates[0]!;
  const canonical = candidates.filter((file) => /(?:^|\/)src\/main\/resources\/scenarioflows\/integrationflow\/[^/]+\.iflw$/i.test(file));
  if (canonical.length === 1) return canonical[0]!;
  throw new Error(`Multiple .iflw candidates cannot be resolved safely: ${candidates.join(", ")}`);
}

export async function extractIFlow(zipBuffer: Buffer, tempRoot = path.resolve(".tmp")): Promise<ExtractedIFlow> {
  const zip = new AdmZip(zipBuffer);
  for (const entry of zip.getEntries()) assertSafeEntry(entry.entryName);
  const directory = await mkdtemp(path.join(tempRoot, "iflow-"));
  zip.extractAllTo(directory, true);
  const fileList = listZipFiles(zipBuffer);
  const iflowRelativePath = locateIFlowPath(fileList);
  return {
    directory,
    iflowRelativePath,
    iflowPath: path.join(directory, ...iflowRelativePath.split("/")),
    fileList
  };
}

async function addDirectory(zip: AdmZip, root: string, current: string): Promise<void> {
  const entries = await readdir(current);
  for (const name of entries.sort()) {
    const absolute = path.join(current, name);
    const info = await stat(absolute);
    const relative = normalizedEntryName(path.relative(root, absolute));
    if (info.isDirectory()) await addDirectory(zip, root, absolute);
    else if (info.isFile()) zip.addLocalFile(absolute, path.posix.dirname(relative) === "." ? "" : path.posix.dirname(relative));
  }
}

export async function createIFlowZip(directory: string): Promise<Buffer> {
  const zip = new AdmZip();
  await addDirectory(zip, directory, directory);
  return zip.toBuffer();
}

export function readZipEntry(zipBuffer: Buffer, entryName: string): Buffer {
  const zip = new AdmZip(zipBuffer);
  const entry = zip.getEntry(entryName);
  if (!entry || entry.isDirectory) throw new Error(`ZIP entry not found: ${entryName}`);
  return entry.getData();
}

export function isZipBuffer(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && [0x03, 0x05, 0x07].includes(buffer[2]!) && [0x04, 0x06, 0x08].includes(buffer[3]!);
}
