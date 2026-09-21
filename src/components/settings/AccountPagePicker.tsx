import { useMemo, useState } from 'react';
import { describeDbError, getSupabaseClient } from '../../lib/db';
import { accountPageChoices, isSafeUrl, type AccountPageDefinition } from '../../lib/account';
import styles from '../SiteSettings.module.css';

export interface PickerPage {
  id: number;
  title: string;
  status?: string | null;
}

interface AccountPagePickerProps {
  definition: AccountPageDefinition;
  /** '' (built-in), a page id, or 'custom'. */
  pageId: string;
  url: string;
  pages: PickerPage[];
  onChange: (pageId: string, url: string) => void;
  /** A page was created here; the parent adds it to its list. */
  onPageCreated: (page: PickerPage) => void;
}

const pluginValue = (url: string) => `plugin:${url}`;

/**
 * Chooses what one account path (/login, /profile …) shows, the way Settings → Site chooses the
 * home page: the built-in screen, any page, a screen a plugin offers (the shop's My Account) or
 * any other address.
 */
export default function AccountPagePicker({ definition, pageId, url, pages, onChange, onPageCreated }: AccountPagePickerProps) {
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const choices = useMemo(() => accountPageChoices(definition.key), [definition.key]);
  const inputId = `account-page-${definition.key}`;

  const plugin = pageId === 'custom' ? choices.find((choice) => choice.url === url.trim()) : undefined;
  const value = plugin ? pluginValue(plugin.url) : pageId;
  const chosen = /^\d+$/.test(pageId) ? pages.find((page) => String(page.id) === pageId) : undefined;
  const unsafe = pageId === 'custom' && !plugin && url.trim() !== '' && !isSafeUrl(url.trim());

  const select = (next: string) => {
    setError('');
    if (next.startsWith('plugin:')) onChange('custom', next.slice('plugin:'.length));
    else onChange(next, next === 'custom' ? (plugin ? '' : url) : '');
  };

  /** A published page holding the screen's shortcode, like the one created on install. */
  const createPage = async () => {
    setCreating(true);
    setError('');
    try {
      const supabase = getSupabaseClient();
      const { data: userData } = await supabase.auth.getUser();
      const { data: taken } = await supabase.from('pages').select('slug').like('slug', `${definition.slug}%`);
      const used = new Set(((taken || []) as Array<{ slug: string }>).map((row) => row.slug));
      let slug = definition.slug;
      for (let n = 2; used.has(slug); n += 1) slug = `${definition.slug}-${n}`;
      const { data, error: insertError } = await supabase.from('pages').insert({
        title: definition.title, slug, content: `<p>${definition.shortcode}</p>`, status: 'published',
        is_post: false, noindex: true, comments_open: false, author_id: userData.user?.id,
      }).select('id,title,status');
      if (insertError) throw insertError;
      const created = (data || [])[0] as PickerPage | undefined;
      if (!created) throw new Error('The page was not created: row level security blocked it. Creating published pages needs the publish_pages capability.');
      onPageCreated(created);
      onChange(String(created.id), '');
    } catch (createError: unknown) {
      setError(`Could not create the ${definition.title} page: ${describeDbError(createError)}`);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className={styles.accountPage}>
      <label htmlFor={inputId}>{definition.label}</label>
      <span className={styles.iconRow}>
        <select id={inputId} value={value} onChange={(event) => select(event.target.value)}>
          <option value="">Built-in screen</option>
          <optgroup label="Pages">
            {pages.map((page) => (
              <option key={page.id} value={String(page.id)}>
                {page.title}{page.status && page.status !== 'published' ? ` (${page.status})` : ''}
              </option>
            ))}
          </optgroup>
          {choices.length > 0 && (
            <optgroup label="Plugin screens">
              {choices.map((choice) => <option key={choice.url} value={pluginValue(choice.url)}>{choice.label}</option>)}
            </optgroup>
          )}
          <option value="custom">Custom address…</option>
        </select>
        <a className={styles.secondaryButton} href={definition.path} target="_blank" rel="noreferrer">View</a>
        {chosen && <a className={styles.secondaryButton} href={`/admin?section=content&edit=${chosen.id}`}>Edit page</a>}
        {pageId === '' && (
          <button type="button" className={styles.secondaryButton} disabled={creating} onClick={() => void createPage()}>
            {creating ? 'Creating…' : 'Create page'}
          </button>
        )}
      </span>
      {pageId === 'custom' && !plugin && (
        <input value={url} onChange={(event) => onChange('custom', event.target.value)} placeholder="/my-account or https://…"
          aria-label={`${definition.label} address`} />
      )}
      <span className={styles.help}>
        {definition.description}{' '}
        {chosen && chosen.status !== 'published'
          ? <strong>This page is not published, so {definition.path} shows the built-in screen until it is.</strong>
          : pageId === ''
            ? <>Create page adds a page containing <code>{definition.shortcode}</code>, which you can then edit like any other page.</>
            : <>Links to <code>{definition.path}</code> keep working whatever you choose.</>}
      </span>
      {unsafe && <span className={styles.help}><strong>Use a path starting with / or an http(s) address; this one is ignored.</strong></span>}
      {error && <div className={styles.error} role="alert"><span>{error}</span></div>}
    </div>
  );
}
