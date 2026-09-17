import { describeDbError, getSupabaseClient } from './db';
import { rwp } from './rwp';

/** Status values a row in public.pages can hold. 'trash' needs the 20260926 migration. */
export type ContentStatus = 'draft' | 'published' | 'trash';

export const trashMigration = 'supabase/migrations/20260926_bulk_actions_trash.sql';

interface ContentRef {
  id: number;
  title?: string;
  is_post?: boolean;
  is_site_template?: boolean;
}

/** Turns failures of bulk content writes into their real cause. */
export const explainContentError = (error: unknown): string => {
  const message = describeDbError(error);
  if (/pages_status_check/.test(message) || (/violates check constraint/i.test(message) && /status/i.test(message))) {
    return `The database does not accept the "trash" status yet. Run ${trashMigration} in the Supabase SQL Editor, then reload. Re-running it is safe.`;
  }
  if (/row-level security/i.test(message)) {
    return 'The database refused this change under row level security. Publishing needs the publish_posts capability, and changing other people\'s content needs edit_others_posts.';
  }
  return message;
};

const blockedReason =
  'the database skipped them under row level security. Your role can only change its own content (or needs edit_others_posts / delete_others_posts), and publishing needs publish_posts.';

/**
 * Sets the status of several pages/posts. Returns the ids the database actually changed, because
 * RLS skips rows silently instead of raising an error.
 */
export async function setContentStatus(rows: ContentRef[], status: ContentStatus): Promise<{ changed: number[]; blockedReason: string }> {
  if (!rows.length) return { changed: [], blockedReason };
  const { data, error } = await getSupabaseClient()
    .from('pages')
    .update({ status, updated_at: new Date().toISOString() })
    .in('id', rows.map((row) => row.id))
    .select('id');
  if (error) throw new Error(explainContentError(error));
  const changed = ((data || []) as Array<{ id: number }>).map((row) => row.id);
  rows.filter((row) => changed.includes(row.id))
    .forEach((row) => rwp.actions.do(row.is_post ? 'rwp_post_updated' : 'rwp_page_updated', { ...row, status }));
  return { changed, blockedReason };
}

/** Permanently deletes several pages/posts. Returns the ids that were really deleted. */
export async function deleteContent(rows: ContentRef[]): Promise<{ changed: number[]; blockedReason: string }> {
  if (!rows.length) return { changed: [], blockedReason };
  const { data, error } = await getSupabaseClient()
    .from('pages')
    .delete()
    .in('id', rows.map((row) => row.id))
    .select('id');
  if (error) throw new Error(explainContentError(error));
  const changed = ((data || []) as Array<{ id: number }>).map((row) => row.id);
  rows.filter((row) => changed.includes(row.id))
    .forEach((row) => rwp.actions.do(row.is_post ? 'rwp_post_deleted' : 'rwp_page_deleted', row));
  return { changed, blockedReason };
}

export const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
