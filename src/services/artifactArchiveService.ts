import { put } from "@vercel/blob";

export type ArtifactArchiveCategory = "backup" | "output" | "report";

export interface ArtifactArchive {
  save(
    category: ArtifactArchiveCategory,
    fileName: string,
    data: Buffer,
    contentType: string
  ): Promise<string>;
}

export class VercelBlobArtifactArchive implements ArtifactArchive {
  constructor(private readonly token = process.env.BLOB_READ_WRITE_TOKEN?.trim()) {}

  async save(
    category: ArtifactArchiveCategory,
    fileName: string,
    data: Buffer,
    contentType: string
  ): Promise<string> {
    if (!this.token) {
      throw new Error(
        "Vercel Blob is not configured. Connect a private Blob store so BLOB_READ_WRITE_TOKEN is available."
      );
    }
    const blob = await put(`iflow-externalizer/${category}/${fileName}`, data, {
      access: "private",
      addRandomSuffix: true,
      contentType,
      token: this.token
    });
    return blob.pathname;
  }
}
