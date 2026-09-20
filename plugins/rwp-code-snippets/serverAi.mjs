/**
 * The Gemini calls behind the Code Snippets screen: "Generate with AI" in the editor, and the
 * system-aware assistant drawer.
 *
 * The key stays on the server (GEMINI_API_KEY, optionally GEMINI_MODEL). A VITE_ variable would
 * be compiled into the JavaScript every visitor downloads, so anyone could read it out of the
 * bundle and spend the quota — which is also why this is a plugin server route and not a fetch
 * straight from the browser to Google.
 *
 * Both routes need manage_options, the same capability that may save a snippet: the answer is
 * code that an administrator is about to run on the site.
 */

// Google retires model names regularly (1.5 and 2.5 flash are closed to new keys). When a model is
// retired, its error names the replacement and callGemini switches to it; GEMINI_MODEL overrides.
export const DEFAULT_GEMINI_MODEL = 'gemini-3.6-flash';
const GEMINI_TIMEOUT_MS = 45_000;
const MAX_PROMPT_CHARS = 2_000;
const MAX_CODE_CHARS = 20_000;
const MAX_TURNS = 20;
const MAX_MESSAGE_CHARS = 4_000;

export const geminiConfigured = () => Boolean(process.env.GEMINI_API_KEY);

// The replacement a retired model's error pointed to, kept for the life of the process.
let suggestedModel = '';
export const geminiModel = () => (suggestedModel || process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL).trim();

/** "…Please update your code to use models/gemini-3.6-flash…" → "gemini-3.6-flash". */
const replacementModel = (message, current) => {
  // Greedy, then trim sentence punctuation: model names contain dots ("gemini-3.6-flash.").
  const match = String(message).match(/use\s+models\/(gemini-[\w.-]+)/i);
  const name = match?.[1].replace(/[.-]+$/, '');
  return name && name !== current ? name : '';
};

export class AiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Per-user rate limit ------------------------------------------------------------------------------
// In-memory, so per process. The free Gemini tier has its own per-minute limit; this keeps one
// administrator holding down "Generate" from using all of it.

const calls = new Map();
const USER_LIMIT = 12;
const WINDOW_MS = 60_000;

function rateLimited(userId) {
  const now = Date.now();
  const recent = (calls.get(userId) || []).filter((time) => now - time < WINDOW_MS);
  if (recent.length >= USER_LIMIT) return true;
  recent.push(now);
  calls.set(userId, recent);
  if (calls.size > 500) {
    for (const [key, times] of calls) if (!times.some((time) => now - time < WINDOW_MS)) calls.delete(key);
  }
  return false;
}

// What the model is told about this CMS -------------------------------------------------------------
// Everything below is checked against the code it describes. A system prompt that invents hook
// names or a CSS framework the site does not use produces snippets that fail silently, which is
// worse than no assistant at all.

const ARCHITECTURE = `# React-WP, the CMS you are writing code for

React 19 + Vite single-page app. Supabase (Postgres + Auth) is the whole backend; a small Node
server (server.mjs) serves the built site and plugin API routes. There is no PHP and no WordPress.

## Styling — NOT Tailwind
This project does not use Tailwind, and utility classes like "px-4" or "text-sm" do nothing here.
Write plain CSS. Target the global, unhashed class names the app renders:
- theme chrome: rwp-* and rwpt-* (header, footer, sidebar, comments)
- page builder output: rwpb-* (rwpb-root, rwpb-section, rwpb-heading, rwpb-button, …)
Component styles elsewhere are CSS Modules, so their class names are hashed at build time and you
must never target them. Use logical properties (margin-inline-start, padding-inline-end,
inset-inline-start, text-align: start) rather than left/right, because sites run in both
left-to-right and right-to-left languages and dir="rtl" mirrors the layout automatically.

## The hook registry
One registry, WordPress-style: actions are side effects, filters transform a value and MUST return
it. Lower priority runs first; 10 is the default.

A snippet of type "hook" is evaluated in the browser with new Function. It has NO imports, NO JSX
and NO TypeScript — write plain ES2022. It receives one argument, \`rwp\`:
  rwp.addAction(name, callback, priority?)
  rwp.addFilter(name, callback, priority?)      // the callback must return the value
  rwp.addSlotContent(name, id, render, priority?)  // render(args) returns a React node
  rwp.applyFilters(name, value, ...args)
  rwp.doAction(name, ...args)
  rwp.React                                      // use rwp.React.createElement, there is no JSX
Anything registered through \`rwp\` is removed automatically when the snippet is switched off. A
snippet may also return a function, which is called as extra cleanup.

Core actions: rwp_init, rwp_admin_loaded, rwp_admin_ready (receives the role),
rwp_public_loaded, rwp_user_logged_in, rwp_user_logged_out, rwp_post_created, rwp_post_updated,
rwp_post_deleted, rwp_page_created, rwp_page_updated, rwp_page_deleted, rwp_settings_saved,
rwp_menu_saved, rwp_plugin_activated, rwp_plugin_deactivated, rwp_snippets_applied.

Core filters: rwp_site_title, rwp_site_description, rwp_public_menu, rwp_posts, rwp_post_title,
rwp_post_excerpt, rwp_post_content, rwp_page_content, rwp_admin_navigation, the_content
(the HTML of a page body, filtered BEFORE it is sanitized), i18n_translate_key
(translated, key, locale), i18n_locale, i18n_supported_locales, builder_widgets.

Layout zones, added to with rwp.addSlotContent: before_header, after_header, before_content,
after_content, before_footer, after_footer, sidebar_widgets, comment_form_before,
comment_form_after, admin_before_content, admin_after_content, admin_sidebar_after_nav,
builder_sidebar_tabs, builder_topbar_actions.

## Database (Supabase Postgres, reached through PostgREST with row level security)
pages (pages and posts share this table: is_post, title, slug, content, status
'published'/'draft'/'trash', builder_data, builder_data_i18n, locale, is_builder_enabled),
posts, categories, comments, options (option_name/option_value, both text), menus, media,
profiles (this is where a user's role lives — never user_metadata), profile_details (private),
theme_settings, code_snippets, and the shop_* and builder tables when those plugins are active.
Roles: super_admin, administrator, shop_manager, editor, author, contributor, subscriber.
Capabilities are checked in SQL by public.user_has_cap('...').

## Page Builder (plugin rwp-page-builder)
Layouts are JSON in pages.builder_data: sections → columns → widgets, each node
{ id, kind, type, settings, style, children }. Widgets render into global rwpb-* classes, so CSS
snippets can style builder output.

## Where a snippet runs
location decides that: 'head' (public site, in <head>), 'footer' (public site, end of <body>),
'frontend' (public site), 'admin' (admin screens only), 'everywhere' (both).`;

const CODE_RULES = `Rules for the code you return:
1. Return JSON matching the response schema exactly.
2. "code" is the complete snippet body, ready to paste into the editor — no Markdown fences, no
   "\`\`\`js", and no surrounding explanation.
3. Match the requested snippet type:
   - css: plain CSS rules only, no <style> tag.
   - javascript: plain browser JavaScript, no <script> tag, no imports, no JSX.
   - html: markup only. Inline <script> inside it does run.
   - hook: plain JavaScript using the \`rwp\` object described above. No imports, no JSX.
4. Never invent hook names, table names, class names or capabilities. If what is asked for needs
   something this CMS does not have, say so in "explanation" and return the closest thing that
   does work.
5. Guard for elements that may not exist (document.querySelector can return null) and keep the
   code safe to run twice: a snippet is re-applied whenever snippets are reloaded.
6. Comment the non-obvious lines, briefly.
7. "explanation" is one short paragraph: what the code does and where to put it.`;

const GENERATE_PROMPT = `You are a senior React/TypeScript engineer writing code snippets for the React-WP CMS.

${ARCHITECTURE}

${CODE_RULES}`;

const CHAT_PROMPT = `You are the React-WP developer assistant: a senior React/TypeScript engineer who knows this
specific CMS inside out and helps an administrator extend it with code snippets.

${ARCHITECTURE}

How to answer:
- "reply" is your answer in plain prose. Short paragraphs, no Markdown code fences.
- When code helps, put it in "code" (and set "codeType" to css, javascript, html or hook) so it can
  be inserted into the snippet editor with one click. Put at most one snippet in "code"; describe
  any others in "reply".
- Never invent hook names, table names, class names or capabilities. Say plainly when React-WP
  cannot do what was asked, and suggest the nearest thing that works.
- Answer questions about the architecture directly, without code, when that is what was asked.

${CODE_RULES}`;

// Requests --------------------------------------------------------------------------------------

const SNIPPET_TYPES = new Set(['css', 'javascript', 'html', 'hook']);

const text = (value, limit) => (typeof value === 'string' ? value.trim().slice(0, limit) : '');

function validateGenerate(body) {
  const snippetType = SNIPPET_TYPES.has(body?.snippetType) ? body.snippetType : null;
  if (!snippetType) throw new AiError(400, 'Choose a snippet type (CSS, JavaScript, HTML or React hook) before generating code.');
  const prompt = text(body?.prompt, MAX_PROMPT_CHARS);
  if (!prompt) throw new AiError(400, 'Describe what the snippet should do.');
  const existing = text(body?.existingCode, MAX_CODE_CHARS);
  return {
    snippetType,
    prompt,
    existingCode: existing,
    // "refine" rewrites what is already in the editor; "create" starts from nothing.
    mode: existing && body?.mode === 'refine' ? 'refine' : 'create',
    title: text(body?.title, 200),
    location: text(body?.location, 30),
  };
}

function validateChat(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  if (!messages.length) throw new AiError(400, 'Write a question for the assistant.');
  if (messages.length > MAX_TURNS) throw new AiError(400, `This conversation is ${messages.length} messages long; the limit is ${MAX_TURNS}. Start a new chat.`);
  const clean = messages.map((message) => {
    const content = text(message?.text, MAX_MESSAGE_CHARS);
    if (!content) throw new AiError(400, 'One of the messages is empty.');
    return { role: message?.role === 'assistant' ? 'model' : 'user', text: content };
  });
  if (clean[clean.length - 1].role !== 'user') throw new AiError(400, 'The last message must be the one you are asking.');
  return {
    messages: clean,
    // The snippet open in the editor, so "why does this not work?" has something to look at.
    editorCode: text(body?.editorCode, MAX_CODE_CHARS),
    editorType: SNIPPET_TYPES.has(body?.editorType) ? body.editorType : '',
  };
}

const generateContents = (request) => {
  const lines = [
    `Snippet type: ${request.snippetType}`,
    request.title ? `Snippet title: ${request.title}` : '',
    request.location ? `It will run at: ${request.location}` : '',
    '',
    request.mode === 'refine' ? 'Rewrite this snippet as asked, keeping everything that still applies:' : 'Write a new snippet.',
    request.mode === 'refine' ? `\n${request.existingCode}\n` : '',
    '',
    `What it should do: ${request.prompt}`,
  ].filter(Boolean);
  return [{ role: 'user', parts: [{ text: lines.join('\n') }] }];
};

const chatContents = (request) => {
  const contents = request.messages.map((message) => ({ role: message.role, parts: [{ text: message.text }] }));
  if (request.editorCode) {
    // Prepended as context rather than merged into the question, so the model treats it as data.
    contents.unshift({
      role: 'user',
      parts: [{ text: `For reference, this ${request.editorType || 'code'} snippet is open in my editor right now:\n\n${request.editorCode}` }],
    });
    contents.splice(1, 0, { role: 'model', parts: [{ text: 'Thanks — I will keep that snippet in mind.' }] });
  }
  return contents;
};

const GENERATE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    code: { type: 'STRING' },
    explanation: { type: 'STRING' },
  },
  required: ['code'],
};

const CHAT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    reply: { type: 'STRING' },
    code: { type: 'STRING' },
    codeType: { type: 'STRING', enum: ['css', 'javascript', 'html', 'hook'] },
  },
  required: ['reply'],
};

// Gemini ------------------------------------------------------------------------------------------

async function callGemini({ systemPrompt, contents, schema, temperature }, model = geminiModel(), retried = false) {
  const key = process.env.GEMINI_API_KEY;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: { temperature, responseMimeType: 'application/json', responseSchema: schema },
      }),
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw new AiError(504, `Gemini did not answer within ${GEMINI_TIMEOUT_MS / 1000} seconds. Try again, or ask for something smaller.`);
    throw new AiError(502, `Could not reach the Gemini API from the server: ${error instanceof Error ? error.message : 'network error'}.`);
  } finally {
    clearTimeout(timer);
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.error?.message || `HTTP ${response.status}`;
    // A retired model's error names its replacement: switch once, and remember it for later requests.
    const replacement = !retried && [400, 403, 404].includes(response.status) && /no longer available|not found|deprecated|retired|update your code/i.test(message)
      ? replacementModel(message, model) : '';
    if (replacement) {
      console.warn(`[rwp-code-snippets] Gemini model "${model}" is unavailable; switching to "${replacement}" as its error suggests. Set GEMINI_MODEL in .env.local to make this permanent.`);
      const result = await callGemini({ systemPrompt, contents, schema, temperature }, replacement, true);
      suggestedModel = replacement;
      return result;
    }
    if (response.status === 429) throw new AiError(429, `Gemini's rate limit or free-tier quota was reached (${message}). Wait a minute and try again.`);
    if (response.status === 404) throw new AiError(502, `The Gemini model "${model}" is not available (${message}). Set GEMINI_MODEL in .env.local to a current model and restart the server.`);
    if (response.status === 400 && /api key/i.test(message)) throw new AiError(502, 'Gemini rejected GEMINI_API_KEY. Check the key in .env.local (Google AI Studio → API keys) and restart the server.');
    if (response.status === 403) throw new AiError(502, `Gemini refused the request: ${message}. Check that the API key's project has the Generative Language API enabled.`);
    throw new AiError(502, `Gemini returned an error: ${message}`);
  }

  if (payload?.promptFeedback?.blockReason) {
    throw new AiError(422, `Gemini blocked this request (${payload.promptFeedback.blockReason}). Rephrase what you asked for.`);
  }
  const candidate = payload?.candidates?.[0];
  if (candidate?.finishReason === 'SAFETY') throw new AiError(422, 'Gemini stopped the answer for safety reasons. Rephrase what you asked for.');
  if (candidate?.finishReason === 'MAX_TOKENS') throw new AiError(422, 'The answer was cut off because it was too long. Ask for a smaller piece of code.');
  const answer = (candidate?.content?.parts || []).map((part) => part?.text || '').join('');
  try {
    return { parsed: JSON.parse(answer), model };
  } catch {
    throw new AiError(502, 'Gemini did not return valid JSON. Try again.');
  }
}

/**
 * Models fence code even when told not to, and the fence would end up pasted into the editor.
 * Nothing else is stripped: the code is the answer, and rewriting it would hide what was returned.
 */
export function stripFence(value) {
  const code = String(value ?? '').replace(/\r\n/g, '\n').trim();
  const fenced = code.match(/^```[\w+-]*\n([\s\S]*?)\n?```$/);
  return (fenced ? fenced[1] : code).trim();
}

// Routes --------------------------------------------------------------------------------------------

/**
 * Both AI routes need a signed-in administrator. `rest` is the plugin's Supabase REST helper.
 * Returns the user, or a { status, body } response to send back instead.
 */
async function authorize(ctx, rest) {
  if (!geminiConfigured()) {
    return { response: { status: 501, body: { error: 'The AI assistant is not set up: add GEMINI_API_KEY (from Google AI Studio) to .env.local and restart the server.' } } };
  }
  if (!ctx.bearerToken) return { response: { status: 401, body: { error: 'Sign in to use the AI assistant.' } } };

  const userResponse = await fetch(`${ctx.supabase.url.replace(/\/$/, '')}/auth/v1/user`, {
    headers: { apikey: ctx.supabase.publishableKey, Authorization: `Bearer ${ctx.bearerToken}` },
  });
  if (!userResponse.ok) return { response: { status: 401, body: { error: 'Your session has expired. Sign in again.' } } };
  const user = await userResponse.json();

  const allowed = await rest(ctx, 'rpc/user_has_cap', { method: 'POST', body: { capability: 'manage_options' }, auth: 'user' }).catch(() => false);
  if (allowed !== true) {
    return { response: { status: 403, body: { error: 'The AI assistant writes code that runs on the site, so it needs the “Manage settings” capability (Administrator).' } } };
  }
  if (rateLimited(user.id)) {
    return { response: { status: 429, body: { error: `You can make ${USER_LIMIT} AI requests a minute. Wait a moment and try again.` } } };
  }
  return { user };
}

export async function generateSnippetRoute(ctx, rest) {
  const { response } = await authorize(ctx, rest);
  if (response) return response;
  try {
    const request = validateGenerate(ctx.json());
    const { parsed, model } = await callGemini({
      systemPrompt: GENERATE_PROMPT,
      contents: generateContents(request),
      schema: GENERATE_SCHEMA,
      temperature: 0.35,
    });
    const code = stripFence(parsed?.code);
    if (!code) throw new AiError(502, 'Gemini returned an empty snippet. Try describing what you want in more detail.');
    return { status: 200, body: { code, explanation: String(parsed?.explanation || '').slice(0, 2000), model } };
  } catch (error) {
    if (error instanceof AiError) return { status: error.status, body: { error: error.message } };
    throw error;
  }
}

export async function chatRoute(ctx, rest) {
  const { response } = await authorize(ctx, rest);
  if (response) return response;
  try {
    const request = validateChat(ctx.json());
    const { parsed, model } = await callGemini({
      systemPrompt: CHAT_PROMPT,
      contents: chatContents(request),
      schema: CHAT_SCHEMA,
      temperature: 0.5,
    });
    const reply = String(parsed?.reply || '').slice(0, 8000);
    if (!reply) throw new AiError(502, 'Gemini returned an empty answer. Try asking again.');
    return {
      status: 200,
      body: {
        reply,
        code: stripFence(parsed?.code).slice(0, MAX_CODE_CHARS),
        codeType: SNIPPET_TYPES.has(parsed?.codeType) ? parsed.codeType : '',
        model,
      },
    };
  } catch (error) {
    if (error instanceof AiError) return { status: error.status, body: { error: error.message } };
    throw error;
  }
}

// Exported for tests.
export const _internal = { validateGenerate, validateChat, generateContents, chatContents, stripFence };
