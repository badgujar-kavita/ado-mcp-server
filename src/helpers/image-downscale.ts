import { Jimp } from "jimp";

export interface DownscaleOptions {
  /** Max bytes for raw (un-downscaled) image; above this, raster images are downscaled. */
  maxBytesPerImage: number;
  /** Downscale target long-side pixels. */
  downscaleLongSidePx: number;
  /** JPEG/WebP quality 1-100. */
  downscaleQuality: number;
}

export interface DownscaleResult {
  buffer: ArrayBuffer;
  downscaled: boolean;
  originalBytes: number;
  finalBytes: number;
}

/**
 * MIME types jimp can decode + re-encode. webp / tiff are intentionally excluded
 * from the default allowlist (see conventions.config.json → images.mimeAllowlist)
 * because webp is not natively supported by jimp v1.
 */
const JIMP_SUPPORTED_RASTER_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/bmp",
  "image/tiff",
  "image/x-ms-bmp",
]);

/**
 * Downscale a raster image if its byte size exceeds `maxBytesPerImage`.
 *
 * Returns the original buffer untouched if:
 *  - the image is already under the cap, or
 *  - the MIME is vector (SVG) — caller handles inline-text if needed.
 *
 * Throws only if jimp cannot decode the image. Callers should catch and mark
 * the image as `skipped: "fetch-failed"`.
 */
export async function downscaleRasterIfOversized(
  buffer: ArrayBuffer,
  mimeType: string,
  opts: DownscaleOptions,
): Promise<DownscaleResult> {
  const originalBytes = buffer.byteLength;

  // Pass-through for SVG (vector — no pixels to downscale) and for already-small files.
  if (mimeType === "image/svg+xml" || originalBytes <= opts.maxBytesPerImage) {
    return { buffer, downscaled: false, originalBytes, finalBytes: originalBytes };
  }

  // If jimp can't handle this MIME, pass through untouched — the caller's
  // size check will flag it as too-large afterward.
  if (!JIMP_SUPPORTED_RASTER_MIME.has(mimeType)) {
    return { buffer, downscaled: false, originalBytes, finalBytes: originalBytes };
  }

  // jimp v1: Jimp.fromBuffer(buffer) decodes based on magic bytes.
  const img = await Jimp.fromBuffer(Buffer.from(buffer));
  const width = img.bitmap.width;
  const height = img.bitmap.height;
  const longSide = Math.max(width, height);
  if (longSide > opts.downscaleLongSidePx) {
    const factor = opts.downscaleLongSidePx / longSide;
    img.scale(factor);
  }

  // Re-encode. JPEG respects `quality`; PNG/GIF/BMP/TIFF ignore it (lossless).
  let outBuf: Buffer;
  if (mimeType === "image/jpeg") {
    outBuf = await img.getBuffer("image/jpeg", { quality: opts.downscaleQuality });
  } else if (mimeType === "image/png") {
    outBuf = await img.getBuffer("image/png");
  } else if (mimeType === "image/gif") {
    outBuf = await img.getBuffer("image/gif");
  } else if (mimeType === "image/bmp" || mimeType === "image/x-ms-bmp") {
    outBuf = await img.getBuffer("image/bmp");
  } else if (mimeType === "image/tiff") {
    outBuf = await img.getBuffer("image/tiff");
  } else {
    // Already excluded above, but keep exhaustive.
    outBuf = await img.getBuffer("image/png");
  }

  // `Buffer` extends Uint8Array. Slice the underlying ArrayBuffer to the exact
  // range Node may over-allocate the pool-backed buffer.
  const arrayBuf = outBuf.buffer.slice(
    outBuf.byteOffset,
    outBuf.byteOffset + outBuf.byteLength,
  ) as ArrayBuffer;

  return {
    buffer: arrayBuf,
    downscaled: true,
    originalBytes,
    finalBytes: arrayBuf.byteLength,
  };
}
