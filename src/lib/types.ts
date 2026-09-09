export type PostStatus = 'draft' | 'published';

export interface Post {
  id: number;
  title: string;
  slug: string;
  content: string;
  excerpt: string;
  status: PostStatus | string;
  author_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface PostInput {
  title: string;
  slug: string;
  content: string;
  excerpt: string;
  status: PostStatus;
}
