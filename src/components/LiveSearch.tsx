import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { getSupabaseClient } from '../lib/db';
import './LiveSearch.css';

interface Result {
  id: number;
  title: string;
  slug: string;
  is_post: boolean;
}

export interface LiveSearchProps {
  placeholder?: string;
  /** The Go button's text; an empty string hides the button. */
  buttonLabel?: string;
  /** How many results the dropdown shows. */
  limit?: number;
  className?: string;
  /** For a label that sits outside, e.g. a widget title. */
  inputId?: string;
}

/** % and _ are ilike wildcards; a visitor typing them means the characters. */
const likePattern = (term: string) => `%${term.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;

/**
 * The public search box: a Go button that opens /search?s=…, and published pages and posts
 * listed as you type. Used by the Theme Editor's Search block, the Search widget, archives and
 * the Page Builder's WordPress Search widget. Class names are global (rwp-live-search*) so
 * Custom CSS can restyle it.
 */
export default function LiveSearch({ placeholder = 'Search posts…', buttonLabel = 'Go', limit = 6, className = '', inputId }: LiveSearchProps) {
  const [term, setTerm] = useState(() => new URLSearchParams(window.location.search).get('s') || '');
  const [results, setResults] = useState<Result[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const generatedId = useId();
  const id = inputId || `live-search-${generatedId}`;
  const listId = `${id}-results`;
  const rootRef = useRef<HTMLFormElement>(null);
  const trimmed = term.trim();

  useEffect(() => {
    if (trimmed.length < 2) {
      setResults(null);
      setLoading(false);
      return undefined;
    }
    let current = true;
    setLoading(true);
    // Debounced, so typing a word sends one request rather than one per key.
    const timer = window.setTimeout(() => {
      void getSupabaseClient().from('pages').select('id,title,slug,is_post')
        .eq('status', 'published').eq('is_site_template', false)
        .ilike('title', likePattern(trimmed))
        .order('is_post', { ascending: false }).order('created_at', { ascending: false })
        .limit(limit)
        .then(({ data, error }) => {
          if (!current) return;
          // A failed request is not "nothing found"; Go still opens the full results page.
          setFailed(Boolean(error));
          setResults(error ? [] : (data || []) as Result[]);
          setActive(-1);
          setLoading(false);
        });
    }, 250);
    return () => { current = false; window.clearTimeout(timer); };
  }, [limit, trimmed]);

  // Closes when focus or a click goes anywhere outside the box.
  useEffect(() => {
    if (!open) return undefined;
    const close = (event: Event) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('focusin', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('focusin', close);
    };
  }, [open]);

  const allResultsHref = `/search?s=${encodeURIComponent(trimmed)}`;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (active >= 0 && results?.[active]) window.location.href = `/${results[active].slug}`;
    else if (trimmed) window.location.href = allResultsHref;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setOpen(false);
      setActive(-1);
      return;
    }
    if (!results?.length || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return;
    event.preventDefault();
    setOpen(true);
    setActive((index) => (event.key === 'ArrowDown' ? Math.min(index + 1, results.length - 1) : Math.max(index - 1, -1)));
  };

  const showList = open && trimmed.length >= 2 && (loading || results !== null);

  return (
    <form ref={rootRef} className={`rwp-live-search ${className}`.trim()} role="search" onSubmit={submit}>
      <label className="rwp-live-search-label" htmlFor={id}>{placeholder}</label>
      <div className="rwp-live-search-row">
        <input
          id={id}
          type="search"
          value={term}
          autoComplete="off"
          placeholder={placeholder}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showList}
          aria-controls={listId}
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          onChange={(event) => { setTerm(event.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        {buttonLabel && <button type="submit" className="rwp-live-search-go">{buttonLabel}</button>}
      </div>
      {showList && (
        <ul id={listId} className="rwp-live-search-results" role="listbox" aria-label="Search results">
          {loading && !results && <li className="rwp-live-search-note">Searching…</li>}
          {results?.length === 0 && (
            <li className="rwp-live-search-note">
              {failed ? 'Quick results are unavailable right now. Press Enter to search.' : `Nothing found for “${trimmed}”.`}
            </li>
          )}
          {results?.map((result, index) => (
            <li key={result.id} id={`${listId}-${index}`} role="option" aria-selected={index === active}
              className={index === active ? 'rwp-live-search-active' : undefined}>
              <a href={`/${result.slug}`}>
                <span>{result.title}</span>
                <small>{result.is_post ? 'Post' : 'Page'}</small>
              </a>
            </li>
          ))}
          {results && results.length > 0 && (
            <li className="rwp-live-search-all"><a href={allResultsHref}>See all results for “{trimmed}” →</a></li>
          )}
        </ul>
      )}
    </form>
  );
}
