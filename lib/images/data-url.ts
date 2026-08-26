/**
 * Server-side parsing of the image data URLs the capture panels post.
 *
 * The panels re-encode to JPEG before sending, so this is the backstop: it
 * refuses anything the model API cannot read rather than passing a HEIC
 * through and getting an opaque 400 back.
 */

/** The four the Messages API accepts. */
export const SUPPORTED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
] as const;

export type SupportedImageType = (typeof SUPPORTED_IMAGE_TYPES)[number];

export type ParsedImageDataUrl =
  | { ok: true; mediaType: SupportedImageType; data: string }
  | { ok: false; error: string };

/** ~4MB of raw base64 keeps request sizes and model costs sane. */
const MAX_BASE64_LENGTH = 5_500_000;

export function parseImageDataUrl(raw: string): ParsedImageDataUrl {
  const match = raw.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) {
    return { ok: false, error: 'Upload a photo — that did not look like an image.' };
  }

  const mediaType = match[1]!.toLowerCase();
  const data = match[2]!.replace(/\s+/g, '');

  if (!SUPPORTED_IMAGE_TYPES.includes(mediaType as SupportedImageType)) {
    // Reached only if a caller skipped the browser-side conversion.
    return {
      ok: false,
      error:
        mediaType === 'image/heic' || mediaType === 'image/heif'
          ? 'That iPhone photo did not get converted before upload. Reload the page and pick it again.'
          : `${mediaType} images are not supported. JPEG, PNG, GIF, and WebP are.`,
    };
  }

  if (data.length > MAX_BASE64_LENGTH) {
    return { ok: false, error: 'Photo is too large. Try a smaller image.' };
  }

  return { ok: true, mediaType: mediaType as SupportedImageType, data };
}
