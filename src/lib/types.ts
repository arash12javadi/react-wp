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

export interface Page {
  id: number;
  title: string;
  slug: string;
  content: string;
  excerpt: string;
  status: PostStatus | string;
  is_post: boolean;
  category_id?: string | null;
  featured_category_id?: string | null;
  posts_limit: number;
  display_layout: 'grid' | 'list' | string;
  author_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
}
