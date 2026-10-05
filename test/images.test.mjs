import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { acceptProductImage, fetchRemoteImage, imageInfo } from "../src/images.mjs";
import { ValidationError } from "../src/validation.mjs";

// Minimal headers: enough for the size check, which is all the server reads.
export function png(width, height) {
  const b = Buffer.alloc(64);
  b.writeUInt32BE(0x89504e47, 0);
  b.writeUInt32BE(0x0d0a1a0a, 4);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "ascii");
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

function jpeg(width, height) {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, ...Buffer.from("JFIF\0"), 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const sof = Buffer.alloc(19);
  sof.writeUInt16BE(0xffc0, 0);
  sof.writeUInt16BE(17, 2);
  sof[4] = 8;
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.alloc(16)]);
}

function webpVp8x(width, height) {
  const b = Buffer.alloc(40);
  b.write("RIFF", 0, "ascii");
  b.writeUInt32LE(32, 4);
  b.write("WEBP", 8, "ascii");
  b.write("VP8X", 12, "ascii");
  b.writeUInt32LE(10, 16);
  b.writeUIntLE(width - 1, 24, 3);
  b.writeUIntLE(height - 1, 27, 3);
  return b;
}

function webpLossy(width, height) {
  const b = Buffer.alloc(40);
  b.write("RIFF", 0, "ascii");
  b.write("WEBP", 8, "ascii");
  b.write("VP8 ", 12, "ascii");
  b[23] = 0x9d;
  b[24] = 0x01;
  b[25] = 0x2a;
  b.writeUInt16LE(width, 26);
  b.writeUInt16LE(height, 28);
  return b;
}

describe("product photos", () => {
  it("reads the size of PNG, JPEG and both kinds of WebP", () => {
    assert.deepEqual(imageInfo(png(1200, 900)), { ext: "png", contentType: "image/png", width: 1200, height: 900 });
    assert.deepEqual(imageInfo(jpeg(1200, 900)), { ext: "jpg", contentType: "image/jpeg", width: 1200, height: 900 });
    assert.deepEqual(imageInfo(webpVp8x(1200, 900)), { ext: "webp", contentType: "image/webp", width: 1200, height: 900 });
    assert.deepEqual(imageInfo(webpLossy(1200, 900)), { ext: "webp", contentType: "image/webp", width: 1200, height: 900 });
    assert.equal(imageInfo(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>".padEnd(64))), null);
  });

  it("accepts only the standard size, named by content", () => {
    const ok = acceptProductImage(png(1200, 900));
    assert.match(ok.url, /^\/images\/[a-f0-9]{32}\.png$/);
    assert.equal(acceptProductImage(png(1200, 900)).id, ok.id, "same bytes, same name");
    assert.throws(() => acceptProductImage(png(1201, 900)), ValidationError);
    assert.throws(() => acceptProductImage(Buffer.alloc(64)), (e) => e.status === 415);
  });

  it("refuses links that aren't public https", async () => {
    const neverCalled = () => assert.fail("must not fetch");
    for (const url of ["http://example.com/a.png", "https://127.0.0.1/a.png", "https://10.1.2.3/a.png", "https://[::1]/a.png", "https://169.254.169.254/latest", "not a url"]) {
      await assert.rejects(fetchRemoteImage(url, { fetchImpl: neverCalled }), ValidationError, url);
    }
  });

  it("follows a redirect, checks the type, and caps the size", async () => {
    const calls = [];
    const fake = async (url) => {
      calls.push(String(url));
      if (calls.length === 1) return new Response(null, { status: 302, headers: { location: "https://93.184.216.34/photo.png" } });
      return new Response(png(10, 10), { status: 200, headers: { "content-type": "image/png" } });
    };
    const got = await fetchRemoteImage("https://93.184.216.34/start", { fetchImpl: fake });
    assert.equal(got.contentType, "image/png");
    assert.equal(calls.length, 2);

    const html = async () => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } });
    await assert.rejects(fetchRemoteImage("https://93.184.216.34/page", { fetchImpl: html }), /isn't an image/);

    const toPrivate = async () => new Response(null, { status: 301, headers: { location: "https://192.168.1.1/x.png" } });
    await assert.rejects(fetchRemoteImage("https://93.184.216.34/x", { fetchImpl: toPrivate }), /private/);
  });
});
