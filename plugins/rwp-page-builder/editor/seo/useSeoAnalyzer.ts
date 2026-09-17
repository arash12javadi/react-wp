import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getSupabaseClient } from '../../../../src/lib/db';
import { useEditor } from '../store';
import { analyzeSeoPage, type SeoReport } from './seoAnalysis';
import { computeClickDepth, findDuplicateDescriptions, type ClickDepth, type Loadable } from './siteSignals';

const DEBOUNCE_MS = 400;
const CANVAS_ROOT = '[data-rwpb-canvas-root]';

/** True when every change in the batch is editor UI (hover outlines, handles), not page content. */
const onlyChrome = (mutations: MutationRecord[]) => mutations.every((mutation) => {
  const target = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
  if (target?.closest('[data-rwpb-chrome]')) return true;
  if (mutation.type !== 'childList') return false;
  const changed = [...Array.from(mutation.addedNodes), ...Array.from(mutation.removedNodes)];
  return changed.length > 0 && changed.every((node) => node instanceof Element && node.hasAttribute('data-rwpb-chrome'));
});

/**
 * Re-audits the page whenever the layout, the SEO fields, the title or the preview device change,
 * and when widgets finish rendering asynchronously (posts loading, images arriving). Reads the
 * canvas DOM, so it reflects exactly what the widgets output.
 */
export function useSeoAnalyzer(): { report: SeoReport | null; refresh: () => void } {
  const doc = useEditor((state) => state.doc);
  const seo = useEditor((state) => state.seo);
  const page = useEditor((state) => state.page);
  const title = useEditor((state) => state.title);
  const device = useEditor((state) => state.device);
  const [report, setReport] = useState<SeoReport | null>(null);
  // Bytes per image URL from the media library; null = not in the library.
  const [mediaSizes, setMediaSizes] = useState<Map<string, number | null>>(() => new Map());
  const requested = useRef(new Set<string>());
  const [clickDepth, setClickDepth] = useState<Loadable<ClickDepth>>({ state: 'loading' });
  const [duplicateDescriptions, setDuplicateDescriptions] = useState<Loadable<string[]>>({ state: 'loading' });
  const [depthRun, setDepthRun] = useState(0);
  const signals = useMemo(() => ({ clickDepth, duplicateDescriptions }), [clickDepth, duplicateDescriptions]);

  const inputs = useRef({ doc, seo, page, title, device, mediaSizes, signals });
  inputs.current = { doc, seo, page, title, device, mediaSizes, signals };

  // Reads every published page, so it runs when the panel opens, after a save and on Refresh,
  // not on each keystroke.
  useEffect(() => {
    let active = true;
    setClickDepth({ state: 'loading' });
    computeClickDepth({ id: page.id, slug: page.slug })
      .then((value) => { if (active) setClickDepth({ state: 'ready', value }); })
      .catch((error: unknown) => { if (active) setClickDepth({ state: 'error', message: error instanceof Error ? error.message : 'Could not measure click depth.' }); });
    return () => { active = false; };
  }, [page.id, page.slug, page.updated_at, depthRun]);

  useEffect(() => {
    let active = true;
    setDuplicateDescriptions({ state: 'loading' });
    const timer = window.setTimeout(() => {
      findDuplicateDescriptions(page.id, seo.meta_description)
        .then((value) => { if (active) setDuplicateDescriptions({ state: 'ready', value }); })
        .catch((error: unknown) => { if (active) setDuplicateDescriptions({ state: 'error', message: error instanceof Error ? error.message : 'Could not compare descriptions.' }); });
    }, 700);
    return () => { active = false; window.clearTimeout(timer); };
  }, [page.id, seo.meta_description]);

  const run = useCallback(() => {
    const root = document.querySelector<HTMLElement>(CANVAS_ROOT);
    if (!root) return;
    try {
      setReport(analyzeSeoPage({ root, ...inputs.current }));
    } catch (error) {
      // An analyzer bug must never take the editor down; the panel shows the last good report.
      console.error('SEO analysis failed', error);
    }
  }, []);

  const timer = useRef(0);
  const schedule = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(run, DEBOUNCE_MS);
  }, [run]);

  useEffect(() => { schedule(); }, [doc, seo, page, title, device, mediaSizes, signals, schedule]);

  useEffect(() => {
    const root = document.querySelector<HTMLElement>(CANVAS_ROOT);
    if (!root) return undefined;
    const observer = new MutationObserver((mutations) => { if (!onlyChrome(mutations)) schedule(); });
    observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['src', 'href', 'alt', 'loading', 'target', 'rel'] });
    return () => {
      observer.disconnect();
      window.clearTimeout(timer.current);
    };
  }, [schedule]);

  // File sizes for images that come from the media library.
  const imageKey = report?.imageUrls.join('\n') || '';
  useEffect(() => {
    const missing = imageKey.split('\n').filter((url) => url && !requested.current.has(url));
    if (!missing.length) return;
    missing.forEach((url) => requested.current.add(url));
    void (async () => {
      const found = new Map<string, number | null>(missing.map((url) => [url, null]));
      for (let start = 0; start < missing.length; start += 40) {
        const { data } = await getSupabaseClient().from('media').select('url,bytes').in('url', missing.slice(start, start + 40));
        ((data || []) as Array<{ url: string; bytes: number | null }>).forEach((row) => found.set(row.url, row.bytes ?? null));
      }
      setMediaSizes((current) => new Map([...current, ...found]));
    })();
  }, [imageKey]);

  const refresh = useCallback(() => {
    setDepthRun((value) => value + 1);
    run();
  }, [run]);

  return { report, refresh };
}
