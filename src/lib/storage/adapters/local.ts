/**
 * Local filesystem storage driver.
 *
 * Writes to `<dataDir>/uploads/<key>` and returns `/uploads/<key>` as the public URL. The Hono
 * server (persistent Node mode) serves that directory back out. Only works where `node:fs` exists.
 */
import type { StorageAdapter, PutResult } from '../StorageAdapter';

interface FsPromisesLike {
  mkdir(path: string, options: { recursive: boolean }): Promise<unknown>;
  writeFile(path: string, data: Uint8Array): Promise<unknown>;
  rm(path: string, options: { force: boolean }): Promise<unknown>;
}

export class LocalStorageAdapter implements StorageAdapter {
  readonly kind = 'local' as const;
  readonly persistent = true;

  private readonly root: string;
  private readonly publicPrefix: string;

  constructor(dataDir = process.env.REACT_WP_DATA_DIR || 'data') {
    this.root = `${dataDir.replace(/[\\/]$/, '')}/uploads`;
    this.publicPrefix = '/uploads';
  }

  /** The absolute directory uploads land in (used by the server to serve them). */
  get uploadsDirectory(): string {
    return this.root;
  }

  private async fs(): Promise<FsPromisesLike> {
    const nodeFs = await import('node:fs/promises');
    const nodePath = await import('node:path');
    return {
      mkdir: (path, options) => nodeFs.mkdir(nodePath.resolve(path), options),
      writeFile: (path, data) => nodeFs.writeFile(nodePath.resolve(path), data),
      rm: (path, options) => nodeFs.rm(nodePath.resolve(path), options),
    };
  }

  private safeKey(key: string): string {
    // Prevent path traversal: only allow safe path segments.
    return key.replace(/\.\./g, '').replace(/[\\/]+/g, '/').replace(/^\/+/, '');
  }

  async putFile(key: string, body: Uint8Array): Promise<PutResult> {
    const safe = this.safeKey(key);
    const fs = await this.fs();
    const fullPath = `${this.root}/${safe}`;
    const dir = fullPath.slice(0, fullPath.lastIndexOf('/'));
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(fullPath, body);
    return { url: `${this.publicPrefix}/${safe}` };
  }

  async deleteFile(key: string): Promise<boolean> {
    const safe = this.safeKey(key);
    const fs = await this.fs();
    await fs.rm(`${this.root}/${safe}`, { force: true });
    return true;
  }
}
