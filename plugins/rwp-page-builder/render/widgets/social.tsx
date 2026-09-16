/** Social widgets: social icons, share buttons and the Facebook embeds. */
import { useEffect, useRef, useState } from 'react';
import { alignControl, colorControl, opts } from '../../lib/controls';
import { resolveText } from '../../lib/dynamic';
import { Icon } from '../../lib/icons';
import type { WidgetDefinition } from '../../lib/registry';
import { safeUrl } from '../../lib/sanitize';
import { alignToFlex, color, isSet, length, size, type SizeValue } from '../../lib/style';
import { useRenderContext } from '../context';
import { EditorPlaceholder, useResolved } from './shared';
import { clamp, itemId, listOf, num, pick, str } from './kit';

interface Network { label: string; icon: string; color: string; share?: (url: string, title: string) => string }

export const networks: Record<string, Network> = {
  facebook: { label: 'Facebook', icon: 'facebook', color: '#1877f2', share: (url) => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}` },
  x: { label: 'X', icon: 'x', color: '#0f1419', share: (url, title) => `https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(title)}` },
  linkedin: { label: 'LinkedIn', icon: 'linkedin', color: '#0a66c2', share: (url) => `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}` },
  instagram: { label: 'Instagram', icon: 'instagram', color: '#e4405f' },
  youtube: { label: 'YouTube', icon: 'youtube', color: '#ff0000' },
  tiktok: { label: 'TikTok', icon: 'tiktok', color: '#010101' },
  pinterest: { label: 'Pinterest', icon: 'pinterest', color: '#bd081c', share: (url, title) => `https://pinterest.com/pin/create/button/?url=${encodeURIComponent(url)}&description=${encodeURIComponent(title)}` },
  reddit: { label: 'Reddit', icon: 'reddit', color: '#ff4500', share: (url, title) => `https://www.reddit.com/submit?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}` },
  whatsapp: { label: 'WhatsApp', icon: 'whatsapp', color: '#25d366', share: (url, title) => `https://api.whatsapp.com/send?text=${encodeURIComponent(`${title} ${url}`)}` },
  telegram: { label: 'Telegram', icon: 'telegram', color: '#26a5e4', share: (url, title) => `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(title)}` },
  github: { label: 'GitHub', icon: 'github', color: '#181717' },
  discord: { label: 'Discord', icon: 'discord', color: '#5865f2' },
  twitch: { label: 'Twitch', icon: 'twitch', color: '#9146ff' },
  dribbble: { label: 'Dribbble', icon: 'dribbble', color: '#ea4c89' },
  email: { label: 'Email', icon: 'mail', color: '#64748b', share: (url, title) => `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(url)}` },
  phone: { label: 'Phone', icon: 'phone', color: '#16a34a' },
  rss: { label: 'RSS', icon: 'rss', color: '#f26522' },
  website: { label: 'Website', icon: 'globe', color: '#334155' },
};

const networkOptions = (filter?: (network: Network) => boolean) =>
  Object.entries(networks).filter(([, network]) => !filter || filter(network)).map(([value, network]) => ({ value, label: network.label }));

const shapeControl = { key: 'shape', label: 'Shape', type: 'select' as const, options: opts(['rounded', 'Rounded'], ['square', 'Square'], ['circle', 'Circle']) };

// Social Icons -------------------------------------------------------------------------------------------------------

interface SocialItem { id: string; network: string; url: string }

export const socialIcons: WidgetDefinition = {
  type: 'social-icons',
  label: 'Social Icons',
  icon: 'share',
  category: 'basic',
  keywords: ['facebook', 'instagram', 'x', 'twitter', 'linkedin', 'follow'],
  defaults: () => ({
    settings: {
      items: [
        { id: itemId(), network: 'facebook', url: 'https://facebook.com/' },
        { id: itemId(), network: 'x', url: 'https://x.com/' },
        { id: itemId(), network: 'instagram', url: 'https://instagram.com/' },
      ],
      shape: 'rounded', colors: 'official',
    },
    style: { align: 'center' },
  }),
  controls: [
    { key: 'items', label: 'Profiles', type: 'repeater', itemLabel: 'network', newItem: () => ({ id: itemId(), network: 'website', url: '' }), fields: [
      { key: 'network', label: 'Network', type: 'select', options: networkOptions() },
      { key: 'url', label: 'Link', type: 'text', dynamic: true, placeholder: 'https://… , mailto: or tel:' },
    ] },
    shapeControl,
    { key: 'colors', label: 'Colours', type: 'select', options: opts(['official', 'Official brand colours'], ['custom', 'Custom']) },
    { key: 'newTab', label: 'Open in a new tab', type: 'toggle' },
    alignControl(),
    { key: 'iconSize', label: 'Icon size (px)', type: 'slider', tab: 'style', responsive: true, min: 10, max: 80 },
    { key: 'iconPadding', label: 'Padding (px)', type: 'slider', tab: 'style', min: 0, max: 40 },
    { key: 'iconGap', label: 'Spacing (px)', type: 'slider', tab: 'style', responsive: true, min: 0, max: 60 },
    colorControl('iconColor', 'Icon colour (custom)'),
    colorControl('iconBg', 'Background (custom)'),
    colorControl('hoverColor', 'Hover icon colour'),
    colorControl('hoverBg', 'Hover background'),
  ],
  css: (bag) => ({
    ' .rwpb-social': { 'justify-content': alignToFlex(bag.align), gap: length(bag.iconGap ?? 8, 'px') },
    ' .rwpb-social-link': { 'font-size': length(bag.iconSize, 'px'), padding: length(bag.iconPadding, 'px') },
    ' .rwpb-social-custom .rwpb-social-link': { color: color(bag.iconColor), 'background-color': color(bag.iconBg) },
    ' .rwpb-social-link:hover| .rwpb-social-link:focus-visible': { color: color(bag.hoverColor), 'background-color': color(bag.hoverBg) },
  }),
  View: function SocialIconsView({ node }) {
    const { dynamic, mode } = useRenderContext();
    const items = listOf<SocialItem>(node.settings.items).filter((item) => networks[item.network]);
    if (!items.length) return <EditorPlaceholder>Add social profiles in the Content tab.</EditorPlaceholder>;
    const shape = pick(node.settings.shape, ['rounded', 'square', 'circle'] as const, 'rounded');
    const custom = node.settings.colors === 'custom';
    return (
      <ul className={`rwpb-social rwpb-social-${shape}${custom ? ' rwpb-social-custom' : ''}`}>
        {items.map((item, index) => {
          const network = networks[item.network];
          const href = safeUrl(resolveText(item.url, dynamic));
          const external = /^https?:/i.test(href);
          return (
            <li key={item.id || index}>
              <a className="rwpb-social-link" href={href || '#'} aria-label={network.label} title={network.label}
                style={custom ? undefined : { backgroundColor: network.color }}
                target={node.settings.newTab && external ? '_blank' : undefined} rel={external ? 'noopener noreferrer me' : undefined}
                onClick={(event) => { if (mode === 'edit' || !href) event.preventDefault(); }}>
                <Icon name={network.icon} size="1em" />
              </a>
            </li>
          );
        })}
      </ul>
    );
  },
};

// Share Buttons -----------------------------------------------------------------------------------------------------------

interface ShareItem { id: string; network: string; label?: string }

export const shareButtons: WidgetDefinition = {
  type: 'share-buttons',
  label: 'Share Buttons',
  icon: 'share',
  category: 'pro',
  keywords: ['share', 'social', 'copy link', 'print'],
  defaults: () => ({
    settings: {
      items: ['facebook', 'x', 'linkedin', 'whatsapp', 'copy'].map((network) => ({ id: itemId(), network })),
      view: 'icon-text', shape: 'rounded', colors: 'official', shareUrl: 'current', columns: '0',
    },
  }),
  controls: [
    { key: 'items', label: 'Buttons', type: 'repeater', itemLabel: 'network', newItem: () => ({ id: itemId(), network: 'email' }), fields: [
      { key: 'network', label: 'Network', type: 'select', options: [...networkOptions((network) => Boolean(network.share)), { value: 'copy', label: 'Copy link' }, { value: 'print', label: 'Print' }] },
      { key: 'label', label: 'Custom label', type: 'text' },
    ] },
    { key: 'view', label: 'View', type: 'select', options: opts(['icon-text', 'Icon and text'], ['icon', 'Icon'], ['text', 'Text']) },
    shapeControl,
    { key: 'colors', label: 'Colours', type: 'select', options: opts(['official', 'Official brand colours'], ['custom', 'Custom']) },
    { key: 'columns', label: 'Columns', type: 'select', options: opts(['0', 'Auto'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4'], ['6', '6']) },
    { key: 'shareUrl', label: 'Share', type: 'select', options: opts(['current', 'The current page'], ['custom', 'A custom URL']) },
    { key: 'customUrl', label: 'URL to share', type: 'text', dynamic: true, condition: (settings) => settings.shareUrl === 'custom' },
    alignControl('align', 'Alignment', true),
    { key: 'buttonHeight', label: 'Button size (px)', type: 'slider', tab: 'style', min: 26, max: 80 },
    { key: 'gap', label: 'Spacing (px)', type: 'slider', tab: 'style', min: 0, max: 40 },
    colorControl('buttonColor', 'Text / icon colour (custom)'),
    colorControl('buttonBg', 'Background (custom)'),
  ],
  css: (bag, node) => {
    const columns = clamp(Math.round(num(node.settings.columns, 0)), 0, 6);
    return {
      ' .rwpb-share': {
        display: columns ? 'grid' : undefined,
        'grid-template-columns': columns ? `repeat(${columns}, minmax(0, 1fr))` : undefined,
        'justify-content': columns ? undefined : bag.align === 'justify' ? 'stretch' : alignToFlex(bag.align),
        gap: length(bag.gap ?? 8, 'px'),
      },
      ' .rwpb-share-button': { 'min-height': length(bag.buttonHeight, 'px'), 'min-width': length(bag.buttonHeight, 'px'), flex: bag.align === 'justify' ? '1 1 0' : undefined },
      ' .rwpb-share-custom .rwpb-share-button': { color: color(bag.buttonColor), 'background-color': color(bag.buttonBg) },
    };
  },
  View: function ShareButtonsView({ node }) {
    const { mode, dynamic } = useRenderContext();
    const items = listOf<ShareItem>(node.settings.items).filter((item) => item.network === 'copy' || item.network === 'print' || networks[item.network]?.share);
    const customUrl = useResolved(node.settings.customUrl);
    const [copied, setCopied] = useState(false);
    if (!items.length) return <EditorPlaceholder>Add share buttons in the Content tab.</EditorPlaceholder>;
    const url = node.settings.shareUrl === 'custom' && customUrl ? customUrl : typeof window === 'undefined' ? '' : window.location.href.split('#')[0];
    const title = dynamic?.page?.title || (typeof document === 'undefined' ? '' : document.title);
    const view = pick(node.settings.view, ['icon-text', 'icon', 'text'] as const, 'icon-text');
    const shape = pick(node.settings.shape, ['rounded', 'square', 'circle'] as const, 'rounded');
    const custom = node.settings.colors === 'custom';
    return (
      <div className={`rwpb-share rwpb-share-${view} rwpb-social-${shape}${custom ? ' rwpb-share-custom' : ''}`} role="group" aria-label="Share this page">
        {items.map((item, index) => {
          const network = networks[item.network];
          const label = item.label || (item.network === 'copy' ? (copied ? 'Copied!' : 'Copy link') : item.network === 'print' ? 'Print' : network.label);
          const icon = item.network === 'copy' ? 'link' : item.network === 'print' ? 'file-text' : network.icon;
          const style = custom ? undefined : { backgroundColor: item.network === 'copy' || item.network === 'print' ? '#475569' : network.color };
          const content = (
            <>
              {view !== 'text' && <Icon name={icon} size="1.1em" />}
              {view !== 'icon' ? <span>{label}</span> : <span className="rwpb-sr-only">{label}</span>}
            </>
          );
          if (item.network === 'copy' || item.network === 'print') {
            return (
              <button key={item.id || index} type="button" className="rwpb-share-button" style={style} aria-live={item.network === 'copy' ? 'polite' : undefined}
                onClick={async () => {
                  if (mode === 'edit') return;
                  if (item.network === 'print') { window.print(); return; }
                  try { await navigator.clipboard.writeText(url); setCopied(true); window.setTimeout(() => setCopied(false), 2000); } catch { window.prompt('Copy this link:', url); }
                }}>
                {content}
              </button>
            );
          }
          const href = network.share!(url, title);
          return (
            <a key={item.id || index} className="rwpb-share-button" style={style} href={href} target={item.network === 'email' ? undefined : '_blank'} rel="noopener noreferrer"
              onClick={(event) => {
                if (mode === 'edit') { event.preventDefault(); return; }
                if (item.network === 'email') return;
                // A small window, like the networks' own share buttons; falls back to the new tab if blocked.
                // Not "noopener" in the features: window.open then returns null and the link would open twice.
                const popup = window.open(href, 'rwpb-share', 'width=600,height=520');
                if (popup) { popup.opener = null; event.preventDefault(); }
              }}>
              {content}
            </a>
          );
        })}
      </div>
    );
  },
};

// Facebook --------------------------------------------------------------------------------------------------------------------

const facebookUrl = (value: string) => (/^https:\/\/(www\.|m\.|web\.)?(facebook|fb)\.(com|watch)\//i.test(value) ? value : '');

function currentUrl() {
  return typeof window === 'undefined' ? '' : window.location.href.split('#')[0];
}

const heightControl = (fallback: number) => ({ key: 'embedHeight', label: 'Height', type: 'size' as const, tab: 'style' as const, responsive: true, units: ['px'], help: `Default ${fallback}px.` });

export const facebookButton: WidgetDefinition = {
  type: 'facebook-button',
  label: 'Facebook Button',
  icon: 'facebook',
  category: 'pro',
  keywords: ['like', 'recommend', 'facebook'],
  defaults: () => ({ settings: { action: 'like', layout: 'button_count', size: 'small', share: true, target: 'current' } }),
  controls: [
    { key: 'action', label: 'Type', type: 'select', options: opts(['like', 'Like'], ['recommend', 'Recommend']) },
    { key: 'layout', label: 'Layout', type: 'select', options: opts(['button_count', 'Button with count'], ['box_count', 'Box count'], ['button', 'Button'], ['standard', 'Standard']) },
    { key: 'size', label: 'Size', type: 'select', options: opts(['small', 'Small'], ['large', 'Large']) },
    { key: 'share', label: 'Share button', type: 'toggle' },
    { key: 'target', label: 'Target', type: 'select', options: opts(['current', 'The current page'], ['custom', 'A custom URL']) },
    { key: 'url', label: 'URL', type: 'text', dynamic: true, condition: (settings) => settings.target === 'custom' },
    alignControl(),
  ],
  css: (bag) => ({ '': { 'text-align': isSet(bag.align) ? String(bag.align) : undefined } }),
  View: function FacebookButtonView({ node }) {
    const custom = useResolved(node.settings.url);
    const target = safeUrl(node.settings.target === 'custom' ? custom : currentUrl());
    if (!/^https?:/i.test(target)) return <EditorPlaceholder>Enter the full URL to like.</EditorPlaceholder>;
    const layout = pick(node.settings.layout, ['button_count', 'box_count', 'button', 'standard'] as const, 'button_count');
    const large = node.settings.size === 'large';
    const width = layout === 'standard' ? 450 : layout === 'box_count' ? 70 : node.settings.share ? 160 : 100;
    const height = layout === 'box_count' ? 65 : large ? 30 : 22;
    const params = new URLSearchParams({ href: target, layout, action: node.settings.action === 'recommend' ? 'recommend' : 'like', size: large ? 'large' : 'small', share: String(Boolean(node.settings.share)), width: String(width), height: String(height) });
    return <iframe className="rwpb-fb-button" title="Facebook like button" src={`https://www.facebook.com/plugins/like.php?${params}`} width={width} height={height} loading="lazy" allow="encrypted-media" />;
  },
};

export const facebookEmbed: WidgetDefinition = {
  type: 'facebook-embed',
  label: 'Facebook Embed',
  icon: 'facebook',
  category: 'pro',
  keywords: ['facebook post', 'facebook video', 'embed'],
  defaults: () => ({ settings: { embedType: 'post', url: '', showText: true }, style: { embedHeight: { size: 560, unit: 'px' } } }),
  controls: [
    { key: 'embedType', label: 'Type', type: 'select', options: opts(['post', 'Post'], ['video', 'Video']) },
    { key: 'url', label: 'URL', type: 'text', placeholder: 'https://www.facebook.com/…/posts/…', help: 'The post or video must be public.' },
    { key: 'showText', label: 'Include the post text', type: 'toggle' },
    heightControl(560),
  ],
  css: (bag) => ({ ' .rwpb-fb-embed iframe': { height: size(bag.embedHeight as SizeValue | undefined) || '560px' } }),
  View: function FacebookEmbedView({ node }) {
    const url = facebookUrl(str(node.settings.url).trim());
    if (!url) return <EditorPlaceholder>Paste the link to a public Facebook post or video.</EditorPlaceholder>;
    const video = node.settings.embedType === 'video';
    const params = new URLSearchParams({ href: url, show_text: String(Boolean(node.settings.showText)), width: '500' });
    return (
      <div className="rwpb-fb-embed">
        <iframe title={video ? 'Facebook video' : 'Facebook post'} src={`https://www.facebook.com/plugins/${video ? 'video' : 'post'}.php?${params}`} loading="lazy" allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share" allowFullScreen />
      </div>
    );
  },
};

export const facebookPage: WidgetDefinition = {
  type: 'facebook-page',
  label: 'Facebook Page',
  icon: 'facebook',
  category: 'pro',
  keywords: ['facebook page', 'timeline', 'feed'],
  defaults: () => ({ settings: { url: 'https://www.facebook.com/facebook', tabs: 'timeline', smallHeader: false, hideCover: false, showFacepile: true }, style: { embedHeight: { size: 500, unit: 'px' } } }),
  controls: [
    { key: 'url', label: 'Page URL', type: 'text', placeholder: 'https://www.facebook.com/yourpage' },
    { key: 'tabs', label: 'Tabs', type: 'select', options: opts(['timeline', 'Timeline'], ['events', 'Events'], ['messages', 'Messages'], ['timeline,events', 'Timeline and events'], ['', 'None']) },
    { key: 'smallHeader', label: 'Small header', type: 'toggle' },
    { key: 'hideCover', label: 'Hide the cover photo', type: 'toggle' },
    { key: 'showFacepile', label: "Show friends' faces", type: 'toggle' },
    heightControl(500),
  ],
  css: (bag) => ({ ' .rwpb-fb-page iframe': { height: size(bag.embedHeight as SizeValue | undefined) || '500px' } }),
  View: function FacebookPageView({ node }) {
    const url = facebookUrl(str(node.settings.url).trim());
    const hostRef = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState(340);
    // Facebook renders the page plugin at a fixed width between 180 and 500 px.
    useEffect(() => {
      const host = hostRef.current;
      if (!host || !('ResizeObserver' in window)) return undefined;
      const observer = new ResizeObserver(([entry]) => setWidth(clamp(Math.floor(entry.contentRect.width), 180, 500)));
      observer.observe(host);
      return () => observer.disconnect();
    }, []);
    if (!url) return <EditorPlaceholder>Enter the URL of a public Facebook page.</EditorPlaceholder>;
    const height = clamp(num((node.style?.desktop?.embedHeight as SizeValue | undefined)?.size, 500), 70, 2000);
    const params = new URLSearchParams({
      href: url, tabs: str(node.settings.tabs), width: String(width), height: String(height), adapt_container_width: 'true',
      small_header: String(Boolean(node.settings.smallHeader)), hide_cover: String(Boolean(node.settings.hideCover)), show_facepile: String(node.settings.showFacepile !== false),
    });
    return (
      <div ref={hostRef} className="rwpb-fb-page">
        <iframe key={width} title="Facebook page" src={`https://www.facebook.com/plugins/page.php?${params}`} width={width} loading="lazy" allow="encrypted-media" />
      </div>
    );
  },
};

let facebookSdk: Promise<void> | null = null;

/** The comments plugin has no iframe endpoint; it needs Facebook's JavaScript SDK. */
function loadFacebookSdk(locale: string): Promise<void> {
  if (!facebookSdk) {
    facebookSdk = new Promise((resolve, reject) => {
      if (!document.getElementById('fb-root')) {
        const root = document.createElement('div');
        root.id = 'fb-root';
        document.body.prepend(root);
      }
      const script = document.createElement('script');
      script.async = true;
      script.defer = true;
      script.crossOrigin = 'anonymous';
      script.src = `https://connect.facebook.net/${locale}/sdk.js#xfbml=0&version=v19.0`;
      script.onload = () => resolve();
      script.onerror = () => { facebookSdk = null; reject(new Error('Facebook SDK blocked')); };
      document.body.appendChild(script);
    });
  }
  return facebookSdk;
}

export const facebookComments: WidgetDefinition = {
  type: 'facebook-comments',
  label: 'Facebook Comments',
  icon: 'message-square',
  category: 'pro',
  keywords: ['facebook', 'comments', 'discussion'],
  defaults: () => ({ settings: { count: 10, order: 'social', target: 'current', locale: 'en_US' } }),
  controls: [
    { key: 'count', label: 'Comments shown', type: 'number', min: 1, max: 100 },
    { key: 'order', label: 'Order by', type: 'select', options: opts(['social', 'Most relevant'], ['reverse_time', 'Newest first'], ['time', 'Oldest first']) },
    { key: 'target', label: 'Comments for', type: 'select', options: opts(['current', 'The current page'], ['custom', 'A custom URL']) },
    { key: 'url', label: 'URL', type: 'text', dynamic: true, condition: (settings) => settings.target === 'custom' },
    { key: 'locale', label: 'Language', type: 'text', placeholder: 'en_US', help: 'A Facebook locale code such as en_US, fr_FR or de_DE.' },
  ],
  View: function FacebookCommentsView({ node }) {
    const { mode } = useRenderContext();
    const custom = useResolved(node.settings.url);
    const hostRef = useRef<HTMLDivElement>(null);
    const [failed, setFailed] = useState(false);
    const target = safeUrl(node.settings.target === 'custom' ? custom : currentUrl());
    const locale = /^[a-z]{2}_[A-Z]{2}$/.test(str(node.settings.locale)) ? str(node.settings.locale) : 'en_US';
    useEffect(() => {
      if (mode !== 'view' || !/^https?:/i.test(target)) return;
      loadFacebookSdk(locale)
        .then(() => (window as unknown as { FB?: { XFBML: { parse: (element?: Element) => void } } }).FB?.XFBML.parse(hostRef.current || undefined))
        .catch(() => setFailed(true));
    }, [mode, target, locale]);
    if (mode === 'edit') return <div className="rwpb-placeholder">Facebook Comments appear here on the live page (Facebook does not allow them inside the editor).</div>;
    if (!/^https?:/i.test(target)) return null;
    return (
      <div ref={hostRef} className="rwpb-fb-comments">
        <div className="fb-comments" data-href={target} data-width="100%" data-numposts={String(clamp(Math.round(num(node.settings.count, 10)), 1, 100))} data-order-by={pick(node.settings.order, ['social', 'reverse_time', 'time'] as const, 'social')} />
        {failed && <p className="rwpb-muted">Facebook comments could not load. A browser extension or privacy setting may be blocking Facebook.</p>}
      </div>
    );
  },
};
