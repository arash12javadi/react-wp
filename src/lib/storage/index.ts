/**
 * Storage adapter factory.
 */
import type { RuntimeConfig } from '../runtime';
import type { StorageAdapter } from './StorageAdapter';
import { LocalStorageAdapter } from './adapters/local';
import { S3StorageAdapter } from './adapters/s3';

export function createStorageAdapter(config: RuntimeConfig): StorageAdapter {
  if (config.storage === 's3') return new S3StorageAdapter(config.s3 || {});
  return new LocalStorageAdapter();
}

export type { StorageAdapter, PutResult } from './StorageAdapter';
export { LocalStorageAdapter } from './adapters/local';
export { S3StorageAdapter } from './adapters/s3';
