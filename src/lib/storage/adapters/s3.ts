/**
 * S3-compatible object storage driver (AWS S3, Cloudflare R2, Supabase Storage, MinIO, …).
 * Loaded lazily via `@aws-sdk/client-s3` so the dependency never touches other bundles.
 */
import type { StorageAdapter, PutResult } from '../StorageAdapter';
import type { S3Config } from '../../runtime';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type S3ClientLike = { send(command: any): Promise<any> };

export class S3StorageAdapter implements StorageAdapter {
  readonly kind = 's3' as const;
  readonly persistent = false;

  private readonly config: S3Config;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: S3ClientLike | null = null;

  constructor(config: S3Config) {
    if (!config?.bucket) throw new Error('S3 storage requires a bucket name.');
    this.config = config;
  }

  private async getClient(): Promise<S3ClientLike> {
    if (!this.client) {
      const { S3Client } = await import('@aws-sdk/client-s3');
      this.client = new S3Client({
        region: this.config.region || 'auto',
        endpoint: this.config.endpoint,
        forcePathStyle: this.config.forcePathStyle,
        credentials: this.config.accessKeyId
          ? {
              accessKeyId: this.config.accessKeyId,
              secretAccessKey: this.config.secretAccessKey || '',
            }
          : undefined,
      }) as S3ClientLike;
    }
    return this.client;
  }

  private publicUrl(key: string): string {
    if (this.config.publicBaseUrl) return `${this.config.publicBaseUrl.replace(/\/$/, '')}/${key}`;
    const endpoint = this.config.endpoint?.replace(/\/$/, '');
    if (endpoint) return `${endpoint}/${this.config.bucket}/${key}`;
    return `https://${this.config.bucket}.s3.${this.config.region || 'us-east-1'}.amazonaws.com/${key}`;
  }

  async putFile(key: string, body: Uint8Array, contentType?: string): Promise<PutResult> {
    const client = await this.getClient();
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    await client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
    return { url: this.publicUrl(key) };
  }

  async deleteFile(key: string): Promise<boolean> {
    const client = await this.getClient();
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
    await client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }));
    return true;
  }
}
