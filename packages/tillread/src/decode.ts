import type { Input } from "./types.ts";

/**
 * Turns file bytes into text. Handles the encodings banks actually use:
 * UTF-8 (with or without a BOM), UTF-16 from Excel's "Unicode text" export, and Windows-1252
 * from older systems (so "Café" doesn't turn into "Caf�").
 */
export function decode(input: Input): string {
  if (typeof input === "string") return input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const bytes =
    input instanceof ArrayBuffer ? new Uint8Array(input) : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);

  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return utf8(bytes.subarray(3));
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  // UTF-16 without a BOM: ASCII text leaves every other byte zero.
  if (bytes.length >= 4 && bytes[0] !== 0 && bytes[1] === 0 && bytes[2] !== 0 && bytes[3] === 0) {
    return new TextDecoder("utf-16le").decode(bytes);
  }
  if (bytes.length >= 4 && bytes[0] === 0 && bytes[1] !== 0 && bytes[2] === 0 && bytes[3] !== 0) {
    return new TextDecoder("utf-16be").decode(bytes);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

const utf8 = (b: Uint8Array) => new TextDecoder("utf-8").decode(b);
