import type { Readable } from 'node:stream';

/**
 * Where uploaded images live (D10, D55). The API talks to this interface only, so the
 * local-disk adapter used today can be replaced by an S3-compatible one without touching
 * the routes. Images are never stored in PostgreSQL.
 */
export interface UploadTarget {
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresAt: Date;
}

export interface StorageAdapter {
  /**
   * True when the bytes are sent to this API (ASSET-04) instead of directly to the storage
   * service through a presigned URL. The upload route answers 404 when it is false.
   */
  readonly receivesUploadsThroughApi: boolean;

  /** Where the client sends the bytes of a pending asset. */
  createUploadTarget(input: {
    assetId: string;
    contentType: string;
    expiresAt: Date;
  }): UploadTarget;

  /** Store the bytes of an object, replacing a previous upload to the same key. */
  put(objectKey: string, body: Buffer): Promise<void>;

  /** Size of a stored object, or `null` when it does not exist. */
  stat(objectKey: string): Promise<{ sizeBytes: number } | null>;

  /** The first `length` bytes of an object (to check what a file really is), or `null`. */
  readHead(objectKey: string, length: number): Promise<Buffer | null>;

  /** Open an object for streaming to a client, or `null` when it does not exist. */
  open(objectKey: string): Promise<{ stream: Readable; sizeBytes: number } | null>;

  /** Remove an object; removing a missing object is not an error. */
  delete(objectKey: string): Promise<void>;
}

/** Server-generated object key of an asset: never derived from client input. */
export function objectKeyFor(workspaceId: string, assetId: string): string {
  return `${workspaceId}/${assetId}`;
}
