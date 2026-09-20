/**
 * Reading and writing public.code_snippets from the admin screens.
 *
 * Writing needs manage_options, which RLS enforces. An UPDATE or DELETE that RLS refuses returns
 * no error and changes no rows, so every write here asks for the rows back with .select() and
 * reports the real reason when nothing came back.
 */

import { getSupabaseClient, describeDbError } from '../../../src/lib/db';
import {
  bySnippetOrder, normalizeSnippet, type CodeSnippet, type SnippetDraft,
} from '../../../src/lib/snippets';

const REFUSED = 'The database refused the change. Saving snippets needs the “Manage settings” capability (Administrator).';

/** A missing table is the one error worth naming exactly: it means the migration has not been run. */
const describe = (error: unknown, fallback: string): string => {
  const code = (error as { code?: string } | null)?.code;
  if (code === '42P01' || code === 'PGRST205') {
    return 'The code_snippets table does not exist yet. Run supabase/migrations/20260930_code_snippets.sql in the Supabase SQL Editor.';
  }
  return `${fallback} ${describeDbError(error)}`;
};

/** Every snippet, active or not. A non-manager only ever gets the active ones back (RLS). */
export async function listSnippets(): Promise<CodeSnippet[]> {
  const { data, error } = await getSupabaseClient()
    .from('code_snippets')
    .select('*')
    .order('updated_at', { ascending: false });
  if (error) throw new Error(describe(error, 'Could not load the snippets:'));
  return ((data || []) as Array<Record<string, unknown>>).map(normalizeSnippet).sort(bySnippetOrder);
}

/**
 * A row reduced to its editable fields. The editor must not carry id, created_at or updated_at
 * into an update: PostgREST would try to write them and the whole save would be rejected.
 */
export const toDraft = (snippet: CodeSnippet): SnippetDraft => ({
  title: snippet.title,
  description: snippet.description,
  snippet_type: snippet.snippet_type,
  code: snippet.code,
  location: snippet.location,
  is_active: snippet.is_active,
  priority: snippet.priority,
  tags: [...snippet.tags],
});

/** Field defaults, so a partial update can be normalised through the same toRow(). */
export const blankDraft: SnippetDraft = {
  title: '', description: '', snippet_type: 'css', code: '', location: 'frontend', is_active: false, priority: 10, tags: [],
};

const toRow = (draft: SnippetDraft) => ({
  title: draft.title.trim().slice(0, 255),
  description: draft.description.slice(0, 5000),
  snippet_type: draft.snippet_type,
  code: draft.code,
  location: draft.location,
  is_active: draft.is_active,
  priority: Math.min(1000, Math.max(0, Math.round(draft.priority))),
  tags: draft.tags.map((tag) => tag.trim()).filter(Boolean).slice(0, 25),
});

export async function createSnippet(draft: SnippetDraft): Promise<CodeSnippet> {
  const { data, error } = await getSupabaseClient().from('code_snippets').insert(toRow(draft)).select();
  if (error) throw new Error(describe(error, 'The snippet was not created:'));
  const [row] = (data || []) as Array<Record<string, unknown>>;
  if (!row) throw new Error(REFUSED);
  return normalizeSnippet(row);
}

export async function updateSnippet(id: string, draft: Partial<SnippetDraft>): Promise<CodeSnippet> {
  // Only the fields the caller passed, so toggling `is_active` from the list never rewrites code
  // that someone else has open in the editor.
  const full = toRow({ ...blankDraft, ...draft });
  const body: Record<string, unknown> = {};
  for (const key of Object.keys(draft) as Array<keyof SnippetDraft>) body[key] = full[key];

  const { data, error } = await getSupabaseClient().from('code_snippets').update(body).eq('id', id).select();
  if (error) throw new Error(describe(error, 'The snippet was not saved:'));
  const [row] = (data || []) as Array<Record<string, unknown>>;
  if (!row) throw new Error(REFUSED);
  return normalizeSnippet(row);
}

export async function deleteSnippet(id: string): Promise<void> {
  const { data, error } = await getSupabaseClient().from('code_snippets').delete().eq('id', id).select('id');
  if (error) throw new Error(describe(error, 'The snippet was not deleted:'));
  if (!(data || []).length) throw new Error(REFUSED);
}

/**
 * Inserts rows from a backup file. `mode` is what to do when a row's id already exists:
 * 'overwrite' replaces it, 'keep-both' inserts a copy under a new id.
 */
export async function restoreSnippets(
  rows: Array<SnippetDraft & { id?: string }>,
  options: { mode: 'overwrite' | 'keep-both'; activate: boolean },
): Promise<{ imported: number }> {
  if (!rows.length) return { imported: 0 };
  const supabase = getSupabaseClient();
  const prepared = rows.map((row) => toRow({ ...row, is_active: options.activate && row.is_active }));

  // 'keep-both' sends no id at all, so the database generates one and the existing row survives.
  // 'overwrite' upserts on the backup's id; a row the backup did not carry an id for is new either
  // way, and gets one here so the whole batch can go through a single upsert.
  const { data, error } = options.mode === 'keep-both'
    ? await supabase.from('code_snippets').insert(prepared).select('id')
    : await supabase.from('code_snippets')
      .upsert(prepared.map((row, index) => ({ ...row, id: rows[index].id || crypto.randomUUID() })), { onConflict: 'id' })
      .select('id');
  if (error) throw new Error(describe(error, 'The snippets were not imported:'));
  if (!(data || []).length) throw new Error(REFUSED);
  return { imported: (data || []).length };
}

export interface SnippetsServerStatus {
  gemini: boolean;
  model: string;
}

/** null when the Node server is not reachable (Vite dev without npm start, or a static host). */
export async function fetchServerStatus(): Promise<SnippetsServerStatus | null> {
  try {
    const { data } = await getSupabaseClient().auth.getSession();
    const response = await fetch('/api/plugins/rwp-code-snippets/status', {
      headers: { Authorization: `Bearer ${data.session?.access_token || ''}` },
    });
    if (!response.ok) return null;
    return await response.json() as SnippetsServerStatus;
  } catch {
    return null;
  }
}
