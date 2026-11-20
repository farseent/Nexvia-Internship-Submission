import { MAX_IMAGE_BYTES, isAllowedImageType } from '@conote/shared';
import { ApiError, api, describeApiError } from './api-client';

/** An image problem with a message that is safe to show. */
export class ImageUploadError extends Error {}

export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp';

/** Reject what the server would reject, before any bytes are sent. */
export function checkImageFile(file: { type: string; size: number }): void {
  if (!isAllowedImageType(file.type)) {
    throw new ImageUploadError('Use a PNG, JPEG, GIF or WebP image.');
  }
  if (file.size === 0) throw new ImageUploadError('This image file is empty.');
  if (file.size > MAX_IMAGE_BYTES) {
    throw new ImageUploadError(`Images can be at most ${MAX_IMAGE_BYTES / (1024 * 1024)} MB.`);
  }
}

function describeUploadFailure(error: unknown): string {
  if (error instanceof ImageUploadError) return error.message;
  if (error instanceof ApiError) {
    if (error.code === 'UNSUPPORTED_MEDIA_TYPE') return 'This image type is not supported.';
    if (error.code === 'PAYLOAD_TOO_LARGE') return 'This image is too large.';
    if (error.code === 'FORBIDDEN') return 'You do not have permission to add images to this page.';
    if (error.code === 'CONFLICT') return 'The upload could not be completed. Please try again.';
  }
  return describeApiError(error);
}

/**
 * Upload one image to a page: authorize, send the bytes, confirm (D55). Resolves to the
 * stable URL to put in the document and a default description derived from the file name.
 * Failures are thrown as `ImageUploadError` with a user-facing message.
 */
export async function uploadPageImage(
  pageId: string,
  file: File,
  guard: <T>(call: () => Promise<T>) => Promise<T> = (call) => call(),
): Promise<{ url: string; alt: string }> {
  try {
    checkImageFile(file);
    const { asset, upload } = await guard(() =>
      api.authorizeImageUpload({
        purpose: 'PAGE_IMAGE',
        pageId,
        contentType: file.type,
        sizeBytes: file.size,
      }),
    );
    await guard(() => api.uploadImageBytes(upload, file));
    const done = await guard(() => api.completeImageUpload(asset.id));
    return { url: done.asset.url, alt: file.name.replace(/\.[^.]+$/, '').slice(0, 200) };
  } catch (error) {
    throw new ImageUploadError(describeUploadFailure(error));
  }
}
