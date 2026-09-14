/**
 * Dynamic data tags: {{page.title}}, {{user.name|Guest}}, {{url.param:ref}}.
 *
 * Tags resolve to plain text. Rich text widgets HTML-escape the value before substituting,
 * so a post title containing markup cannot inject HTML.
 */

export interface DynamicPost {
  id: number;
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  created_at: string;
  updated_at: string;
  featured_image: string;
  author_name: string;
  category_name: string;
  category_slug: string;
}

export interface DynamicContext {
  page: DynamicPost | null;
  user: { id: string; name: string; email: string } | null;
  site: { title: string; tagline: string; url: string };
}

export const dynamicTags: Array<{ tag: string; label: string; group: string }> = [
  { tag: 'page.title', label: 'Title', group: 'Page / post' },
  { tag: 'page.excerpt', label: 'Excerpt', group: 'Page / post' },
  { tag: 'page.url', label: 'URL', group: 'Page / post' },
  { tag: 'page.date', label: 'Published date', group: 'Page / post' },
  { tag: 'page.modified', label: 'Modified date', group: 'Page / post' },
  { tag: 'page.author', label: 'Author name', group: 'Page / post' },
  { tag: 'page.category', label: 'Category', group: 'Page / post' },
  { tag: 'post.featured_image', label: 'Featured image URL', group: 'Page / post' },
  { tag: 'user.name', label: 'Name', group: 'Signed-in user' },
  { tag: 'user.email', label: 'Email', group: 'Signed-in user' },
  { tag: 'site.title', label: 'Site title', group: 'Site' },
  { tag: 'site.tagline', label: 'Tagline', group: 'Site' },
  { tag: 'site.url', label: 'Home URL', group: 'Site' },
  { tag: 'date.today', label: "Today's date", group: 'Date' },
  { tag: 'date.year', label: 'Current year', group: 'Date' },
  { tag: 'url.param:NAME', label: 'Query string parameter', group: 'URL' },
];

const formatDate = (value: string | undefined) => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
};

export function resolveTag(tag: string, context: DynamicContext): string {
  const [key, argument] = tag.split(':');
  // post.* is an alias for page.*: the current page is the post on a single post.
  const normalised = key.replace(/^post\./, 'page.');
  const page = context.page;
  switch (normalised) {
    case 'page.title': return page?.title || '';
    case 'page.excerpt': return page?.excerpt || '';
    case 'page.url': return page ? `${context.site.url}/${page.slug}` : '';
    case 'page.slug': return page?.slug || '';
    case 'page.date': return formatDate(page?.created_at);
    case 'page.modified': return formatDate(page?.updated_at);
    case 'page.author': return page?.author_name || '';
    case 'page.category': return page?.category_name || '';
    case 'page.featured_image': return page?.featured_image || '';
    case 'page.id': return page ? String(page.id) : '';
    case 'user.name': return context.user?.name || '';
    case 'user.email': return context.user?.email || '';
    case 'site.title': return context.site.title;
    case 'site.tagline': return context.site.tagline;
    case 'site.url': return context.site.url;
    case 'date.today': return new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    case 'date.year': return String(new Date().getFullYear());
    case 'url.param': {
      if (typeof window === 'undefined' || !argument) return '';
      return new URLSearchParams(window.location.search).get(argument) || '';
    }
    default: return '';
  }
}

const tagPattern = /\{\{\s*([\w.]+(?::[\w-]+)?)\s*(?:\|([^}]*))?\}\}/g;

export const hasTags = (text: unknown) => typeof text === 'string' && text.includes('{{');

export function resolveText(text: unknown, context: DynamicContext | null, escape?: (value: string) => string): string {
  const value = typeof text === 'string' ? text : text === undefined || text === null ? '' : String(text);
  if (!context || !value.includes('{{')) return value;
  return value.replace(tagPattern, (_match, tag: string, fallback: string | undefined) => {
    const resolved = resolveTag(tag, context) || (fallback ?? '').trim();
    return escape ? escape(resolved) : resolved;
  });
}

export const escapeHtml = (value: string) => value
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
