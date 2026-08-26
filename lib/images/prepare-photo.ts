/**
 * Normalize a picked photo in the browser before it goes anywhere.
 *
 * Phones do not hand you a web-friendly file. An iPhone shoots HEIC, which the
 * model API will not accept; every phone writes EXIF rotation rather than
 * rotating pixels, and a photo the model reads sideways loses most of its
 * text; and a 12MP original is several megabytes of base64. All three are
 * fixed here so no one has to think about formats — decode whatever the OS
 * gives us, honour the orientation, downscale, and re-encode as JPEG.
 */

/** Long edge after downscale — enough for box spines, small enough to send. */
export const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.85;

export class UnsupportedImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedImageError';
  }
}

export type PreparedPhoto = {
  /** Always image/jpeg, whatever came in. */
  dataUrl: string;
  width: number;
  height: number;
};

/** Scale to fit inside a square of maxEdge, never enlarging. */
export function fitWithin(
  width: number,
  height: number,
  maxEdge: number = MAX_EDGE,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge || longest === 0) {
    return { width: Math.round(width), height: Math.round(height) };
  }
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

type DecodedImage = {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
};

async function decodeViaImageBitmap(file: File): Promise<DecodedImage | null> {
  if (typeof createImageBitmap !== 'function') return null;
  try {
    // from-image applies the EXIF rotation instead of ignoring it.
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      release: () => bitmap.close(),
    };
  } catch {
    return null;
  }
}

/**
 * Fallback decoder. On Apple devices this is the one that reads HEIC — the
 * decoding is done by the OS behind the <img> tag — and browsers apply EXIF
 * orientation here by default.
 */
async function decodeViaImageElement(file: File): Promise<DecodedImage> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () =>
        reject(
          new UnsupportedImageError(
            'This browser cannot open that image format. On a computer, export the photo as JPEG first; from a phone it should just work.',
          ),
        );
      element.src = url;
    });
    return {
      source: img,
      width: img.naturalWidth || img.width,
      height: img.naturalHeight || img.height,
      release: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

/**
 * Any image the device can open — HEIC/HEIF included — becomes a right-way-up,
 * downscaled JPEG data URL.
 */
export async function preparePhoto(
  file: File,
  maxEdge: number = MAX_EDGE,
): Promise<PreparedPhoto> {
  const decoded = (await decodeViaImageBitmap(file)) ?? (await decodeViaImageElement(file));

  try {
    if (!decoded.width || !decoded.height) {
      throw new UnsupportedImageError('That image came back empty. Try another photo.');
    }

    const size = fitWithin(decoded.width, decoded.height, maxEdge);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new UnsupportedImageError('This browser blocked image processing.');
    ctx.drawImage(decoded.source, 0, 0, size.width, size.height);

    const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
    if (!dataUrl.startsWith('data:image/jpeg')) {
      throw new UnsupportedImageError('Could not convert that photo to JPEG.');
    }
    return { dataUrl, width: size.width, height: size.height };
  } finally {
    decoded.release();
  }
}

/** Accept attribute that keeps HEIC pickable in file browsers that filter. */
export const PHOTO_ACCEPT = 'image/*,.heic,.heif,.HEIC,.HEIF';
