/**
 * Full-page output caching, plus the HTTP cache headers for pages, assets and API responses.
 *
 * What is cached is the finished HTML response: index.html after server/seo.mjs has injected the
 * SEO tags, the theme CSS and the tracking scripts. That injection is three or four PostgREST
 * round trips per request, so on a site with any traffic it is the whole cost of a page view. The
 * React app still hydrates and still fetches the page body itself — this does not turn React-WP
 * into a static site generator, it removes the repeated work in front of it.
 *
 * What is never cached, and why each one matters:
 *   * anything but GET;
 *   * a request carrying an Authorization header or a cookie — a signed-in visitor sees the admin
 *     toolbar and their own drafts, and serving one person's page to another is the classic way a
 *     page cache becomes a data leak;
 *   * /admin, /builder/* and ?preview=1, which are editor surfaces by definition;
 *   * any path with a query string other than a known-harmless one, because a cache keyed on the
 *     path alone would serve /search?s=cats to /search?s=dogs.
 *
 * Invalidation is explicit, not hopeful: POST /api/security/cache/purge is called by the admin
 * after any content or settings save (src/lib/security.ts) unless `cache_auto_purge_on_save` has
 * been switched off, and the TTL is the backstop for anything that misses. Stale-while-revalidate
 * means a page past its TTL is still served immediately while the next render replaces it, so a
 * purge never produces a latency spike.
 *
 * When `cache_enable_compression` is on, a stored entry's Brotli and gzip bytes are computed once,
 * here, at store time (a MISS or a background stale re-render) — never per hit. See
 * server/middleware/compression.mjs for why that split exists.
 */
import { createHash } from 'node:crypto';
import { compressSync } from './compression.mjs';

const MAX_ENTRIES = 500;
const MAX_ENTRY_BYTES = 2 * 1024 * 1024;

const entries = new Map();
const stats = { hits: 0, misses: 0, stale: 0, stores: 0, purges: 0 };

const weakEtag = (body) => `W/"${createHash('sha1').update(body).digest('base64url').slice(0, 27)}"`;

/** Query keys that do not change the HTML this server renders, so they can share one entry. */
const ignorableQuery = new Set(['fbclid', 'gclid', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ref']);

/**
 * Whether this request may be served from, or stored in, the page cache, and the key if so.
 * Returns { cacheable: false, reason } when not — the reason goes into the X-RWP-Cache header,
 * which is how you find out why a page you expected to be cached is not.
 */
export function pageCacheKey(request, url, settings) {
  if (!settings.cache_enabled) return { cacheable: false, reason: 'disabled' };
  if (request.method !== 'GET') return { cacheable: false, reason: 'method' };
  if (request.headers.authorization) return { cacheable: false, reason: 'authenticated' };
  if (request.headers.cookie) return { cacheable: false, reason: 'cookie' };

  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return { cacheable: false, reason: 'admin' };
  if (pathname.startsWith('/builder/')) return { cacheable: false, reason: 'builder' };
  if (pathname.startsWith('/api/')) return { cacheable: false, reason: 'api' };

  for (const name of url.searchParams.keys()) {
    if (!ignorableQuery.has(name)) return { cacheable: false, reason: `query:${name}` };
  }
  return { cacheable: true, key: pathname };
}

/**
 * What the cache has for this key: 'fresh' (serve it), 'stale' (serve it and re-render behind the
 * response) or 'miss'. An entry past ttl + stale-while-revalidate is dropped rather than served.
 */
export function pageCacheLookup(key, settings) {
  const entry = entries.get(key);
  if (!entry) {
    stats.misses += 1;
    return { state: 'miss' };
  }
  const age = Date.now() - entry.storedAt;
  if (age <= settings.cache_ttl_seconds * 1000) {
    stats.hits += 1;
    // Re-inserted so the eviction below drops the least recently used, not the oldest stored.
    entries.delete(key);
    entries.set(key, entry);
    return { state: 'fresh', entry, age };
  }
  if (age <= (settings.cache_ttl_seconds + settings.cache_stale_while_revalidate_seconds) * 1000) {
    stats.stale += 1;
    return { state: 'stale', entry, age };
  }
  entries.delete(key);
  stats.misses += 1;
  return { state: 'miss' };
}

/**
 * Stores a rendered page. Oversized bodies are skipped rather than evicting everything else.
 *
 * `compress: true` (from `settings.cache_enable_compression`) precomputes the Brotli and gzip
 * bytes right here, so every future HIT or STALE serve just picks whichever the request already
 * accepts — see `pageCacheBody`. The raw body is always kept too: a client that sent no
 * Accept-Encoding still needs an uncompressed copy.
 */
export function pageCacheStore(key, body, { compress = false } = {}) {
  const bytes = Buffer.byteLength(body);
  if (bytes > MAX_ENTRY_BYTES) return null;
  if (entries.size >= MAX_ENTRIES && !entries.has(key)) {
    // Map iterates in insertion order and lookups re-insert, so the first key is the least
    // recently used.
    const oldest = entries.keys().next().value;
    if (oldest !== undefined) entries.delete(oldest);
  }
  const entry = {
    body,
    bytes,
    etag: weakEtag(body),
    storedAt: Date.now(),
    br: compress ? compressSync(body, 'br') : null,
    gzip: compress ? compressSync(body, 'gzip') : null,
  };
  entries.delete(key);
  entries.set(key, entry);
  stats.stores += 1;
  return entry;
}

/**
 * The best representation of a stored entry for a request's negotiated encoding: precomputed
 * Brotli or gzip bytes when both the entry has them and the request accepts that encoding,
 * otherwise the raw, uncompressed body. `encoding` is the result of `negotiateEncoding` — already
 * settings-and-Accept-Encoding-aware, so this function does no negotiation of its own.
 */
export function pageCacheBody(entry, encoding) {
  if (encoding === 'br' && entry.br) return { body: entry.br, contentEncoding: 'br' };
  if (encoding === 'gzip' && entry.gzip) return { body: entry.gzip, contentEncoding: 'gzip' };
  return { body: entry.body, contentEncoding: null };
}

/**
 * Empties the cache. With no paths, everything goes — which is the right default after a settings
 * or theme change, because those alter every page. With paths, only those entries go, so
 * publishing one post does not throw away the whole site's cache.
 */
export function pageCachePurge(paths) {
  const list = Array.isArray(paths) ? paths.filter((path) => typeof path === 'string' && path.startsWith('/')) : [];
  stats.purges += 1;
  if (!list.length) {
    const removed = entries.size;
    entries.clear();
    return { removed, scope: 'all' };
  }
  let removed = 0;
  for (const path of list) {
    const key = path.replace(/\/+$/, '') || '/';
    if (entries.delete(key)) removed += 1;
  }
  return { removed, scope: 'paths', paths: list };
}

export const pageCacheStats = () => {
  let rawBytes = 0;
  let storedBytes = 0; // What is actually held in memory: compressed copies plus the raw body.
  let compressedEntries = 0;
  for (const entry of entries.values()) {
    rawBytes += entry.bytes;
    storedBytes += entry.bytes + (entry.br?.length || 0) + (entry.gzip?.length || 0);
    if (entry.br || entry.gzip) compressedEntries += 1;
  }
  return {
    ...stats,
    entries: entries.size,
    bytes: rawBytes,
    stored_bytes: storedBytes,
    compressed_entries: compressedEntries,
    max_entries: MAX_ENTRIES,
  };
};

/**
 * Cache-Control for an HTML page. `no-store` when the cache is off, because a shared proxy holding
 * a page this server refuses to hold is worse than no caching at all: it cannot be purged.
 */
export function htmlCacheHeaders(settings, cacheable) {
  if (!settings.cache_enabled || !cacheable) return 'no-store';
  return `public, max-age=0, s-maxage=${settings.cache_ttl_seconds}, stale-while-revalidate=${settings.cache_stale_while_revalidate_seconds}`;
}

/**
 * Cache-Control for a built asset. Vite fingerprints everything under /assets/, so those may be
 * immutable for a year — the filename changes when the contents do. Everything else in dist/
 * (favicon.svg, robots-adjacent files, anything copied from public/) keeps its name across
 * deploys, so it gets a short life and a revalidation instead.
 */
export function assetCacheHeaders(pathname, settings) {
  if (!settings.cache_enabled) return 'no-store, max-age=0';
  // Vite writes `<name>-<hash>.<ext>`, and the hash is base64url (index-MQ7s_Yva.js), not hex —
  // matching hex here would quietly mean nothing was ever immutable. A file under /assets/
  // without that suffix is treated as unfingerprinted and revalidated, which is the safe way round.
  if (/^\/assets\/.+-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/.test(pathname)) {
    return `public, max-age=${settings.cache_static_max_age_seconds}, immutable`;
  }
  return 'public, max-age=300, must-revalidate';
}

/** Answers a conditional request. True when the caller already has this exact body. */
export function notModified(request, etag) {
  const header = String(request.headers['if-none-match'] || '');
  if (!header) return false;
  return header.split(',').some((candidate) => candidate.trim() === etag);
}
