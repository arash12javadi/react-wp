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
  layout: 'boxed' | 'wide' | 'full' | string;
  show_sidebar: boolean;
  seo_title?: string | null;
  meta_description?: string | null;
  focus_keyword?: string | null;
  canonical_url?: string | null;
  noindex?: boolean;
  og_title?: string | null;
  og_description?: string | null;
  og_image?: string | null;
  twitter_card?: string | null;
  comments_open?: boolean;
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

export type MediaProvider = 'cloudinary' | 'imagekit' | 'external';

export interface MediaItem {
  id: string;
  title: string | null;
  alt_text: string | null;
  url: string;
  provider: MediaProvider;
  file_name: string | null;
  provider_file_id: string | null;
  width: number | null;
  height: number | null;
  bytes: number | null;
  mime_type: string | null;
  uploaded_by?: string | null;
  created_at: string;
}
