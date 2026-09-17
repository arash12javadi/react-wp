import { describeDbError, getSupabaseClient } from '../../../src/lib/db';
import { findNode, walkNodes } from './tree';
import type { BuilderDocument, BuilderNode, BuilderPage, BuilderTemplate, SectionNode, TemplateType } from './types';

export const MIGRATION = 'supabase/migrations/20260918_page_builder.sql';

/** Maps "column/table does not exist" to the migration that creates it; passes everything else through. */
export function explainError(error: unknown, action: string): Error {
  const message = describeDbError(error);
  if (/builder_data|is_builder_enabled|elementor_templates|form_submissions|page_builder_revisions|builder_form_settings|builder_submit_form/.test(message)
    && /does not exist|schema cache|PGRST20[0-9]|42703|42P01|Could not find/i.test(message)) {
    return new Error(`${action} failed because the page builder tables are missing. Run ${MIGRATION} in the Supabase SQL Editor, then reload. (${message})`);
  }
  return new Error(`${action} failed: ${message}`);
}

// Private form settings -----------------------------------------------------------------------
// Form recipients are edited on the widget as settings.private_*, but never saved into
// builder_data (which visitors can read). They are split out into builder_form_settings.

const PRIVATE_PREFIX = 'private_';

interface FormSettingsRow { form_id: string; email_to: string | null; email_subject: string | null }

export function stripPrivate(content: SectionNode[]): { content: SectionNode[]; forms: FormSettingsRow[] } {
  const forms: FormSettingsRow[] = [];
  const copy = JSON.parse(JSON.stringify(content)) as SectionNode[];
  walkNodes(copy, (node) => {
    const privateKeys = Object.keys(node.settings || {}).filter((key) => key.startsWith(PRIVATE_PREFIX));
    if (node.type === 'form') {
      forms.push({
        form_id: node.id,
        email_to: String(node.settings.private_email_to || '').trim() || null,
        email_subject: String(node.settings.private_email_subject || '').trim() || null,
      });
    }
    privateKeys.forEach((key) => { delete node.settings[key]; });
  });
  return { content: copy, forms };
}

// Pages ------------------------------------------------------------------------------------------

export async function loadBuilderPage(id: number): Promise<BuilderPage> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('pages').select('*').eq('id', id).maybeSingle();
  if (error) throw explainError(error, 'Loading the page');
  if (!data) throw new Error(`Page ${id} was not found, or your role cannot edit it. Authors and contributors can only open their own pages.`);
  if (!('builder_data' in data)) throw new Error(`The pages table has no builder_data column yet. Run ${MIGRATION} in the Supabase SQL Editor, then reload.`);
  const page = data as BuilderPage;
  if (page.builder_data && Array.isArray(page.builder_data.content)) {
    const { data: rows } = await supabase.from('builder_form_settings').select('form_id,email_to,email_subject').eq('page_id', id);
    (rows as FormSettingsRow[] | null || []).forEach((row) => {
      const node = findNode(page.builder_data!, row.form_id);
      if (node) node.settings = { ...node.settings, private_email_to: row.email_to || '', private_email_subject: row.email_subject || '' };
    });
  }
  return page;
}

export class SaveConflictError extends Error {
  constructor(public readonly savedAt: string) {
    super(`Someone saved this page at ${new Date(savedAt).toLocaleTimeString()} since you opened it. Reload to get their version, or choose "Save anyway" to overwrite it.`);
  }
}

export interface SaveInput {
  page: BuilderPage;
  doc: BuilderDocument;
  title: string;
  status: string;
  layout: string;
  /** SEO columns from the SEO tab; only columns the page row already has. */
  seo?: Record<string, string | boolean>;
  /** Skip the "changed since you opened it" check. */
  force?: boolean;
}

export async function saveBuilderPage({ page, doc, title, status, layout, seo, force }: SaveInput): Promise<{ page: BuilderPage; warning?: string }> {
  const supabase = getSupabaseClient();
  const { content, forms } = stripPrivate(doc.content);
  const payload = {
    ...(seo || {}),
    title: title.trim() || page.title,
    status,
    layout,
    builder_data: { version: 1, settings: doc.settings, content },
    is_builder_enabled: true,
    updated_at: new Date().toISOString(),
  };
  let query = supabase.from('pages').update(payload).eq('id', page.id);
  if (!force) query = query.eq('updated_at', page.updated_at);
  const { data, error } = await query.select('*');
  if (error) throw explainError(error, 'Saving');

  // An update blocked by row level security, or filtered out by the updated_at check, returns
  // no error and no rows. Work out which one it was so the message names the real cause.
  if (!data?.length) {
    const { data: current } = await supabase.from('pages').select('id,updated_at').eq('id', page.id).maybeSingle();
    if (!current) throw new Error('This page no longer exists, or your role can no longer see it.');
    if (!force && current.updated_at !== page.updated_at) throw new SaveConflictError(current.updated_at);
    throw new Error(status === 'published'
      ? "The database refused the save. Publishing needs the publish_posts capability (Author or above), and editing someone else's page needs Editor or above."
      : "The database refused the save. Your role can only edit pages you wrote; editing someone else's page needs Editor or above.");
  }

  const saved = data[0] as BuilderPage;
  let warning: string | undefined;
  try {
    await syncFormSettings(page.id, forms);
  } catch (syncError) {
    warning = `The page was saved, but the form email settings were not: ${describeDbError(syncError)}`;
  }
  return { page: { ...saved, builder_data: doc }, warning };
}

async function syncFormSettings(pageId: number, forms: FormSettingsRow[]) {
  const supabase = getSupabaseClient();
  const rows = forms.map((form) => ({ ...form, page_id: pageId, updated_at: new Date().toISOString() }));
  if (rows.length) {
    const { error } = await supabase.from('builder_form_settings').upsert(rows, { onConflict: 'page_id,form_id' });
    if (error) throw error;
  }
  let removal = supabase.from('builder_form_settings').delete().eq('page_id', pageId);
  if (rows.length) removal = removal.not('form_id', 'in', `(${rows.map((row) => `"${row.form_id.replace(/"/g, '')}"`).join(',')})`);
  const { error } = await removal;
  if (error) throw error;
}

export async function disableBuilder(pageId: number): Promise<void> {
  const { data, error } = await getSupabaseClient().from('pages')
    .update({ is_builder_enabled: false, updated_at: new Date().toISOString() }).eq('id', pageId).select('id');
  if (error) throw explainError(error, 'Switching back to the classic editor');
  if (!data?.length) throw new Error("Your role cannot edit this page, so the builder could not be switched off.");
}

// Revisions ---------------------------------------------------------------------------------------

export interface RevisionSummary { id: number; created_at: string; author: string }

export async function listRevisions(pageId: number): Promise<RevisionSummary[]> {
  const { data, error } = await getSupabaseClient()
    .from('page_builder_revisions')
    .select('id,created_at,profiles(display_name,email)')
    .eq('page_id', pageId)
    .order('created_at', { ascending: false });
  if (error) throw explainError(error, 'Loading revisions');
  return (data || []).map((row) => {
    const profile = (Array.isArray(row.profiles) ? row.profiles[0] : row.profiles) as { display_name?: string; email?: string } | null;
    return { id: row.id as number, created_at: row.created_at as string, author: profile?.display_name || profile?.email || 'Unknown' };
  });
}

export async function loadRevision(id: number): Promise<BuilderDocument> {
  const { data, error } = await getSupabaseClient().from('page_builder_revisions').select('builder_data').eq('id', id).maybeSingle();
  if (error) throw explainError(error, 'Loading the revision');
  if (!data) throw new Error('That revision no longer exists.');
  return data.builder_data as BuilderDocument;
}

// Templates -----------------------------------------------------------------------------------------

export async function listTemplates(): Promise<BuilderTemplate[]> {
  const { data, error } = await getSupabaseClient().from('elementor_templates').select('*').order('updated_at', { ascending: false });
  if (error) throw explainError(error, 'Loading templates');
  return (data || []) as BuilderTemplate[];
}

export async function createTemplate(title: string, type: TemplateType, content: BuilderNode[]): Promise<BuilderTemplate> {
  const supabase = getSupabaseClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) throw new Error('Sign in again to save templates.');
  const { content: clean } = stripPrivate(content as SectionNode[]);
  const { data, error } = await supabase.from('elementor_templates')
    .insert({ title: title.trim() || 'Untitled template', type, builder_data: { content: clean }, created_by: userData.user.id })
    .select('*').single();
  if (error) throw explainError(error, 'Saving the template');
  return data as BuilderTemplate;
}

export async function renameTemplate(id: string, title: string): Promise<void> {
  const { data, error } = await getSupabaseClient().from('elementor_templates').update({ title }).eq('id', id).select('id');
  if (error) throw explainError(error, 'Renaming the template');
  if (!data?.length) throw new Error('You can only rename templates you created, unless you are an Editor or above.');
}

export async function deleteTemplate(id: string): Promise<void> {
  const { data, error } = await getSupabaseClient().from('elementor_templates').delete().eq('id', id).select('id');
  if (error) throw explainError(error, 'Deleting the template');
  if (!data?.length) throw new Error('You can only delete templates you created, unless you are an Editor or above.');
}

// Submissions -----------------------------------------------------------------------------------------

export interface Submission {
  id: string;
  form_id: string;
  form_name: string | null;
  page_id: number | null;
  fields_data: Array<{ id: string; label: string; type: string; value: string }>;
  status: 'new' | 'read' | 'spam';
  email_status: string | null;
  created_at: string;
  pages: { title: string; slug: string } | null;
}

export async function listSubmissions(filter: { status?: string; formId?: string; page: number; perPage: number }) {
  const from = (filter.page - 1) * filter.perPage;
  let query = getSupabaseClient().from('form_submissions')
    .select('*,pages(title,slug)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, from + filter.perPage - 1);
  if (filter.status) query = query.eq('status', filter.status);
  if (filter.formId) query = query.eq('form_id', filter.formId);
  const { data, error, count } = await query;
  if (error) throw explainError(error, 'Loading submissions');
  return { rows: (data || []) as Submission[], total: count || 0 };
}

export async function setSubmissionStatus(ids: string[], status: Submission['status']) {
  const { data, error } = await getSupabaseClient().from('form_submissions').update({ status }).in('id', ids).select('id');
  if (error) throw explainError(error, 'Updating submissions');
  if (!data?.length) throw new Error('Your role cannot manage form submissions (it needs the edit_pages capability: Editor or above).');
}

export async function deleteSubmissions(ids: string[]) {
  const { data, error } = await getSupabaseClient().from('form_submissions').delete().in('id', ids).select('id');
  if (error) throw explainError(error, 'Deleting submissions');
  if (!data?.length) throw new Error('Your role cannot delete form submissions (it needs the edit_pages capability: Editor or above).');
}

/** Site pages and posts: everything except site templates (Page Builder → Templates lists those). */
export async function listBuilderPages() {
  const columns = 'id,title,slug,status,is_post,is_builder_enabled,updated_at,author_id';
  const supabase = getSupabaseClient();
  let { data, error } = await supabase.from('pages').select(columns).eq('is_site_template', false).order('updated_at', { ascending: false });
  // Before the site templates migration there are no templates to leave out, so list everything.
  if (error && /is_site_template/.test(describeDbError(error))) {
    ({ data, error } = await supabase.from('pages').select(columns).order('updated_at', { ascending: false }));
  }
  if (error) throw explainError(error, 'Loading pages');
  return (data || []) as Array<Pick<BuilderPage, 'id' | 'title' | 'slug' | 'status' | 'is_post' | 'is_builder_enabled' | 'updated_at' | 'author_id'>>;
}

export async function fetchServerStatus(): Promise<{ smtp: boolean; secretKey: boolean } | null> {
  const { data } = await getSupabaseClient().auth.getSession();
  const response = await fetch('/api/plugins/rwp-page-builder/status', {
    headers: data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {},
  }).catch(() => null);
  if (!response?.ok) return null;
  return response.json().catch(() => null);
}
