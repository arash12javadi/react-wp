/**
 * Server routes for rwp-code-snippets, served at /api/plugins/rwp-code-snippets/<route> by
 * server.mjs (self-hosted) and api/plugins.ts (Vercel). Registered in server/plugins.mjs.
 *
 * The snippets themselves never come through here — the browser reads and writes them straight
 * from Supabase, where row level security decides. These routes exist only because the Gemini API
 * key must not leave the server.
 */

import { chatRoute, geminiConfigured, geminiModel, generateSnippetRoute } from './serverAi.mjs';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const base = (ctx) => ctx.supabase.url.replace(/\/$/, '');

async function rest(ctx, path, { method = 'GET', body, auth = 'anon' } = {}) {
  const key = auth === 'service' ? ctx.supabase.secretKey : ctx.supabase.publishableKey;
  const token = auth === 'user' ? ctx.bearerToken : key;
  const response = await fetch(`${base(ctx)}/rest/v1/${path}`, {
    method,
    headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!response.ok) {
    const message = payload?.message || (typeof payload === 'string' && payload) || `HTTP ${response.status}`;
    if (payload?.code === 'PGRST202') {
      throw new HttpError(500, 'public.user_has_cap() is missing. Run supabase/migrations/20260912_profiles_capabilities_media.sql in the Supabase SQL Editor.');
    }
    throw new HttpError(response.status >= 500 ? 502 : 400, `Supabase ${method} ${path.split('?')[0]} failed: ${message}`);
  }
  return payload;
}

export default {
  id: 'rwp-code-snippets',
  routes: {
    /** Whether the AI features can work at all. Reports that the key is set, never its value. */
    'GET status': async (ctx) => {
      if (!ctx.bearerToken) return { status: 401, body: { error: 'Sign in to view the snippets status.' } };
      const allowed = await rest(ctx, 'rpc/user_has_cap', { method: 'POST', body: { capability: 'manage_options' }, auth: 'user' }).catch(() => false);
      if (allowed !== true) return { status: 403, body: { error: 'Viewing the server status needs the “Manage settings” capability (Administrator).' } };
      return { status: 200, body: { gemini: geminiConfigured(), model: geminiConfigured() ? geminiModel() : '' } };
    },

    'POST ai/generate': (ctx) => generateSnippetRoute(ctx, rest),
    'POST ai/chat': (ctx) => chatRoute(ctx, rest),
  },
};
