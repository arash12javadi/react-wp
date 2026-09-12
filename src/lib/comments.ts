import { describeDbError, getSupabaseClient } from './db';

export type CommentStatus = 'pending' | 'approved' | 'spam';

export interface Comment {
  id: number;
  page_id: number | null;
  parent_id: number | null;
  author_id: string | null;
  author_name: string | null;
  author_email: string | null;
  content: string;
  status: CommentStatus | string;
  created_at: string;
}

export interface CommentWithAuthor extends Comment {
  author?: { display_name: string | null; avatar_url: string | null; email: string | null } | null;
  page?: { title: string; slug: string } | null;
}

export interface CommentNode extends CommentWithAuthor {
  depth: number;
  children: CommentNode[];
}

export const explainCommentError = (error: unknown): string => {
  const message = describeDbError(error);
  // A missing relationship is not a missing table. Conflating the two sent the last round
  // of debugging at the wrong migration entirely.
  if (/relationship|PGRST200/i.test(message)) {
    return 'Comment authors cannot be linked to profiles. Run supabase/migrations/20260916_comment_author_fk.sql in the Supabase SQL Editor, then reload.';
  }
  if (/schema cache|PGRST205/i.test(message) || /column .*(page_id|parent_id|author_id)/i.test(message)) {
    return 'The comments table has not been migrated yet. Run supabase/migrations/20260915_comments_profiles_widgets.sql in the Supabase SQL Editor, then reload.';
  }
  if (/row-level security|violates row-level/i.test(message)) {
    return 'The database rejected this. You must be signed in to comment.';
  }
  return message;
};

const selectWithAuthor =
  '*,author:profiles!comments_author_id_fkey(display_name,avatar_url,email),page:pages(title,slug)';

export const fetchPageComments = async (pageId: number): Promise<CommentWithAuthor[]> => {
  const { data, error } = await getSupabaseClient()
    .from('comments')
    .select('*,author:profiles!comments_author_id_fkey(display_name,avatar_url,email)')
    .eq('page_id', pageId)
    .order('created_at');
  if (error) throw error;
  return (data || []) as CommentWithAuthor[];
};

export const fetchAllComments = async (status: string): Promise<CommentWithAuthor[]> => {
  let query = getSupabaseClient().from('comments').select(selectWithAuthor).order('created_at', { ascending: false });
  if (status !== 'all') query = query.eq('status', status);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as CommentWithAuthor[];
};

/** Flat rows to a tree. Depth is capped for rendering only; the data stays fully nested. */
export const buildCommentTree = (comments: CommentWithAuthor[], maxDepth: number): CommentNode[] => {
  const byId = new Map<number, CommentNode>();
  comments.forEach((comment) => byId.set(comment.id, { ...comment, depth: 0, children: [] }));

  const roots: CommentNode[] = [];
  byId.forEach((node) => {
    const parent = node.parent_id !== null ? byId.get(node.parent_id) : undefined;
    if (parent) {
      node.depth = Math.min(parent.depth + 1, maxDepth);
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  });
  return roots;
};

export const countComments = (nodes: CommentNode[]): number =>
  nodes.reduce((total, node) => total + 1 + countComments(node.children), 0);
