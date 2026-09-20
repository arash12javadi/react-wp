/**
 * The browser half of the AI assistant.
 *
 * It calls this plugin's own server routes, never Google directly. The Gemini key lives in
 * GEMINI_API_KEY on the server; an import.meta.env.VITE_GEMINI_API_KEY would be compiled into the
 * JavaScript bundle that every visitor downloads, so the key would be public the moment the site
 * was deployed. The system prompt that teaches Gemini about React-WP lives on the server too
 * (serverAi.mjs), so it cannot be edited from a browser console to lift those rules.
 */

import { getSupabaseClient } from '../../../src/lib/db';
import type { SnippetLocation, SnippetType } from '../../../src/lib/snippets';

export interface GenerateRequest {
  snippetType: SnippetType;
  prompt: string;
  /** What is in the editor now. Sent only when refining. */
  existingCode?: string;
  mode?: 'create' | 'refine';
  title?: string;
  location?: SnippetLocation;
}

export interface GenerateResult {
  code: string;
  explanation: string;
  model: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  /** Code the assistant offered, ready to insert into the editor. */
  code?: string;
  codeType?: SnippetType | '';
}

export interface ChatResult {
  reply: string;
  code: string;
  codeType: SnippetType | '';
  model: string;
}

const UNREACHABLE = 'Could not reach the site server. If you are running npm run dev, npm start must also be running on port 3000.';

async function post<T>(route: string, body: unknown): Promise<T> {
  const { data } = await getSupabaseClient().auth.getSession();
  let response: Response;
  try {
    response = await fetch(`/api/plugins/rwp-code-snippets/${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token || ''}` },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(UNREACHABLE);
  }
  const payload = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok || !payload) {
    throw new Error(payload?.error || `The AI request failed (HTTP ${response.status}). ${UNREACHABLE}`);
  }
  return payload;
}

/** Writes a new snippet, or rewrites the one in the editor when `mode` is 'refine'. */
export async function generateSnippet(request: GenerateRequest): Promise<GenerateResult> {
  if (!request.prompt.trim()) throw new Error('Describe what the snippet should do.');
  const result = await post<GenerateResult>('ai/generate', {
    ...request,
    existingCode: request.mode === 'refine' ? request.existingCode : '',
  });
  return { code: result.code || '', explanation: result.explanation || '', model: result.model || '' };
}

/**
 * One turn of the assistant conversation. The whole history is sent each time — the server keeps
 * no session, so a restarted server does not lose the chat.
 */
export async function askAssistant(
  messages: ChatMessage[],
  context: { editorCode?: string; editorType?: SnippetType | '' } = {},
): Promise<ChatResult> {
  const result = await post<ChatResult>('ai/chat', {
    messages: messages.map(({ role, text }) => ({ role, text })),
    editorCode: context.editorCode || '',
    editorType: context.editorType || '',
  });
  return { reply: result.reply || '', code: result.code || '', codeType: result.codeType || '', model: result.model || '' };
}
