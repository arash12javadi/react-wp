/**
 * Vercel serverless entry point.
 *
 * Deploy this as a single Node function; it adapts the Hono app to Vercel's request/response.
 */
import { handle } from '@hono/node-server/vercel';
import { app } from '../index';

export default handle(app);
