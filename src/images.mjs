// Product photos. The admin console resizes every photo in the browser to
// one size before uploading it; the server checks that size from the file
// header (no image library needed) so every product card matches.

import { createHash } from "node:crypto";

import { ValidationError } from "./validation.mjs";

export const IMAGE_WIDTH = 1200;
export const IMAGE_HEIGHT = 900;
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

const TYPES = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
};

export const IMAGE_PATH_RE = /^\/images\/([a-f0-9]{32})\.(webp|jpg|png)$/;

/** Type and pixel size read from the file header, or null if it isn't a PNG, JPEG or WebP. */
export function imageInfo(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 30) return null;

  // PNG: signature, then the IHDR chunk with width and height.
  if (buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(4) === 0x0d0a1a0a && buf.toString("ascii", 12, 16) === "IHDR") {
    return { ext: "png", contentType: TYPES.png, width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }

  // JPEG: walk the segments to the first start-of-frame marker.
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1];
      if (marker === 0xff) {
        i += 1;
        continue;
      }
      const isSof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
      if (isSof) {
        return { ext: "jpg", contentType: TYPES.jpg, height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
        i += 2;
        continue;
      }
      i += 2 + buf.readUInt16BE(i + 2);
    }
    return null;
  }

  // WebP: RIFF container with a lossy, lossless or extended first chunk.
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    const chunk = buf.toString("ascii", 12, 16);
    if (chunk === "VP8 " && buf[23] === 0x9d && buf[24] === 0x01 && buf[25] === 0x2a) {
      return { ext: "webp", contentType: TYPES.webp, width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    }
    if (chunk === "VP8L" && buf[20] === 0x2f) {
      const bits = buf.readUInt32LE(21);
      return { ext: "webp", contentType: TYPES.webp, width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8X") {
      return { ext: "webp", contentType: TYPES.webp, width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
    }
  }
  return null;
}

/** Check an upload is a product photo of exactly the standard size. */
export function acceptProductImage(buf) {
  if (buf.length > MAX_IMAGE_BYTES) {
    throw new ValidationError("That photo is too large. Try a smaller one.", {}, 413);
  }
  const info = imageInfo(buf);
  if (!info) throw new ValidationError("That file isn't a JPG, PNG or WebP image.", {}, 415);
  if (info.width !== IMAGE_WIDTH || info.height !== IMAGE_HEIGHT) {
    throw new ValidationError(`Photos must be resized to ${IMAGE_WIDTH} × ${IMAGE_HEIGHT} before upload.`, {}, 400);
  }
  // Named by content, so the same photo is stored once and can be cached forever.
  const id = createHash("sha256").update(buf).digest("hex").slice(0, 32);
  return { id, ext: info.ext, contentType: info.contentType, url: `/images/${id}.${info.ext}` };
}
