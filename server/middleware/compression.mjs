/**
 * Response compression: Brotli when the browser offers it, gzip otherwise, nothing when
 * `cache_enable_compression` is off or the response is not worth compressing.
 *
 * There is no `compression` npm package dependency here — `server.mjs` is plain `node:http`
 * (see CLAUDE.md), so this is a small hand-rolled negotiator over Node's built-in `node:zlib`,
 * the same way `server/cloudinary.mjs` hand-rolls its API client instead of adding one.
 *
 * Two different cost models, on purpose:
 *
 *   * The page cache (`pageCache.mjs`) compresses a page's HTML exactly once, when it is stored —
 *     at MISS or at a background stale re-render — and every HIT after that serves the precomputed
 *     bytes. That is the entire point of caching output rather than bolting a per-request gzip
 *     middleware in front of it: a cache hit now costs zero compression CPU, not "cheaper
 *     compression CPU".
 *   * A built asset under dist/ is compressed once per process, the first time it is requested,
 *     and kept in `assetCompressionCache` for the rest of the process's life — safe because Vite
 *     fingerprints every asset by content hash, so the same pathname never means different bytes
 *     during one run, and a redeploy restarts the process anyway (`npm start` rebuilds first).
 *
 * Only text-ish content is compressed. Images, fonts and video are already compressed in their own
 * format; running gzip/brotli over them again spends CPU to make the response *larger* more often
 * than smaller.
 */
import { readFile } from 'node:fs/promises';
import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'node:zlib';

/** Below this many bytes, compression's own framing overhead can make the response bigger. */
const MIN_COMPRESS_BYTES = 256;
/** Above this, Brotli's slower, better-compressing setting stops being worth the extra CPU. */
const BROTLI_LARGE_BYTES = 256 * 1024;

const compressibleType = /^(text\/|application\/(javascript|json|xml|xhtml\+xml|manifest\+json)|image\/svg\+xml)/i;

/** Whether this Content-Type is worth compressing at all. */
export function compressibleContentType(contentType) {
  return compressibleType.test(String(contentType || '').split(';')[0].trim());
}

/**
 * `br` when the client's Accept-Encoding offers it, else `gzip`, else `null` — never anything the
 * request did not actually offer, and never anything when the setting is off.
 */
export function negotiateEncoding(acceptEncodingHeader, settings) {
  if (!settings.cache_enable_compression) return null;
  const header = String(acceptEncodingHeader || '').toLowerCase();
  if (/(^|,)\s*br(\s*;|\s*,|$)/.test(header)) return 'br';
  if (/(^|,)\s*gzip(\s*;|\s*,|$)/.test(header)) return 'gzip';
  return null;
}

const brotliOptions = (size) => ({
  params: {
    // A cheaper setting above ~256KB keeps a first-time compression (an uncached page render, or
    // the first request for a large bundle) from being the slow part of the response.
    [zlibConstants.BROTLI_PARAM_QUALITY]: size > BROTLI_LARGE_BYTES ? 5 : 9,
    [zlibConstants.BROTLI_PARAM_SIZE_HINT]: size,
  },
});

/** Compresses a body with the given encoding, or returns null when it is too small to bother. */
export function compressSync(body, encoding) {
  const input = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
  if (input.length < MIN_COMPRESS_BYTES) return null;
  return encoding === 'br' ? brotliCompressSync(input, brotliOptions(input.length)) : gzipSync(input, { level: 6 });
}

/**
 * The one-shot version `compressSync` alone is easy to misuse: it returns `null` both for "no
 * encoding was negotiated" and for "too small to bother", and a caller that forgets the second
 * case ends up sending a `Content-Encoding` header with no compressed bytes behind it. This always
 * returns something safe to write.
 */
export function compressForResponse(body, encoding) {
  const compressed = encoding ? compressSync(body, encoding) : null;
  return compressed ? { body: compressed, contentEncoding: encoding } : { body, contentEncoding: null };
}

// pathname + encoding -> compressed Buffer. Built assets only: unbounded is safe here because the
// key space is exactly the files under dist/, which is finite and fixed for the process's life.
const assetCompressionCache = new Map();

/**
 * The compressed bytes for a static file, computed once and cached by pathname. Returns null when
 * compression is not applicable (wrong type, encoding not negotiated, or too small), in which case
 * the caller should fall back to streaming the file uncompressed.
 */
export async function compressedAsset(pathname, filePath, contentType, encoding) {
  if (!encoding || !compressibleContentType(contentType)) return null;
  const key = `${encoding}\u0000${pathname}`;
  const cached = assetCompressionCache.get(key);
  if (cached !== undefined) return cached;
  const raw = await readFile(filePath);
  const compressed = compressSync(raw, encoding);
  // A null (too-small-to-compress) result is cached too, so a tiny file is not re-checked and
  // re-failed to compress on every request.
  assetCompressionCache.set(key, compressed);
  return compressed;
}

/** Cleared when dist/ changes underneath a running process — see the install-schema route. */
export const clearAssetCompressionCache = () => assetCompressionCache.clear();

export const compressionAssetCacheStats = () => ({ cached_assets: assetCompressionCache.size });
