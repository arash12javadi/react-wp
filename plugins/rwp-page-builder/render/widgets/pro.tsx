import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { alignControl, colorControl, headingTags, linkControl, opts, typographyControl } from '../../lib/controls';
import { Icon } from '../../lib/icons';
import type { WidgetDefinition } from '../../lib/registry';
import { cssUrl, safeMediaUrl, safeUrl } from '../../lib/sanitize';
import { alignToFlex, color, isSet, length, size, typography, type SizeValue, type Typography } from '../../lib/style';
import { EditableText } from '../NodeView';
import { useRenderContext } from '../context';
import { fetchMenus, type MenuRecord } from '../data';
import { EditorPlaceholder, useLinkProps, useMediaUrl, useText } from './shared';
import { resolveText } from '../../lib/dynamic';

const str = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback);
const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Slideshow -------------------------------------------------------------------------------------

interface Slide { id: string; title?: string; text?: string; image?: string; video?: string; buttonText?: string; link?: unknown; overlay?: string; align?: string }

const newSlide = (): Slide => ({ id: Math.random().toString(36).slice(2, 8), title: 'Slide heading', text: 'Lorem ipsum dolor sit amet consectetur adipiscing elit.', buttonText: 'Learn more', link: { url: '#' }, overlay: 'rgba(15, 23, 42, 0.45)' });

export const slideshow: WidgetDefinition = {
  type: 'slideshow',
  label: 'Slideshow',
  icon: 'slides',
  category: 'pro',
  keywords: ['slider', 'carousel', 'hero'],
  defaults: () => ({
    settings: { slides: [newSlide(), { ...newSlide(), title: 'Second slide' }], autoplay: true, interval: 5000, transition: 'fade', arrows: true, dots: true, pauseOnHover: true, titleTag: 'h2' },
    style: { height: { size: 520, unit: 'px' }, contentAlign: 'center' },
  }),
  controls: [
    {
      key: 'slides', label: 'Slides', type: 'repeater', itemLabel: 'title', newItem: () => newSlide() as unknown as Record<string, unknown>,
      fields: [
        { key: 'title', label: 'Title', type: 'text', dynamic: true },
        { key: 'text', label: 'Description', type: 'textarea', dynamic: true },
        { key: 'image', label: 'Background image', type: 'image' },
        { key: 'video', label: 'Background video (MP4 URL)', type: 'text', placeholder: 'https://…/clip.mp4' },
        { key: 'overlay', label: 'Overlay colour', type: 'color' },
        { key: 'buttonText', label: 'Button text', type: 'text' },
        linkControl('link', 'Button link'),
      ],
    },
    { key: 'titleTag', label: 'Title HTML tag', type: 'select', options: headingTags },
    { key: 'autoplay', label: 'Autoplay', type: 'toggle' },
    { key: 'interval', label: 'Autoplay interval (ms)', type: 'slider', min: 1500, max: 15000, step: 250, condition: (settings) => Boolean(settings.autoplay) },
    { key: 'pauseOnHover', label: 'Pause on hover', type: 'toggle', condition: (settings) => Boolean(settings.autoplay) },
    { key: 'transition', label: 'Transition', type: 'select', options: opts(['fade', 'Fade'], ['slide', 'Slide']) },
    { key: 'arrows', label: 'Arrows', type: 'toggle' },
    { key: 'dots', label: 'Dots', type: 'toggle' },
    { key: 'height', label: 'Height', type: 'size', tab: 'style', responsive: true, units: ['px', 'vh'] },
    alignControl('contentAlign', 'Content alignment'),
    { key: 'contentWidth', label: 'Content max width (px)', type: 'slider', tab: 'style', responsive: true, min: 200, max: 1400 },
    colorControl('titleColor', 'Title colour'),
    typographyControl('titleTypography', 'Title typography'),
    colorControl('textColor', 'Description colour'),
    typographyControl('textTypography', 'Description typography'),
    colorControl('buttonText', 'Button text colour'),
    colorControl('buttonBg', 'Button background'),
    colorControl('navColor', 'Arrows and dots colour'),
  ],
  css: (bag) => ({
    ' .rwpb-slideshow': { height: size(bag.height as SizeValue | undefined) || '520px', '--rwpb-nav-color': color(bag.navColor) },
    ' .rwpb-slide-content': {
      'text-align': isSet(bag.contentAlign) ? String(bag.contentAlign) : undefined,
      'align-items': alignToFlex(bag.contentAlign),
      'max-width': length(bag.contentWidth, 'px'),
      'margin-inline': bag.contentAlign === 'left' ? '0 auto' : bag.contentAlign === 'right' ? 'auto 0' : 'auto',
    },
    ' .rwpb-slide-title': { color: color(bag.titleColor), ...typography(bag.titleTypography as Typography | undefined) },
    ' .rwpb-slide-text': { color: color(bag.textColor), ...typography(bag.textTypography as Typography | undefined) },
    ' .rwpb-slide .rwpb-button': { color: color(bag.buttonText), 'background-color': color(bag.buttonBg) },
  }),
  View: function SlideshowView({ node }) {
    const { mode, dynamic } = useRenderContext();
    const slides = (Array.isArray(node.settings.slides) ? node.settings.slides : []) as Slide[];
    const [index, setIndex] = useState(0);
    const [paused, setPaused] = useState(false);
    const count = slides.length;
    const TitleTag = (headingTags.some((option) => option.value === node.settings.titleTag) ? node.settings.titleTag : 'h2') as 'h2';
    const go = useCallback((next: number) => setIndex(count ? (next + count) % count : 0), [count]);
    const labelId = useId();

    useEffect(() => { if (index >= count) setIndex(0); }, [count, index]);

    useEffect(() => {
      if (mode === 'edit' || !node.settings.autoplay || paused || count < 2 || prefersReducedMotion()) return undefined;
      const timer = window.setInterval(() => setIndex((current) => (current + 1) % count), Math.max(1500, Number(node.settings.interval) || 5000));
      return () => window.clearInterval(timer);
    }, [mode, node.settings.autoplay, node.settings.interval, paused, count]);

    if (!count) return <EditorPlaceholder>Add a slide in the Content tab.</EditorPlaceholder>;
    const fade = node.settings.transition !== 'slide';
    return (
      <div
        className={`rwpb-slideshow rwpb-slideshow-${fade ? 'fade' : 'slide'}`}
        role="region" aria-roledescription="carousel" aria-labelledby={labelId}
        onMouseEnter={() => node.settings.pauseOnHover && setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={() => setPaused(false)}
      >
        <span id={labelId} className="rwpb-sr-only">Slideshow</span>
        <div className="rwpb-slides" style={fade ? undefined : { transform: `translateX(-${index * 100}%)` }}>
          {slides.map((slide, slideIndex) => {
            const link = safeUrl(resolveText(((slide.link || {}) as { url?: string }).url, dynamic));
            const image = cssUrl(resolveText(slide.image, dynamic));
            const video = safeMediaUrl(slide.video);
            return (
              <div key={slide.id || slideIndex} className={`rwpb-slide${slideIndex === index ? ' is-active' : ''}`}
                role="group" aria-roledescription="slide" aria-label={`${slideIndex + 1} of ${count}`} aria-hidden={slideIndex !== index}
                style={image ? { backgroundImage: image } : undefined}>
                {video && <video className="rwpb-slide-video" src={video} autoPlay={mode === 'view'} muted loop playsInline aria-hidden="true" />}
                <div className="rwpb-slide-overlay" style={{ background: slide.overlay ? String(slide.overlay).replace(/[;{}<>]/g, '') : undefined }} />
                <div className="rwpb-slide-content">
                  {slide.title && <TitleTag className="rwpb-slide-title">{mode === 'edit' ? slide.title : resolveText(slide.title, dynamic)}</TitleTag>}
                  {slide.text && <p className="rwpb-slide-text">{mode === 'edit' ? slide.text : resolveText(slide.text, dynamic)}</p>}
                  {slide.buttonText && (link
                    ? <a className="rwpb-button rwpb-button-lg" href={link} tabIndex={slideIndex === index ? undefined : -1}>{slide.buttonText}</a>
                    : <span className="rwpb-button rwpb-button-lg">{slide.buttonText}</span>)}
                </div>
              </div>
            );
          })}
        </div>
        {Boolean(node.settings.arrows) && count > 1 && (
          <>
            <button type="button" className="rwpb-slide-arrow rwpb-slide-prev" aria-label="Previous slide" onClick={() => go(index - 1)}><Icon name="chevron-left" size={28} /></button>
            <button type="button" className="rwpb-slide-arrow rwpb-slide-next" aria-label="Next slide" onClick={() => go(index + 1)}><Icon name="chevron-right" size={28} /></button>
          </>
        )}
        {Boolean(node.settings.dots) && count > 1 && (
          <div className="rwpb-slide-dots">
            {slides.map((slide, slideIndex) => (
              <button key={slide.id || slideIndex} type="button" aria-label={`Go to slide ${slideIndex + 1}`} aria-current={slideIndex === index} onClick={() => go(slideIndex)} />
            ))}
          </div>
        )}
      </div>
    );
  },
};

// Call to action ---------------------------------------------------------------------------------

export const cta: WidgetDefinition = {
  type: 'cta',
  label: 'Call to Action',
  icon: 'megaphone',
  category: 'pro',
  keywords: ['banner', 'promo', 'ribbon'],
  defaults: () => ({
    settings: { title: 'Ready to get started?', description: 'Join thousands of happy customers today.', buttonText: 'Get started', link: { url: '#' }, ribbon: 'New', image: '', hoverZoom: true, titleTag: 'h3' },
    style: { minHeight: { size: 320, unit: 'px' }, align: 'center', overlay: 'rgba(15, 23, 42, 0.55)' },
  }),
  controls: [
    { key: 'image', label: 'Background image', type: 'image', dynamic: true },
    { key: 'title', label: 'Title', type: 'text', dynamic: true },
    { key: 'titleTag', label: 'Title HTML tag', type: 'select', options: headingTags },
    { key: 'description', label: 'Description', type: 'textarea', dynamic: true },
    { key: 'buttonText', label: 'Button text', type: 'text', dynamic: true },
    linkControl(),
    { key: 'ribbon', label: 'Ribbon text', type: 'text', help: 'Leave empty to hide the ribbon.' },
    { key: 'hoverZoom', label: 'Zoom background on hover', type: 'toggle' },
    { key: 'minHeight', label: 'Minimum height', type: 'size', tab: 'style', responsive: true, units: ['px', 'vh'] },
    alignControl(),
    colorControl('overlay', 'Overlay colour'),
    colorControl('titleColor', 'Title colour'),
    typographyControl('titleTypography', 'Title typography'),
    colorControl('textColor', 'Description colour'),
    colorControl('buttonText', 'Button text colour'),
    colorControl('buttonBg', 'Button background'),
    colorControl('ribbonBg', 'Ribbon background'),
  ],
  css: (bag) => ({
    ' .rwpb-cta': { 'min-height': size(bag.minHeight as SizeValue | undefined) },
    ' .rwpb-cta-content': { 'text-align': isSet(bag.align) ? String(bag.align) : undefined, 'align-items': alignToFlex(bag.align) },
    ' .rwpb-cta-overlay': { 'background-color': color(bag.overlay) },
    ' .rwpb-cta-title': { color: color(bag.titleColor), ...typography(bag.titleTypography as Typography | undefined) },
    ' .rwpb-cta-text': { color: color(bag.textColor) },
    ' .rwpb-cta .rwpb-button': { color: color(bag.buttonText), 'background-color': color(bag.buttonBg) },
    ' .rwpb-cta-ribbon': { 'background-color': color(bag.ribbonBg) },
  }),
  View: function CtaView({ node }) {
    const image = cssUrl(useMediaUrl(node.settings.image));
    const link = useLinkProps(node.settings.link);
    const buttonText = useText(node.settings.buttonText);
    const Tag = (headingTags.some((option) => option.value === node.settings.titleTag) ? node.settings.titleTag : 'h3') as 'h3';
    return (
      <div className={`rwpb-cta${node.settings.hoverZoom ? ' rwpb-cta-zoom' : ''}`}>
        {image && <div className="rwpb-cta-bg" style={{ backgroundImage: image }} aria-hidden="true" />}
        <div className="rwpb-cta-overlay" aria-hidden="true" />
        {str(node.settings.ribbon) && <span className="rwpb-cta-ribbon">{str(node.settings.ribbon)}</span>}
        <div className="rwpb-cta-content">
          <EditableText nodeId={node.id} field="title" value={str(node.settings.title)} as={Tag} className="rwpb-cta-title" />
          <EditableText nodeId={node.id} field="description" value={str(node.settings.description)} as="p" className="rwpb-cta-text" multiline />
          {buttonText && (link ? <a className="rwpb-button rwpb-button-lg" {...link}>{buttonText}</a> : <span className="rwpb-button rwpb-button-lg">{buttonText}</span>)}
        </div>
      </div>
    );
  },
};

// Accordion / FAQ ---------------------------------------------------------------------------------

interface AccordionItem { id: string; title: string; content: string }

const newAccordionItem = (): AccordionItem => ({ id: Math.random().toString(36).slice(2, 8), title: 'Accordion title', content: 'Accordion content. Click to edit in the Content tab.' });

export const accordion: WidgetDefinition = {
  type: 'accordion',
  label: 'Accordion',
  icon: 'accordion',
  category: 'pro',
  keywords: ['faq', 'toggle', 'collapse'],
  defaults: () => ({
    settings: { items: [{ ...newAccordionItem(), title: 'What is included?' }, { ...newAccordionItem(), title: 'How do I get started?' }], firstOpen: true, multiple: false, icon: 'plus', faqSchema: false, titleTag: 'h3' },
  }),
  controls: [
    { key: 'items', label: 'Items', type: 'repeater', itemLabel: 'title', newItem: () => newAccordionItem() as unknown as Record<string, unknown>, fields: [
      { key: 'title', label: 'Title', type: 'text', dynamic: true },
      { key: 'content', label: 'Content', type: 'textarea', dynamic: true },
    ] },
    { key: 'firstOpen', label: 'First item open', type: 'toggle' },
    { key: 'multiple', label: 'Allow several open at once', type: 'toggle' },
    { key: 'icon', label: 'Toggle icon', type: 'select', options: opts(['plus', 'Plus / minus'], ['chevron', 'Chevron']) },
    { key: 'titleTag', label: 'Title HTML tag', type: 'select', options: headingTags },
    { key: 'faqSchema', label: 'FAQ schema (structured data)', type: 'toggle', help: 'Adds FAQPage JSON-LD for search engines. Use it only for genuine questions and answers.' },
    colorControl('borderColor', 'Border colour'),
    colorControl('titleColor', 'Title colour'),
    colorControl('titleBg', 'Title background'),
    colorControl('activeColor', 'Active title colour'),
    typographyControl('titleTypography', 'Title typography'),
    colorControl('contentColor', 'Content colour'),
    typographyControl('contentTypography', 'Content typography'),
  ],
  css: (bag) => ({
    ' .rwpb-accordion': { '--rwpb-accordion-border': color(bag.borderColor) },
    ' .rwpb-accordion-trigger': { color: color(bag.titleColor), 'background-color': color(bag.titleBg), ...typography(bag.titleTypography as Typography | undefined) },
    ' .rwpb-accordion-item.is-open .rwpb-accordion-trigger': { color: color(bag.activeColor) },
    ' .rwpb-accordion-panel-inner': { color: color(bag.contentColor), ...typography(bag.contentTypography as Typography | undefined) },
  }),
  View: function AccordionView({ node }) {
    const { dynamic, mode } = useRenderContext();
    const items = (Array.isArray(node.settings.items) ? node.settings.items : []) as AccordionItem[];
    const [open, setOpen] = useState<string[]>(() => (node.settings.firstOpen && items[0] ? [items[0].id] : []));
    const baseId = useId();
    const Tag = (headingTags.some((option) => option.value === node.settings.titleTag) ? node.settings.titleTag : 'h3') as 'h3';
    const text = (value: string) => (mode === 'edit' ? value : resolveText(value, dynamic));
    if (!items.length) return <EditorPlaceholder>Add accordion items in the Content tab.</EditorPlaceholder>;
    const toggle = (id: string) => setOpen((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      return node.settings.multiple ? [...current, id] : [id];
    });
    const schema = node.settings.faqSchema && mode === 'view' ? JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: items.map((item) => ({ '@type': 'Question', name: text(item.title), acceptedAnswer: { '@type': 'Answer', text: text(item.content) } })),
      // "<" is escaped so answer text cannot close the script element.
    }).replace(/</g, '\\u003c') : '';
    return (
      <div className="rwpb-accordion">
        {items.map((item, index) => {
          const isOpen = open.includes(item.id);
          const triggerId = `${baseId}-t${index}`;
          const panelId = `${baseId}-p${index}`;
          return (
            <div key={item.id || index} className={`rwpb-accordion-item${isOpen ? ' is-open' : ''}`}>
              <Tag className="rwpb-accordion-heading">
                <button type="button" id={triggerId} className="rwpb-accordion-trigger" aria-expanded={isOpen} aria-controls={panelId} onClick={() => toggle(item.id)}>
                  <span>{text(item.title)}</span>
                  <span className="rwpb-accordion-icon" aria-hidden="true">
                    {node.settings.icon === 'chevron' ? <Icon name="chevron-down" size="1em" /> : <Icon name={isOpen ? 'minus' : 'plus'} size="1em" />}
                  </span>
                </button>
              </Tag>
              <div id={panelId} role="region" aria-labelledby={triggerId} className="rwpb-accordion-panel" inert={!isOpen}>
                <div className="rwpb-accordion-panel-clip">
                  <div className="rwpb-accordion-panel-inner">{text(item.content).split('\n').map((line, lineIndex) => <p key={lineIndex}>{line}</p>)}</div>
                </div>
              </div>
            </div>
          );
        })}
        {schema && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: schema }} />}
      </div>
    );
  },
};

// Nav menu ----------------------------------------------------------------------------------------

type MenuLink = { label: string; url: string; children: Array<{ label: string; url: string }> };

const nestMenu = (menu: MenuRecord | undefined): MenuLink[] => {
  const links: MenuLink[] = [];
  (menu?.items || []).forEach((item) => {
    const link = { label: item.label, url: item.url };
    if ((item.depth || 0) > 0 && links.length) links[links.length - 1].children.push(link);
    else links.push({ ...link, children: [] });
  });
  return links;
};

export const navMenu: WidgetDefinition = {
  type: 'nav-menu',
  label: 'Nav Menu',
  icon: 'navigation',
  category: 'pro',
  keywords: ['menu', 'navigation', 'header'],
  defaults: () => ({ settings: { menuId: '', layout: 'horizontal', dropdown: 'hover', hamburgerOn: 'mobile' }, style: { align: 'left' } }),
  controls: [
    { key: 'menuId', label: 'Menu', type: 'menu', help: 'Menus are created under Menus in the admin.' },
    { key: 'layout', label: 'Layout', type: 'select', options: opts(['horizontal', 'Horizontal'], ['vertical', 'Vertical']) },
    { key: 'hamburgerOn', label: 'Hamburger menu on', type: 'select', options: opts(['mobile', 'Mobile'], ['tablet', 'Tablet and mobile'], ['none', 'Never']) },
    alignControl(),
    colorControl('linkColor', 'Link colour'),
    colorControl('linkHover', 'Link hover colour'),
    typographyControl(),
    { key: 'itemGap', label: 'Space between items (px)', type: 'slider', tab: 'style', responsive: true, min: 0, max: 80 },
    colorControl('dropdownBg', 'Dropdown background'),
    colorControl('dropdownColor', 'Dropdown link colour'),
    colorControl('toggleColor', 'Hamburger colour'),
  ],
  css: (bag, node, device) => {
    const hamburgerOn = String(node.settings.hamburgerOn || 'mobile');
    const collapsed = (device === 'mobile' && hamburgerOn !== 'none') || (device === 'tablet' && hamburgerOn === 'tablet');
    return {
      ' .rwpb-nav': { 'justify-content': alignToFlex(bag.align) },
      ' .rwpb-nav-list': {
        gap: length(bag.itemGap ?? 24, 'px'),
        'justify-content': alignToFlex(bag.align),
        display: collapsed ? 'none' : 'flex',
      },
      ' .rwpb-nav.is-open .rwpb-nav-list': { display: 'flex', 'flex-direction': collapsed ? 'column' : undefined, width: collapsed ? '100%' : undefined },
      ' .rwpb-nav-toggle': { display: collapsed ? 'inline-flex' : 'none', color: color(bag.toggleColor) },
      ' .rwpb-nav-list a': { color: color(bag.linkColor), ...typography(bag.typography as Typography | undefined) },
      ' .rwpb-nav-list a:hover| .rwpb-nav-list a:focus-visible| .rwpb-nav-list a[aria-current=page]': { color: color(bag.linkHover) },
      ' .rwpb-nav-sub': { 'background-color': color(bag.dropdownBg), position: collapsed ? 'static' : undefined, 'box-shadow': collapsed ? 'none' : undefined },
      ' .rwpb-nav-sub a': { color: color(bag.dropdownColor) },
    };
  },
  View: function NavMenuView({ node }) {
    const { mode } = useRenderContext();
    const [menus, setMenus] = useState<MenuRecord[] | null>(null);
    const [error, setError] = useState('');
    const [open, setOpen] = useState(false);
    const [submenu, setSubmenu] = useState<number | null>(null);
    const navRef = useRef<HTMLElement>(null);

    useEffect(() => {
      let active = true;
      fetchMenus().then((result) => active && setMenus(result)).catch((loadError: unknown) => active && setError(loadError instanceof Error ? loadError.message : 'Could not load menus.'));
      return () => { active = false; };
    }, []);

    useEffect(() => {
      if (!open && submenu === null) return undefined;
      const close = (event: MouseEvent) => {
        if (!navRef.current?.contains(event.target as Node)) { setOpen(false); setSubmenu(null); }
      };
      document.addEventListener('click', close);
      return () => document.removeEventListener('click', close);
    }, [open, submenu]);

    if (error) return mode === 'edit' ? <div className="rwpb-placeholder">{error}</div> : null;
    if (!menus) return null;
    const menu = menus.find((item) => String(item.id) === String(node.settings.menuId)) || (node.settings.menuId ? undefined : menus[0]);
    if (!menu) return <EditorPlaceholder>{menus.length ? 'The chosen menu no longer exists. Pick another in the Content tab.' : 'Create a menu under Menus first.'}</EditorPlaceholder>;
    const links = nestMenu(menu);
    const here = typeof window !== 'undefined' ? window.location.pathname.replace(/\/+$/, '') || '/' : '';
    const vertical = node.settings.layout === 'vertical';
    return (
      <nav ref={navRef} className={`rwpb-nav rwpb-nav-${vertical ? 'vertical' : 'horizontal'}${open ? ' is-open' : ''}`} aria-label={menu.name}>
        <button type="button" className="rwpb-nav-toggle" aria-expanded={open} aria-label={open ? 'Close menu' : 'Open menu'} onClick={() => setOpen((value) => !value)}>
          <Icon name={open ? 'x' : 'menu'} size={24} />
        </button>
        <ul className="rwpb-nav-list">
          {links.map((link, index) => {
            const href = safeUrl(link.url);
            const current = href.replace(/\/+$/, '') === here || (href === '/' && here === '/');
            if (!link.children.length) {
              return <li key={`${link.label}-${index}`}><a href={href} aria-current={current ? 'page' : undefined}>{link.label}</a></li>;
            }
            const expanded = submenu === index;
            return (
              <li key={`${link.label}-${index}`} className={`rwpb-nav-parent${expanded ? ' is-expanded' : ''}`}
                onMouseEnter={() => setSubmenu(index)} onMouseLeave={() => setSubmenu((value) => (value === index ? null : value))}>
                <span className="rwpb-nav-parent-row">
                  <a href={href} aria-current={current ? 'page' : undefined}>{link.label}</a>
                  <button type="button" className="rwpb-nav-caret" aria-expanded={expanded} aria-label={`${link.label} submenu`} onClick={() => setSubmenu(expanded ? null : index)}>
                    <Icon name="chevron-down" size={16} />
                  </button>
                </span>
                <ul className="rwpb-nav-sub">
                  {link.children.map((child, childIndex) => <li key={`${child.label}-${childIndex}`}><a href={safeUrl(child.url)}>{child.label}</a></li>)}
                </ul>
              </li>
            );
          })}
        </ul>
      </nav>
    );
  },
};

// Custom HTML --------------------------------------------------------------------------------------

/**
 * Raw HTML, CSS and JavaScript, rendered without sanitising. That is only safe because the
 * builder_guard_html trigger refuses any save that adds or changes this widget's code unless
 * the user is an administrator.
 */
export const html: WidgetDefinition = {
  type: 'html',
  label: 'Custom HTML',
  icon: 'html',
  category: 'pro',
  keywords: ['code', 'embed', 'script', 'iframe'],
  adminOnly: true,
  defaults: () => ({ settings: { html: '<div class="my-embed">Hello from custom HTML</div>', css: '', js: '' } }),
  controls: [
    { key: 'html', label: 'HTML', type: 'code', language: 'html', help: 'Only administrators can add or change this code. Scripts in HTML do not run; put JavaScript in the field below.' },
    { key: 'css', label: 'CSS', type: 'code', language: 'css', help: 'Global CSS: scope it yourself, e.g. .my-embed { … }' },
    { key: 'js', label: 'JavaScript', type: 'code', language: 'js', help: 'Runs once on the live page after it renders, with "root" set to this widget\'s element. Not run in the editor.' },
  ],
  View: function HtmlView({ node }) {
    const { mode } = useRenderContext();
    const ref = useRef<HTMLDivElement>(null);
    const code = str(node.settings.js);
    useEffect(() => {
      if (mode !== 'view' || !code.trim() || !ref.current) return;
      try {
        // eslint-disable-next-line no-new-func -- deliberate: administrator-authored code.
        new Function('root', code)(ref.current);
      } catch (error) {
        console.error(`[rwp-page-builder] Custom HTML widget ${node.id} script failed:`, error);
      }
    }, [mode, code, node.id]);
    const markup = str(node.settings.html);
    if (!markup.trim() && !code.trim()) return <EditorPlaceholder>Add HTML in the Content tab.</EditorPlaceholder>;
    return (
      <>
        {str(node.settings.css) && <style>{str(node.settings.css).replace(/<\/?style/gi, '')}</style>}
        <div ref={ref} className="rwpb-html" dangerouslySetInnerHTML={{ __html: markup }} />
      </>
    );
  },
};
