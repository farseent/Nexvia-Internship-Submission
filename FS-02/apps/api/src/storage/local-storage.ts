import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { StorageAdapter, UploadTarget } from './storage-adapter.js';

const KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function isMissing(err: unknown): boolean {
  return (err as NodeJS.ErrnoException).code === 'ENOENT';
}

/**
 * Stores objects as files below one directory. Suitable for development and a single API
 * instance with a persistent volume; several API instances need shared storage (an
 * S3-compatible adapter, D10), which this phase does not implement.
 */
export class LocalStorageAdapter implements StorageAdapter {
  readonly receivesUploadsThroughApi = true;
  private readonly root: string;

  constructor(rootDir: string) {
    this.root = resolve(rootDir);
  }

  /** Absolute path of a key; keys that are not `<uuid>/<uuid>` never reach the file system. */
  private pathFor(objectKey: string): string {
    if (!KEY_PATTERN.test(objectKey)) throw new Error('Invalid object key.');
    const path = resolve(this.root, objectKey);
    if (!path.startsWith(this.root + sep)) throw new Error('Invalid object key.');
    return path;
  }

  createUploadTarget(input: {
    assetId: string;
    contentType: string;
    expiresAt: Date;
  }): UploadTarget {
    return {
      url: `/api/v1/assets/${input.assetId}/content`,
      method: 'PUT',
      headers: { 'Content-Type': input.contentType },
      expiresAt: input.expiresAt,
    };
  }

  async put(objectKey: string, body: Buffer): Promise<void> {
    const path = this.pathFor(objectKey);
    await mkdir(dirname(path), { recursive: true });
    // Write beside the target and rename, so a reader never sees a half-written image.
    const temporary = `${path}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      await writeFile(temporary, body, { flag: 'wx' });
      await rename(temporary, path);
    } catch (err) {
      await rm(temporary, { force: true });
      throw err;
    }
  }

  async stat(objectKey: string): Promise<{ sizeBytes: number } | null> {
    try {
      const info = await stat(this.pathFor(objectKey));
      return info.isFile() ? { sizeBytes: info.size } : null;
    } catch (err) {
      if (isMissing(err)) return null;
      throw err;
    }
  }

  async readHead(objectKey: string, length: number): Promise<Buffer | null> {
    let handle;
    try {
      handle = await open(this.pathFor(objectKey), 'r');
    } catch (err) {
      if (isMissing(err)) return null;
      throw err;
    }
    try {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, 0);
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  }

  async open(objectKey: string) {
    const info = await this.stat(objectKey);
    if (info === null) return null;
    return { stream: createReadStream(this.pathFor(objectKey)), sizeBytes: info.sizeBytes };
  }

  async delete(objectKey: string): Promise<void> {
    await rm(this.pathFor(objectKey), { force: true });
  }
}
