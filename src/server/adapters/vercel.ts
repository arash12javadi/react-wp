/**
 * Vercel serverless entry point.
 *
 * Deploy this as a single Node function; it adapts the Hono app to Vercel's request/response.
 */
import { handle } from '@hono/node-server/vercel';
import { app } from '../index';
import { runStartupMigrations } from '../config';

// Migrate on cold start (fire-and-forget). Memoised, idempotent and failure-safe.
void runStartupMigrations();

export default handle(app);
