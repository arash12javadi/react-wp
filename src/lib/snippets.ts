/**
 * The public.code_snippets contract: the row shape, what each location means, and the query the
 * public site makes.
 *
 * This lives in core rather than in plugins/rwp-code-snippets because src/core/SnippetInjector.tsx
 * runs the snippets, and core must not import plugin code (a deleted plugin folder would stop the
 * site from building). The plugin's admin screens import from here instead.
 */

import { getSupabaseClient } from './db';

export const snippetTypes = ['css', 'javascript', 'html', 'hook'] as const;
export type SnippetType = (typeof snippetTypes)[number];

export const snippetLocations = ['head', 'footer', 'admin', 'frontend', 'everywhere'] as const;
export type SnippetLocation = (typeof snippetLocations)[number];

export interface CodeSnippet {
  id: string;
  title: string;
  description: string;
  snippet_type: SnippetType;
  code: string;
  location: SnippetLocation;
  is_active: boolean;
  priority: number;
  tags: string[];
  created_at: string;
  updated_at: string;
  created_by?: string | null;
}

/** What a new or edited snippet sends to the database. */
export type SnippetDraft = Pick<
  CodeSnippet,
  'title' | 'description' | 'snippet_type' | 'code' | 'location' | 'is_active' | 'priority' | 'tags'
>;

export type SnippetSurface = 'public' | 'admin';

export const snippetTypeLabels: Record<SnippetType, string> = {
  css: 'CSS',
  javascript: 'JavaScript',
  html: 'HTML',
  hook: 'React hook',
};

export const snippetLocationLabels: Record<SnippetLocation, string> = {
  head: 'Public site · in <head>',
  footer: 'Public site · end of <body>',
  frontend: 'Public site',
  admin: 'Admin screens only',
  everywhere: 'Public site and admin',
};

/**
 * Where a location runs. The three public placements (head, footer, frontend) mirror WordPress's
 * wp_head and wp_footer and never reach /admin; 'admin' and 'everywhere' are the two that do.
 * Keeping the admin free of frontend snippets matters: a snippet that throws while an
 * administrator is editing would otherwise be hard to switch off again.
 */
export const runsOn = (location: SnippetLocation, surface: SnippetSurface): boolean =>
  location === 'everywhere' || (surface === 'admin' ? location === 'admin' : location !== 'admin');

/** Lower priority first, then title — the same order as hook callbacks. */
export const bySnippetOrder = (a: CodeSnippet, b: CodeSnippet) =>
  (a.priority - b.priority) || a.title.localeCompare(b.title);

/** Rows are normalised here so a hand-edited tags column cannot crash the injector. */
export const normalizeSnippet = (row: Record<string, unknown>): CodeSnippet => ({
  id: String(row.id),
  title: String(row.title ?? ''),
  description: String(row.description ?? ''),
  snippet_type: (snippetTypes as readonly string[]).includes(String(row.snippet_type))
    ? row.snippet_type as SnippetType
    : 'css',
  code: String(row.code ?? ''),
  location: (snippetLocations as readonly string[]).includes(String(row.location))
    ? row.location as SnippetLocation
    : 'frontend',
  is_active: row.is_active === true,
  priority: Number.isFinite(Number(row.priority)) ? Number(row.priority) : 10,
  tags: Array.isArray(row.tags) ? row.tags.filter((tag): tag is string => typeof tag === 'string') : [],
  created_at: String(row.created_at ?? ''),
  updated_at: String(row.updated_at ?? ''),
  created_by: typeof row.created_by === 'string' ? row.created_by : null,
});

/**
 * The active snippets for one surface. RLS lets anyone read active rows, so this works before
 * anyone signs in; inactive rows are invisible to everyone but a settings manager.
 */
export async function fetchActiveSnippets(surface: SnippetSurface): Promise<CodeSnippet[]> {
  const { data, error } = await getSupabaseClient()
    .from('code_snippets')
    .select('*')
    .eq('is_active', true)
    .order('priority', { ascending: true });
  if (error) throw error;
  return ((data || []) as Array<Record<string, unknown>>)
    .map(normalizeSnippet)
    .filter((snippet) => runsOn(snippet.location, surface))
    .sort(bySnippetOrder);
}
