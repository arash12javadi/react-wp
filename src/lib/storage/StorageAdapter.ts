/**
 * Media & storage abstraction.
 *
 *  - `LocalStorageAdapter` writes uploaded files to the server's own `uploads/` directory — only
 *    possible on a persistent Node.js host (Docker, VPS, Render with a disk).
 *  - `S3StorageAdapter` writes to any S3-compatible object store (AWS S3, Cloudflare R2, Supabase
 *    Storage, MinIO) — required on serverless and read-only hosts.
 */
export interface PutResult {
  /** A publicly reachable URL for the stored object. */
  url: string;
}

export interface StorageAdapter {
  readonly kind: 'local' | 's3';
  /** True only for local disk storage (persistent hosts). */
  readonly persistent: boolean;

  /** Stores an object under `key` and returns a readable URL. */
  putFile(key: string, body: Uint8Array, contentType?: string): Promise<PutResult>;
  /** Deletes an object; resolves `false` when it did not exist. */
  deleteFile(key: string): Promise<boolean>;
}
