import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { resolveText } from '../../lib/dynamic';
import { safeMediaUrl, safeUrl } from '../../lib/sanitize';
import { useRenderContext } from '../context';

export interface LinkValue { url?: string; newTab?: boolean; nofollow?: boolean }

export const asLink = (value: unknown): LinkValue =>
  (value && typeof value === 'object' ? value : { url: typeof value === 'string' ? value : '' }) as LinkValue;

/** Settings text with dynamic tags resolved (the editor shows the tags themselves). */
export function useText(value: unknown): string {
  const { dynamic, mode } = useRenderContext();
  const text = typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value);
  return mode === 'edit' ? text : resolveText(text, dynamic);
}

/** Resolves tags even in the editor: an image URL tag has to become a real URL to preview. */
export function useResolved(value: unknown): string {
  const { dynamic } = useRenderContext();
  return resolveText(value, dynamic);
}

export function useLinkProps(value: unknown) {
  const link = asLink(value);
  const href = safeUrl(useResolved(link.url || ''));
  if (!href) return null;
  const rel = [link.newTab ? 'noopener noreferrer' : '', link.nofollow ? 'nofollow' : ''].filter(Boolean).join(' ');
  return { href, target: link.newTab ? '_blank' : undefined, rel: rel || undefined };
}

export function MaybeLink({ link, className, children }: { link: unknown; className?: string; children: ReactNode }) {
  const props = useLinkProps(link);
  return props ? <a className={className} {...props}>{children}</a> : <>{children}</>;
}

export const useMediaUrl = (value: unknown) => safeMediaUrl(useResolved(value));

export function Lightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);
  // Portalled to <body>: a sticky or transformed ancestor would otherwise clip a fixed overlay.
  return createPortal(
    <div className="rwpb-lightbox" role="dialog" aria-modal="true" aria-label={alt || 'Image'} onClick={onClose}>
      <button type="button" className="rwpb-lightbox-close" aria-label="Close" onClick={onClose}>×</button>
      <img src={src} alt={alt} onClick={(event) => event.stopPropagation()} />
    </div>,
    document.body,
  );
}

export function useLightbox() {
  const [open, setOpen] = useState(false);
  return { open, show: () => setOpen(true), hide: () => setOpen(false) };
}

/** A placeholder shown in the editor when a widget has nothing to display yet. */
export function EditorPlaceholder({ children }: { children: ReactNode }) {
  const { mode } = useRenderContext();
  return mode === 'edit' ? <div className="rwpb-placeholder">{children}</div> : null;
}
