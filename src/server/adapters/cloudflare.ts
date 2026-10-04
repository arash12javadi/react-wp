/**
 * Cloudflare Workers / Pages entry point.
 *
 * Hono exposes a standard `fetch` handler, so this exact same app runs on the edge runtime with no
 * modification — only the universal drivers (which rely on `fetch`) are usable here.
 */
import { app } from '../index';

export default app;
