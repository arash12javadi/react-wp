/** Basic widgets: image box, icon list, counter, progress bar, testimonial, tabs, toggle, alert, maps, galleries… */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import ContentRenderer from '../../../../src/components/ContentRenderer';
import { alignControl, colorControl, headingTags, linkControl, opts, typographyControl } from '../../lib/controls';
import { escapeHtml, resolveText } from '../../lib/dynamic';
import { Icon } from '../../lib/icons';
import type { WidgetDefinition } from '../../lib/registry';
import { safeUrl } from '../../lib/sanitize';
import { alignToFlex, border, color, isSet, length, radius, size, typography, type Border, type Box, type SizeValue, type Typography } from '../../lib/style';
import { templateOptions } from '../data';
import { EditableText } from '../NodeView';
import { useRenderContext } from '../context';
import { accordion } from './pro';
import { EditorPlaceholder, useLinkProps, useMediaUrl, useResolved, useText } from './shared';
import {
  Carousel, carouselControls, carouselCss, carouselOptions, clamp, headingTag, itemId, linkAttributes, listOf, num,
  pick, prefersReducedMotion, str, TemplateContent, useCurrentPost, useGalleryLightbox, useInView,
} from './kit';

const alignCss = (bag: Record<string, unknown>) => ({ 'text-align': isSet(bag.align) ? String(bag.align) : undefined });

// Image Box ---------------------------------------------------------------------------------------------

export const imageBox: WidgetDefinition = {
  type: 'image-box',
  label: 'Image Box',
  icon: 'image',
  category: 'basic',
  keywords: ['feature', 'card', 'team'],
  defaults: () => ({
    settings: { image: '', title: 'This is the heading', description: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.', position: 'top', titleTag: 'h3' },
    style: { align: 'center', imageWidth: 100 },
  }),
  controls: [
    { key: 'image', label: 'Image', type: 'image', dynamic: true },
    { key: 'alt', label: 'Alternative text', type: 'text', dynamic: true },
    { key: 'title', label: 'Title', type: 'text', dynamic: true },
    { key: 'description', label: 'Description', type: 'textarea', dynamic: true },
    linkControl(),
    { key: 'position', label: 'Image position', type: 'select', options: opts(['top', 'Top'], ['left', 'Left'], ['right', 'Right']) },
    { key: 'titleTag', label: 'Title HTML tag', type: 'select', options: headingTags },
    { key: 'imageWidth', label: 'Image width (%)', type: 'slider', tab: 'style', responsive: true, min: 5, max: 100 },
    { key: 'imageSpacing', label: 'Image spacing (px)', type: 'slider', tab: 'style', responsive: true, min: 0, max: 80 },
    { key: 'imageRadius', label: 'Image corner radius', type: 'dimensions', tab: 'style', units: ['px', '%'] },
    { key: 'hoverZoom', label: 'Zoom image on hover', type: 'toggle', tab: 'style' },
    alignControl(),
    colorControl('titleColor', 'Title colour'),
    typographyControl('titleTypography', 'Title typography'),
    colorControl('descriptionColor', 'Description colour'),
    typographyControl('descriptionTypography', 'Description typography'),
  ],
  css: (bag, node) => ({
    ' .rwpb-image-box': { ...alignCss(bag), gap: length(bag.imageSpacing ?? 16, 'px') },
    ' .rwpb-image-box-top': { 'align-items': node.settings.position === 'top' ? alignToFlex(bag.align) : undefined },
    ' .rwpb-image-box-img': {
      width: node.settings.position === 'top' ? `${num(bag.imageWidth, 100)}%` : undefined,
      'flex-basis': node.settings.position !== 'top' ? `${num(bag.imageWidth, 30)}%` : undefined,
      ...radius(bag.imageRadius as Box | undefined),
    },
    ' .rwpb-image-box:hover .rwpb-image-box-img img': { transform: bag.hoverZoom ? 'scale(1.06)' : undefined },
    ' .rwpb-image-box-title': { color: color(bag.titleColor), ...typography(bag.titleTypography as Typography | undefined) },
    ' .rwpb-image-box-description': { color: color(bag.descriptionColor), ...typography(bag.descriptionTypography as Typography | undefined) },
  }),
  View: function ImageBoxView({ node }) {
    const src = useMediaUrl(node.settings.image);
    const alt = useText(node.settings.alt);
    const link = useLinkProps(node.settings.link);
    const position = pick(node.settings.position, ['top', 'left', 'right'] as const, 'top');
    const Tag = headingTag(node.settings.titleTag);
    const title = <EditableText nodeId={node.id} field="title" value={str(node.settings.title)} />;
    const image = src ? <img src={src} alt={alt} loading="lazy" /> : <span className="rwpb-image-box-empty"><Icon name="image" size={32} /></span>;
    return (
      <div className={`rwpb-image-box rwpb-image-box-${position}`}>
        <figure className="rwpb-image-box-img">{link ? <a {...link} tabIndex={-1} aria-hidden="true">{image}</a> : image}</figure>
        <div className="rwpb-image-box-content">
          <Tag className="rwpb-image-box-title">{link ? <a {...link}>{title}</a> : title}</Tag>
          <EditableText nodeId={node.id} field="description" value={str(node.settings.description)} as="p" className="rwpb-image-box-description" multiline />
        </div>
      </div>
    );
  },
};

// Icon List ------------------------------------------------------------------------------------------------

interface IconListItem { id: string; text: string; icon?: string; link?: unknown }

export const iconList: WidgetDefinition = {
  type: 'icon-list',
  label: 'Icon List',
  icon: 'list-checks',
  category: 'basic',
  keywords: ['features', 'bullets', 'checklist'],
  defaults: () => ({
    settings: {
      layout: 'traditional',
      items: [
        { id: itemId(), text: 'List item #1', icon: 'check' },
        { id: itemId(), text: 'List item #2', icon: 'check' },
        { id: itemId(), text: 'List item #3', icon: 'check' },
      ],
    },
  }),
  controls: [
    { key: 'items', label: 'Items', type: 'repeater', itemLabel: 'text', newItem: () => ({ id: itemId(), text: 'List item', icon: 'check' }), fields: [
      { key: 'text', label: 'Text', type: 'text', dynamic: true },
      { key: 'icon', label: 'Icon', type: 'icon' },
      linkControl(),
    ] },
    { key: 'layout', label: 'Layout', type: 'select', options: opts(['traditional', 'Vertical'], ['inline', 'Inline']) },
    { key: 'divider', label: 'Divider between items', type: 'toggle' },
    { key: 'space', label: 'Space between (px)', type: 'slider', tab: 'style', responsive: true, min: 0, max: 60 },
    alignControl(),
    colorControl('dividerColor', 'Divider colour'),
    colorControl('iconColor', 'Icon colour'),
    { key: 'iconSize', label: 'Icon size (px)', type: 'slider', tab: 'style', responsive: true, min: 6, max: 80 },
    { key: 'iconGap', label: 'Gap after icon (px)', type: 'slider', tab: 'style', min: 0, max: 40 },
    colorControl('textColor', 'Text colour'),
    colorControl('textHover', 'Text hover colour'),
    typographyControl(),
  ],
  css: (bag) => ({
    ' .rwpb-icon-list': { gap: length(bag.space ?? 8, 'px'), 'justify-content': alignToFlex(bag.align), 'align-items': alignToFlex(bag.align), '--rwpb-divider-color': color(bag.dividerColor) },
    ' .rwpb-icon-list-icon': { color: color(bag.iconColor), 'font-size': length(bag.iconSize, 'px') },
    ' .rwpb-icon-list-item': { gap: length(bag.iconGap ?? 10, 'px') },
    ' .rwpb-icon-list-text': { color: color(bag.textColor), ...typography(bag.typography as Typography | undefined) },
    ' a.rwpb-icon-list-item:hover .rwpb-icon-list-text': { color: color(bag.textHover) },
  }),
  View: function IconListView({ node }) {
    const { dynamic, mode } = useRenderContext();
    const items = listOf<IconListItem>(node.settings.items);
    if (!items.length) return <EditorPlaceholder>Add list items in the Content tab.</EditorPlaceholder>;
    const layout = node.settings.layout === 'inline' ? 'inline' : 'traditional';
    return (
      <ul className={`rwpb-icon-list rwpb-icon-list-${layout}${node.settings.divider ? ' rwpb-icon-list-divided' : ''}`}>
        {items.map((item, index) => {
          const link = linkAttributes(item.link, dynamic);
          const content = (
            <>
              {item.icon && <span className="rwpb-icon-list-icon"><Icon name={item.icon} size="1em" /></span>}
              <span className="rwpb-icon-list-text">{mode === 'edit' ? item.text : resolveText(item.text, dynamic)}</span>
            </>
          );
          return (
            <li key={item.id || index}>
              {link ? <a className="rwpb-icon-list-item" {...link}>{content}</a> : <span className="rwpb-icon-list-item">{content}</span>}
            </li>
          );
        })}
      </ul>
    );
  },
};

// Counter ------------------------------------------------------------------------------------------------------

const formatCount = (value: number, decimals: number, separator: string) => {
  const fixed = value.toFixed(decimals);
  if (!separator) return fixed;
  const [whole, fraction] = fixed.split('.');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, separator)}${fraction ? `.${fraction}` : ''}`;
};

export const counter: WidgetDefinition = {
  type: 'counter',
  label: 'Counter',
  icon: 'timer',
  category: 'basic',
  keywords: ['number', 'stats', 'count up'],
  defaults: () => ({ settings: { start: 0, end: 100, duration: 2000, prefix: '', suffix: '+', separator: ',', decimals: 0, title: 'Cool number', titlePosition: 'below' }, style: { align: 'center' } }),
  controls: [
    { key: 'start', label: 'Starting number', type: 'number' },
    { key: 'end', label: 'Ending number', type: 'number' },
    { key: 'decimals', label: 'Decimal places', type: 'number', min: 0, max: 4 },
    { key: 'prefix', label: 'Number prefix', type: 'text' },
    { key: 'suffix', label: 'Number suffix', type: 'text' },
    { key: 'duration', label: 'Animation duration (ms)', type: 'slider', min: 0, max: 10000, step: 100 },
    { key: 'separator', label: 'Thousand separator', type: 'select', options: opts([',', 'Comma (1,000)'], ['.', 'Dot (1.000)'], [' ', 'Space (1 000)'], ['', 'None']) },
    { key: 'title', label: 'Title', type: 'text', dynamic: true },
    { key: 'titlePosition', label: 'Title position', type: 'select', options: opts(['below', 'Below the number'], ['above', 'Above the number'], ['inline', 'Next to the number']) },
    alignControl(),
    colorControl('numberColor', 'Number colour'),
    typographyControl('numberTypography', 'Number typography'),
    colorControl('titleColor', 'Title colour'),
    typographyControl('titleTypography', 'Title typography'),
  ],
  css: (bag) => ({
    ' .rwpb-counter': { ...alignCss(bag), 'align-items': alignToFlex(bag.align) },
    ' .rwpb-counter-number': { color: color(bag.numberColor), ...typography(bag.numberTypography as Typography | undefined) },
    ' .rwpb-counter-title': { color: color(bag.titleColor), ...typography(bag.titleTypography as Typography | undefined) },
  }),
  View: function CounterView({ node }) {
    const settings = node.settings;
    const start = num(settings.start, 0);
    const end = num(settings.end, 100);
    const decimals = clamp(Math.round(num(settings.decimals, 0)), 0, 4);
    const duration = clamp(num(settings.duration, 2000), 0, 10000);
    const [ref, inView] = useInView<HTMLDivElement>();
    const { mode } = useRenderContext();
    const [value, setValue] = useState(mode === 'edit' ? end : start);
    const title = useText(settings.title);

    useEffect(() => {
      if (mode === 'edit') { setValue(end); return undefined; }
      if (!inView) return undefined;
      if (!duration || prefersReducedMotion()) { setValue(end); return undefined; }
      let frame = 0;
      const began = performance.now();
      const tick = (now: number) => {
        const progress = Math.min(1, (now - began) / duration);
        // Ease out: fast at first, settling on the final number.
        setValue(start + (end - start) * (1 - (1 - progress) ** 3));
        if (progress < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(frame);
    }, [mode, inView, start, end, duration]);

    const position = pick(settings.titlePosition, ['below', 'above', 'inline'] as const, 'below');
    const finalText = `${str(settings.prefix)}${formatCount(end, decimals, str(settings.separator, ','))}${str(settings.suffix)}`;
    return (
      <div ref={ref} className={`rwpb-counter rwpb-counter-${position}`}>
        {position === 'above' && title && <div className="rwpb-counter-title">{title}</div>}
        <div className="rwpb-counter-number" aria-label={finalText}>
          <span aria-hidden="true">{str(settings.prefix)}{formatCount(value, decimals, str(settings.separator, ','))}{str(settings.suffix)}</span>
        </div>
        {position !== 'above' && title && <div className="rwpb-counter-title">{title}</div>}
      </div>
    );
  },
};

// Progress Bar -------------------------------------------------------------------------------------------------

export const progressBar: WidgetDefinition = {
  type: 'progress-bar',
  label: 'Progress Bar',
  icon: 'sliders',
  category: 'basic',
  keywords: ['skill', 'percentage', 'bar'],
  defaults: () => ({ settings: { title: 'My skill', percent: 75, showPercent: true, innerText: 'Web designer', barType: '' } }),
  controls: [
    { key: 'title', label: 'Title', type: 'text', dynamic: true },
    { key: 'percent', label: 'Percentage', type: 'slider', min: 0, max: 100 },
    { key: 'showPercent', label: 'Show percentage', type: 'toggle' },
    { key: 'innerText', label: 'Inner text', type: 'text', dynamic: true },
    { key: 'barType', label: 'Type', type: 'select', options: opts(['', 'Default'], ['info', 'Info'], ['success', 'Success'], ['warning', 'Warning'], ['danger', 'Danger']) },
    { key: 'height', label: 'Bar height (px)', type: 'slider', tab: 'style', responsive: true, min: 4, max: 60 },
    { key: 'barRadius', label: 'Corner radius (px)', type: 'slider', tab: 'style', min: 0, max: 30 },
    colorControl('barColor', 'Bar colour'),
    colorControl('trackColor', 'Track colour'),
    colorControl('innerColor', 'Inner text colour'),
    typographyControl('innerTypography', 'Inner text typography'),
    colorControl('titleColor', 'Title colour'),
    typographyControl('titleTypography', 'Title typography'),
  ],
  css: (bag) => ({
    ' .rwpb-progress-track': { height: length(bag.height, 'px'), 'background-color': color(bag.trackColor), 'border-radius': length(bag.barRadius, 'px') },
    ' .rwpb-progress-fill': { 'background-color': color(bag.barColor), 'border-radius': length(bag.barRadius, 'px') },
    ' .rwpb-progress-inner': { color: color(bag.innerColor), ...typography(bag.innerTypography as Typography | undefined) },
    ' .rwpb-progress-title': { color: color(bag.titleColor), ...typography(bag.titleTypography as Typography | undefined) },
  }),
  View: function ProgressBarView({ node }) {
    const percent = clamp(num(node.settings.percent, 0), 0, 100);
    const [ref, inView] = useInView<HTMLDivElement>();
    const title = useText(node.settings.title);
    const innerText = useText(node.settings.innerText);
    const type = pick(node.settings.barType, ['', 'info', 'success', 'warning', 'danger'] as const, '');
    const labelId = useId();
    return (
      <div ref={ref} className={`rwpb-progress${type ? ` rwpb-progress-${type}` : ''}`}>
        {title && <div id={labelId} className="rwpb-progress-title">{title}</div>}
        <div className="rwpb-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-labelledby={title ? labelId : undefined} aria-label={title ? undefined : 'Progress'}>
          <div className="rwpb-progress-fill" style={{ width: inView ? `${percent}%` : 0 }}>
            {innerText && <span className="rwpb-progress-inner">{innerText}</span>}
            {Boolean(node.settings.showPercent) && <span className="rwpb-progress-percent">{percent}%</span>}
          </div>
        </div>
      </div>
    );
  },
};

// Testimonial -------------------------------------------------------------------------------------------------

export const testimonial: WidgetDefinition = {
  type: 'testimonial',
  label: 'Testimonial',
  icon: 'testimonial',
  category: 'basic',
  keywords: ['quote', 'review', 'customer'],
  defaults: () => ({
    settings: { content: 'Click to edit this testimonial. It is the best service we have ever used, and the team is wonderful.', name: 'John Doe', job: 'Designer', image: '', imagePosition: 'aside', rating: 5 },
    style: { align: 'center' },
  }),
  controls: [
    { key: 'content', label: 'Content', type: 'textarea', dynamic: true },
    { key: 'image', label: 'Image', type: 'image', dynamic: true },
    { key: 'name', label: 'Name', type: 'text', dynamic: true },
    { key: 'job', label: 'Title / company', type: 'text', dynamic: true },
    linkControl('link', 'Name link'),
    { key: 'rating', label: 'Star rating (0 hides it)', type: 'slider', min: 0, max: 5, step: 0.5 },
    { key: 'imagePosition', label: 'Image position', type: 'select', options: opts(['aside', 'Next to the name'], ['top', 'Above the text']) },
    alignControl(),
    { key: 'imageSize', label: 'Image size (px)', type: 'slider', tab: 'style', min: 24, max: 200 },
    colorControl('contentColor', 'Content colour'),
    typographyControl('contentTypography', 'Content typography'),
    colorControl('nameColor', 'Name colour'),
    typographyControl('nameTypography', 'Name typography'),
    colorControl('jobColor', 'Title colour'),
    colorControl('starColor', 'Star colour'),
  ],
  css: (bag) => ({
    ' .rwpb-testimonial': { ...alignCss(bag), 'align-items': alignToFlex(bag.align) },
    ' .rwpb-testimonial-footer': { 'justify-content': alignToFlex(bag.align) },
    ' .rwpb-testimonial-image': { width: length(bag.imageSize, 'px'), height: length(bag.imageSize, 'px') },
    ' .rwpb-testimonial-content': { color: color(bag.contentColor), ...typography(bag.contentTypography as Typography | undefined) },
    ' .rwpb-testimonial-name': { color: color(bag.nameColor), ...typography(bag.nameTypography as Typography | undefined) },
    ' .rwpb-testimonial-job': { color: color(bag.jobColor) },
    ' .rwpb-stars': { '--rwpb-star-color': color(bag.starColor) },
  }),
  View: function TestimonialView({ node }) {
    const image = useMediaUrl(node.settings.image);
    const name = useText(node.settings.name);
    const link = useLinkProps(node.settings.link);
    const position = node.settings.imagePosition === 'top' ? 'top' : 'aside';
    const rating = clamp(num(node.settings.rating, 0), 0, 5);
    const img = image ? <img className="rwpb-testimonial-image" src={image} alt="" loading="lazy" /> : null;
    return (
      <figure className={`rwpb-testimonial rwpb-testimonial-${position}`}>
        {position === 'top' && img}
        {rating > 0 && <Stars value={rating} scale={5} />}
        <blockquote className="rwpb-testimonial-content">
          <EditableText nodeId={node.id} field="content" value={str(node.settings.content)} as="p" multiline />
        </blockquote>
        <figcaption className="rwpb-testimonial-footer">
          {position === 'aside' && img}
          <span className="rwpb-testimonial-cite">
            <span className="rwpb-testimonial-name">{link ? <a {...link}>{name}</a> : <EditableText nodeId={node.id} field="name" value={str(node.settings.name)} />}</span>
            <EditableText nodeId={node.id} field="job" value={str(node.settings.job)} className="rwpb-testimonial-job" />
          </span>
        </figcaption>
      </figure>
    );
  },
};

/** Stars filled to a fraction by clipping a solid row over an outline row. */
export function Stars({ value, scale = 5, glyph = '★', emptyGlyph }: { value: number; scale?: number; glyph?: string; emptyGlyph?: string }) {
  const count = Math.max(1, Math.round(scale));
  const fill = clamp(value / count, 0, 1) * 100;
  const label = `Rated ${Number(value.toFixed(1))} out of ${count}`;
  return (
    <span className="rwpb-stars" role="img" aria-label={label}>
      <span className="rwpb-stars-empty" aria-hidden="true">{(emptyGlyph || glyph).repeat(count)}</span>
      <span className="rwpb-stars-fill" aria-hidden="true" style={{ width: `${fill}%` }}>{glyph.repeat(count)}</span>
    </span>
  );
}

// Star Rating ---------------------------------------------------------------------------------------------------

export const starRating: WidgetDefinition = {
  type: 'star-rating',
  label: 'Star Rating',
  icon: 'star-half',
  category: 'basic',
  keywords: ['rating', 'stars', 'score', 'review'],
  defaults: () => ({ settings: { rating: 4.5, scale: '5', title: '', glyph: 'star', unmarked: 'solid' } }),
  controls: [
    { key: 'scale', label: 'Rating scale', type: 'select', options: opts(['5', '0–5'], ['10', '0–10']) },
    { key: 'rating', label: 'Rating', type: 'slider', min: 0, max: 10, step: 0.1 },
    { key: 'glyph', label: 'Icon', type: 'select', options: opts(['star', 'Star'], ['heart', 'Heart'], ['circle', 'Circle']) },
    { key: 'unmarked', label: 'Unmarked style', type: 'select', options: opts(['solid', 'Solid'], ['outline', 'Outline']) },
    { key: 'title', label: 'Title', type: 'text', dynamic: true },
    alignControl('align', 'Alignment', true),
    { key: 'starSize', label: 'Icon size (px)', type: 'slider', tab: 'style', responsive: true, min: 8, max: 80 },
    { key: 'starSpacing', label: 'Spacing (px)', type: 'slider', tab: 'style', min: 0, max: 20 },
    colorControl('starColor', 'Marked colour'),
    colorControl('emptyColor', 'Unmarked colour'),
    colorControl('titleColor', 'Title colour'),
    typographyControl('titleTypography', 'Title typography'),
  ],
  css: (bag) => ({
    ' .rwpb-star-rating': { 'justify-content': bag.align === 'justify' ? 'space-between' : alignToFlex(bag.align) },
    ' .rwpb-stars': { 'font-size': length(bag.starSize, 'px'), 'letter-spacing': length(bag.starSpacing, 'px'), '--rwpb-star-color': color(bag.starColor), '--rwpb-star-empty': color(bag.emptyColor) },
    ' .rwpb-star-rating-title': { color: color(bag.titleColor), ...typography(bag.titleTypography as Typography | undefined) },
  }),
  View: function StarRatingView({ node }) {
    const scale = node.settings.scale === '10' ? 10 : 5;
    const rating = clamp(num(node.settings.rating, 0), 0, scale);
    const title = useText(node.settings.title);
    const glyph = node.settings.glyph === 'heart' ? '♥' : node.settings.glyph === 'circle' ? '●' : '★';
    const empty = node.settings.unmarked === 'outline' ? (glyph === '♥' ? '♡' : glyph === '●' ? '○' : '☆') : glyph;
    return (
      <div className="rwpb-star-rating">
        {title && <span className="rwpb-star-rating-title">{title}</span>}
        <Stars value={rating} scale={scale} glyph={glyph} emptyGlyph={empty} />
      </div>
    );
  },
};

// Tabs ------------------------------------------------------------------------------------------------------------

interface TabItem { id: string; title: string; content?: string; templateId?: string; icon?: string }

export const tabs: WidgetDefinition = {
  type: 'tabs',
  label: 'Tabs',
  icon: 'panel-top',
  category: 'basic',
  keywords: ['tab', 'switcher'],
  defaults: () => ({
    settings: {
      items: [
        { id: itemId(), title: 'Tab #1', content: '<p>Tab content. Click edit in the Content tab.</p>' },
        { id: itemId(), title: 'Tab #2', content: '<p>More tab content.</p>' },
      ],
      layout: 'horizontal',
      tabAlign: 'start',
    },
  }),
  controls: [
    { key: 'items', label: 'Tabs', type: 'repeater', itemLabel: 'title', newItem: () => ({ id: itemId(), title: 'New tab', content: '<p>Tab content.</p>' }), fields: [
      { key: 'title', label: 'Title', type: 'text' },
      { key: 'icon', label: 'Icon', type: 'icon' },
      { key: 'content', label: 'Content', type: 'richtext', help: 'Shortcodes work here.' },
      { key: 'templateId', label: 'Or show a saved template', type: 'asyncSelect', loadOptions: templateOptions, placeholder: '— Use the content above —' },
    ] },
    { key: 'layout', label: 'Layout', type: 'select', options: opts(['horizontal', 'Horizontal'], ['vertical', 'Vertical']) },
    { key: 'tabAlign', label: 'Tab alignment', type: 'select', options: opts(['start', 'Start'], ['center', 'Center'], ['end', 'End'], ['stretch', 'Stretch']) },
    colorControl('tabColor', 'Tab colour'),
    colorControl('activeColor', 'Active tab colour'),
    colorControl('activeBg', 'Active tab background'),
    colorControl('borderColor', 'Border colour'),
    typographyControl('tabTypography', 'Tab typography'),
    colorControl('contentColor', 'Content colour'),
    colorControl('contentBg', 'Content background'),
    typographyControl('contentTypography', 'Content typography'),
  ],
  css: (bag) => ({
    ' .rwpb-tabs': { '--rwpb-tabs-border': color(bag.borderColor), '--rwpb-tabs-active': color(bag.activeColor), '--rwpb-tabs-active-bg': color(bag.activeBg) },
    ' .rwpb-tab': { color: color(bag.tabColor), ...typography(bag.tabTypography as Typography | undefined) },
    ' .rwpb-tab-panel': { color: color(bag.contentColor), 'background-color': color(bag.contentBg), ...typography(bag.contentTypography as Typography | undefined) },
  }),
  View: function TabsView({ node }) {
    const items = listOf<TabItem>(node.settings.items);
    const [active, setActive] = useState(0);
    const baseId = useId();
    const buttons = useRef<Array<HTMLButtonElement | null>>([]);
    useEffect(() => { if (active >= items.length) setActive(0); }, [active, items.length]);
    if (!items.length) return <EditorPlaceholder>Add tabs in the Content tab.</EditorPlaceholder>;
    const layout = node.settings.layout === 'vertical' ? 'vertical' : 'horizontal';
    const align = pick(node.settings.tabAlign, ['start', 'center', 'end', 'stretch'] as const, 'start');
    const current = Math.min(active, items.length - 1);
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
      const keys = layout === 'vertical' ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight'];
      let next = -1;
      if (event.key === keys[0]) next = (current - 1 + items.length) % items.length;
      if (event.key === keys[1]) next = (current + 1) % items.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = items.length - 1;
      if (next < 0) return;
      event.preventDefault();
      setActive(next);
      buttons.current[next]?.focus();
    };
    return (
      <div className={`rwpb-tabs rwpb-tabs-${layout} rwpb-tabs-align-${align}`}>
        <div className="rwpb-tab-list" role="tablist" aria-orientation={layout} onKeyDown={onKeyDown}>
          {items.map((item, index) => (
            <button key={item.id || index} ref={(element) => { buttons.current[index] = element; }} type="button" role="tab"
              id={`${baseId}-tab-${index}`} aria-controls={`${baseId}-panel-${index}`} aria-selected={index === current} tabIndex={index === current ? 0 : -1}
              className={`rwpb-tab${index === current ? ' is-active' : ''}`} onClick={() => setActive(index)}>
              {item.icon && <Icon name={item.icon} size="1em" />}
              <span>{item.title || `Tab ${index + 1}`}</span>
            </button>
          ))}
        </div>
        {items.map((item, index) => (
          <div key={item.id || index} id={`${baseId}-panel-${index}`} role="tabpanel" aria-labelledby={`${baseId}-tab-${index}`}
            className="rwpb-tab-panel" hidden={index !== current} tabIndex={0}>
            {item.templateId ? <TemplateContent templateId={item.templateId} /> : <ContentRenderer className="rwpb-text" html={str(item.content)} />}
          </div>
        ))}
      </div>
    );
  },
};

// Toggle ---------------------------------------------------------------------------------------------------------

/** Elementor's Toggle is an accordion whose items open independently. */
export const toggle: WidgetDefinition = {
  ...accordion,
  type: 'toggle',
  label: 'Toggle',
  icon: 'toggle',
  category: 'basic',
  keywords: ['collapse', 'faq', 'expand', 'accordion'],
  defaults: () => {
    const base = accordion.defaults();
    return { ...base, settings: { ...base.settings, multiple: true, firstOpen: false, icon: 'chevron' } };
  },
};

// Alert -------------------------------------------------------------------------------------------------------------

const alertIcons: Record<string, string> = { info: 'info', success: 'circle-check', warning: 'triangle-alert', danger: 'circle-alert' };

export const alert: WidgetDefinition = {
  type: 'alert',
  label: 'Alert',
  icon: 'bell',
  category: 'basic',
  keywords: ['notice', 'message', 'callout', 'warning'],
  defaults: () => ({ settings: { alertType: 'info', title: 'This is an alert', description: 'I am a description. Click edit to change this text.', dismissible: true, showIcon: true } }),
  controls: [
    { key: 'alertType', label: 'Type', type: 'select', options: opts(['info', 'Info'], ['success', 'Success'], ['warning', 'Warning'], ['danger', 'Danger']) },
    { key: 'title', label: 'Title', type: 'text', dynamic: true },
    { key: 'description', label: 'Description', type: 'textarea', dynamic: true },
    { key: 'showIcon', label: 'Show icon', type: 'toggle' },
    { key: 'dismissible', label: 'Dismiss button', type: 'toggle' },
    colorControl('bgColor', 'Background colour'),
    colorControl('borderColor', 'Accent / border colour'),
    colorControl('titleColor', 'Title colour'),
    typographyControl('titleTypography', 'Title typography'),
    colorControl('descriptionColor', 'Description colour'),
    typographyControl('descriptionTypography', 'Description typography'),
  ],
  css: (bag) => ({
    ' .rwpb-alert': { 'background-color': color(bag.bgColor), '--rwpb-alert-accent': color(bag.borderColor) },
    ' .rwpb-alert-title': { color: color(bag.titleColor), ...typography(bag.titleTypography as Typography | undefined) },
    ' .rwpb-alert-description': { color: color(bag.descriptionColor), ...typography(bag.descriptionTypography as Typography | undefined) },
  }),
  View: function AlertView({ node }) {
    const [dismissed, setDismissed] = useState(false);
    const { mode } = useRenderContext();
    const type = pick(node.settings.alertType, ['info', 'success', 'warning', 'danger'] as const, 'info');
    if (dismissed && mode === 'view') return null;
    return (
      <div className={`rwpb-alert rwpb-alert-${type}`}>
        {Boolean(node.settings.showIcon) && <span className="rwpb-alert-icon"><Icon name={alertIcons[type]} size={20} /></span>}
        <div className="rwpb-alert-body">
          <EditableText nodeId={node.id} field="title" value={str(node.settings.title)} as="p" className="rwpb-alert-title" />
          <EditableText nodeId={node.id} field="description" value={str(node.settings.description)} as="p" className="rwpb-alert-description" multiline />
        </div>
        {Boolean(node.settings.dismissible) && (
          <button type="button" className="rwpb-alert-dismiss" aria-label="Dismiss this alert" onClick={() => mode === 'view' && setDismissed(true)}>×</button>
        )}
      </div>
    );
  },
};

// SoundCloud -------------------------------------------------------------------------------------------------------

export const soundcloud: WidgetDefinition = {
  type: 'soundcloud',
  label: 'SoundCloud',
  icon: 'audio-lines',
  category: 'basic',
  keywords: ['audio', 'music', 'podcast', 'embed'],
  defaults: () => ({ settings: { url: 'https://soundcloud.com/shchxango/john-coltrane-1963-my-favorite', visual: true, autoplay: false, showComments: true, showUser: true, showArtwork: true, buttonColor: '#ff5500' }, style: { playerHeight: 300 } }),
  controls: [
    { key: 'url', label: 'SoundCloud URL', type: 'text', placeholder: 'https://soundcloud.com/artist/track' },
    { key: 'visual', label: 'Visual player', type: 'toggle' },
    { key: 'autoplay', label: 'Autoplay', type: 'toggle' },
    { key: 'showArtwork', label: 'Artwork', type: 'toggle', condition: (settings) => !settings.visual },
    { key: 'showUser', label: 'Username', type: 'toggle' },
    { key: 'showComments', label: 'Comments', type: 'toggle' },
    { key: 'buttonColor', label: 'Controls colour (hex)', type: 'text', placeholder: '#ff5500' },
    { key: 'playerHeight', label: 'Height (px)', type: 'slider', tab: 'style', responsive: true, min: 100, max: 600 },
  ],
  css: (bag) => ({ ' .rwpb-soundcloud iframe': { height: length(bag.playerHeight ?? 300, 'px') } }),
  View: function SoundCloudView({ node }) {
    const url = useResolved(node.settings.url).trim();
    if (!/^https:\/\/(www\.|m\.|on\.)?soundcloud\.com\//i.test(url)) return <EditorPlaceholder>Paste a soundcloud.com link to a track, playlist or profile.</EditorPlaceholder>;
    const hex = str(node.settings.buttonColor).replace('#', '');
    const params = new URLSearchParams({
      url,
      auto_play: String(Boolean(node.settings.autoplay)),
      visual: String(Boolean(node.settings.visual)),
      show_user: String(Boolean(node.settings.showUser)),
      show_comments: String(Boolean(node.settings.showComments)),
      show_artwork: String(node.settings.showArtwork !== false),
      ...(/^[0-9a-f]{6}$/i.test(hex) ? { color: `#${hex}` } : {}),
    });
    return (
      <div className="rwpb-soundcloud">
        <iframe title="SoundCloud player" src={`https://w.soundcloud.com/player/?${params}`} allow="autoplay" loading="lazy" />
      </div>
    );
  },
};

// Shortcode -------------------------------------------------------------------------------------------------------------

export const shortcode: WidgetDefinition = {
  type: 'shortcode',
  label: 'Shortcode',
  icon: 'braces',
  category: 'basic',
  keywords: ['embed', 'plugin'],
  defaults: () => ({ settings: { code: '[rwp_login]' } }),
  controls: [
    { key: 'code', label: 'Shortcode', type: 'textarea', placeholder: '[rwp_login label="Sign in"]', help: 'Any shortcode registered by React-WP or a plugin, e.g. [rwp_login] or [rwp_products limit="4"]. Dashboard → Guide lists them.' },
  ],
  View: function ShortcodeView({ node }) {
    const code = str(node.settings.code).trim();
    if (!code) return <EditorPlaceholder>Enter a shortcode in the Content tab.</EditorPlaceholder>;
    // Escaped, so only registered shortcodes turn into components; any markup stays text.
    return <ContentRenderer className="rwpb-shortcode" html={`<div>${escapeHtml(code)}</div>`} />;
  },
};

// Menu Anchor ---------------------------------------------------------------------------------------------------------------

export const menuAnchor: WidgetDefinition = {
  type: 'menu-anchor',
  label: 'Menu Anchor',
  icon: 'anchor',
  category: 'basic',
  keywords: ['anchor', 'jump', 'one page', 'scroll'],
  defaults: () => ({ settings: { anchor: 'section-name', offset: 0 } }),
  controls: [
    { key: 'anchor', label: 'The ID of the menu anchor', type: 'text', placeholder: 'contact', help: 'Link to it with #contact, e.g. in a menu item or a button. Letters, numbers, - and _ only.' },
    { key: 'offset', label: 'Scroll offset (px)', type: 'number', help: 'Stops this far above the anchor, e.g. the height of a sticky header.' },
  ],
  View: function MenuAnchorView({ node }) {
    const { mode } = useRenderContext();
    const anchor = str(node.settings.anchor).trim().replace(/[^\w-]/g, '-');
    return (
      <div id={anchor || undefined} className="rwpb-menu-anchor" style={{ scrollMarginTop: `${num(node.settings.offset, 0)}px` }}>
        {mode === 'edit' && <div className="rwpb-placeholder"><Icon name="anchor" size={14} /> {anchor ? `Anchor: #${anchor}` : 'Enter an anchor ID in the Content tab.'}</div>}
      </div>
    );
  },
};

// Read More ---------------------------------------------------------------------------------------------------------------------

export const readMore: WidgetDefinition = {
  type: 'read-more',
  label: 'Read More',
  icon: 'arrow-right',
  category: 'basic',
  keywords: ['continue', 'more', 'link'],
  defaults: () => ({ settings: { text: 'Continue reading »', source: 'current', display: 'link' } }),
  controls: [
    { key: 'text', label: 'Text', type: 'text', dynamic: true },
    { key: 'source', label: 'Links to', type: 'select', options: opts(['current', 'The current post (use it in loop templates)'], ['custom', 'A custom URL']) },
    { ...linkControl(), condition: (settings) => settings.source === 'custom' },
    { key: 'display', label: 'Show as', type: 'select', options: opts(['link', 'Link'], ['button', 'Button']) },
    alignControl(),
    colorControl('textColor', 'Colour'),
    colorControl('hoverColor', 'Hover colour'),
    typographyControl(),
  ],
  css: (bag) => ({
    '': alignCss(bag),
    ' .rwpb-read-more': { color: color(bag.textColor), ...typography(bag.typography as Typography | undefined) },
    ' .rwpb-read-more:hover': { color: color(bag.hoverColor) },
  }),
  View: function ReadMoreView({ node }) {
    const post = useCurrentPost();
    const text = useText(node.settings.text);
    const custom = useLinkProps(node.settings.link);
    const link = node.settings.source === 'custom' ? custom : post ? { href: `/${post.slug}`, target: undefined, rel: undefined } : null;
    const className = node.settings.display === 'button' ? 'rwpb-read-more rwpb-button rwpb-button-md' : 'rwpb-read-more';
    if (!link) return <EditorPlaceholder>{node.settings.source === 'custom' ? 'Enter a URL in the Content tab.' : 'Links to the current post. Nothing to link to on this page yet.'}</EditorPlaceholder>;
    return <a className={className} {...link}>{text}</a>;
  },
};

// Text Path ------------------------------------------------------------------------------------------------------------------------

const textPaths: Record<string, string> = {
  wave: 'M0,125 C40,60 85,60 125,125 C165,190 210,190 250,125',
  arc: 'M20,180 A110,110 0 0 1 230,180',
  circle: 'M125,20 A105,105 0 1 1 124.9,20',
  oval: 'M15,125 A110,65 0 1 1 235,125 A110,65 0 1 1 15,125',
  line: 'M0,125 L250,125',
  spiral: 'M125,125 C125,112 143,112 143,125 C143,146 107,146 107,125 C107,92 161,92 161,125 C161,170 89,170 89,125 C89,74 179,74 179,125 C179,194 71,194 71,125 C71,56 197,56 197,125',
};

export const textPath: WidgetDefinition = {
  type: 'text-path',
  label: 'Text Path',
  icon: 'spline',
  category: 'basic',
  keywords: ['curved text', 'circle text', 'svg'],
  defaults: () => ({ settings: { text: 'Add Your Curvy Text Here', pathType: 'wave', startOffset: 0, anchor: 'start' }, style: { pathSize: 500 } }),
  controls: [
    { key: 'text', label: 'Text', type: 'text', dynamic: true },
    { key: 'pathType', label: 'Path type', type: 'select', options: opts(['wave', 'Wave'], ['arc', 'Arc'], ['circle', 'Circle'], ['oval', 'Oval'], ['line', 'Line'], ['spiral', 'Spiral']) },
    linkControl(),
    { key: 'anchor', label: 'Text alignment', type: 'select', options: opts(['start', 'Start'], ['middle', 'Center'], ['end', 'End']) },
    { key: 'startOffset', label: 'Starting point (%)', type: 'slider', min: -100, max: 100 },
    { key: 'showPath', label: 'Show path', type: 'toggle' },
    { key: 'pathSize', label: 'Size (px)', type: 'slider', tab: 'style', responsive: true, min: 60, max: 1000 },
    { key: 'rotation', label: 'Rotate (deg)', type: 'slider', tab: 'style', responsive: true, min: 0, max: 360 },
    alignControl(),
    colorControl('textColor', 'Text colour'),
    colorControl('hoverColor', 'Text hover colour'),
    typographyControl(),
    colorControl('pathColor', 'Path colour'),
    { key: 'pathWidth', label: 'Path width (px)', type: 'slider', tab: 'style', min: 1, max: 10 },
  ],
  css: (bag) => ({
    '': alignCss(bag),
    ' .rwpb-text-path svg': { width: length(bag.pathSize ?? 500, 'px'), transform: isSet(bag.rotation) ? `rotate(${num(bag.rotation, 0)}deg)` : undefined },
    ' .rwpb-text-path text': { fill: color(bag.textColor), ...typography(bag.typography as Typography | undefined) },
    ' .rwpb-text-path a:hover text': { fill: color(bag.hoverColor) },
    ' .rwpb-text-path path': { stroke: color(bag.pathColor), 'stroke-width': length(bag.pathWidth, 'px') },
  }),
  View: function TextPathView({ node }) {
    const text = useText(node.settings.text);
    const link = useLinkProps(node.settings.link);
    const type = pick(node.settings.pathType, ['wave', 'arc', 'circle', 'oval', 'line', 'spiral'] as const, 'wave');
    const anchor = pick(node.settings.anchor, ['start', 'middle', 'end'] as const, 'start');
    const pathId = `rwpb-tp-${node.id}`;
    const offset = clamp(num(node.settings.startOffset, 0), -100, 100) + (anchor === 'middle' ? 50 : anchor === 'end' ? 100 : 0);
    const content = (
      <text>
        <textPath href={`#${pathId}`} startOffset={`${offset}%`} textAnchor={anchor}>{text}</textPath>
      </text>
    );
    return (
      <div className={`rwpb-text-path${node.settings.showPath ? ' rwpb-text-path-visible' : ''}`}>
        <svg viewBox="0 0 250 250" role="img" aria-label={text}>
          <path id={pathId} d={textPaths[type]} fill="none" />
          {link ? <a href={link.href} target={link.target} rel={link.rel}>{content}</a> : content}
        </svg>
      </div>
    );
  },
};

// Google Maps -------------------------------------------------------------------------------------------------------------------------

export const googleMaps: WidgetDefinition = {
  type: 'google-maps',
  label: 'Google Maps',
  icon: 'map',
  category: 'basic',
  keywords: ['map', 'location', 'address', 'directions'],
  defaults: () => ({ settings: { location: 'London Eye, London, United Kingdom', zoom: 14, mapType: 'roadmap', clickToLoad: false }, style: { mapHeight: { size: 350, unit: 'px' } } }),
  controls: [
    { key: 'location', label: 'Location', type: 'text', dynamic: true, placeholder: 'Address, place name or "51.5033,-0.1195"' },
    { key: 'zoom', label: 'Zoom', type: 'slider', min: 1, max: 20 },
    { key: 'mapType', label: 'Map type', type: 'select', options: opts(['roadmap', 'Map'], ['satellite', 'Satellite']) },
    { key: 'clickToLoad', label: 'Load only when clicked', type: 'toggle', help: 'Nothing is requested from Google until the visitor clicks, which helps with privacy rules and page speed.' },
    { key: 'mapHeight', label: 'Height', type: 'size', tab: 'style', responsive: true, units: ['px', 'vh'] },
    { key: 'grayscale', label: 'Greyscale', type: 'toggle', tab: 'style' },
    { key: 'mapRadius', label: 'Corner radius (px)', type: 'slider', tab: 'style', min: 0, max: 40 },
  ],
  css: (bag) => ({
    ' .rwpb-map': { height: size(bag.mapHeight as SizeValue | undefined) || '350px', 'border-radius': length(bag.mapRadius, 'px'), filter: bag.grayscale ? 'grayscale(1)' : undefined },
  }),
  View: function GoogleMapsView({ node }) {
    const { mode } = useRenderContext();
    const location = useResolved(node.settings.location).trim();
    const [loaded, setLoaded] = useState(false);
    if (!location) return <EditorPlaceholder>Enter a location in the Content tab.</EditorPlaceholder>;
    const params = new URLSearchParams({ q: location, t: node.settings.mapType === 'satellite' ? 'k' : 'm', z: String(clamp(Math.round(num(node.settings.zoom, 14)), 1, 20)), ie: 'UTF8', iwloc: '', output: 'embed' });
    const waiting = Boolean(node.settings.clickToLoad) && !loaded;
    return (
      <div className="rwpb-map">
        {waiting ? (
          <button type="button" className="rwpb-map-consent" onClick={() => mode === 'view' && setLoaded(true)}>
            <Icon name="map-pin" size={28} />
            <strong>{location}</strong>
            <span>Show the map (loads Google Maps)</span>
          </button>
        ) : (
          <iframe title={`Map: ${location}`} src={`https://maps.google.com/maps?${params}`} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
        )}
      </div>
    );
  },
};

// Image Carousel ---------------------------------------------------------------------------------------------------------------------

const imageRatioOptions = opts(['', 'Original'], ['1/1', '1:1'], ['4/3', '4:3'], ['3/2', '3:2'], ['16/9', '16:9'], ['3/4', '3:4'], ['9/16', '9:16']);

export const imageCarousel: WidgetDefinition = {
  type: 'image-carousel',
  label: 'Image Carousel',
  icon: 'slides',
  category: 'basic',
  keywords: ['slider', 'logos', 'images', 'gallery'],
  defaults: () => ({ settings: { images: [], linkTo: 'lightbox', arrows: true, dots: true, imageRatio: '4/3', scrollBy: 'one' }, style: { perView: 3, gap: 16 } }),
  controls: [
    { key: 'images', label: 'Images', type: 'gallery' },
    { key: 'linkTo', label: 'On click', type: 'select', options: opts(['lightbox', 'Open in lightbox'], ['none', 'Nothing']) },
    { key: 'imageRatio', label: 'Image ratio', type: 'select', options: imageRatioOptions },
    ...carouselControls(),
    { key: 'imageRadius', label: 'Image corner radius (px)', type: 'slider', tab: 'style', min: 0, max: 40 },
    { key: 'objectFit', label: 'Crop', type: 'select', tab: 'style', options: opts(['cover', 'Fill (crop)'], ['contain', 'Fit (no crop)']) },
  ],
  css: (bag) => ({
    ...carouselCss(bag, 3),
    ' .rwpb-carousel-image img': { 'border-radius': length(bag.imageRadius, 'px'), 'object-fit': isSet(bag.objectFit) ? String(bag.objectFit) : undefined },
  }),
  View: function ImageCarouselView({ node }) {
    const images = listOf<string>(node.settings.images).filter((url) => typeof url === 'string' && url);
    const items = images.map((src) => ({ src }));
    const lightbox = useGalleryLightbox(items);
    if (!images.length) return <EditorPlaceholder>Add images in the Content tab.</EditorPlaceholder>;
    const ratio = str(node.settings.imageRatio);
    const slides = images.map((src, index) => {
      const img = <img src={src} alt="" loading="lazy" style={ratio ? { aspectRatio: ratio } : undefined} />;
      return node.settings.linkTo === 'lightbox'
        ? <button type="button" className="rwpb-carousel-image" aria-label={`Enlarge image ${index + 1}`} onClick={() => lightbox.open(index)}>{img}</button>
        : <div className="rwpb-carousel-image">{img}</div>;
    });
    return (
      <>
        <Carousel slides={slides} options={carouselOptions(node.settings)} label="Image carousel" />
        {lightbox.element}
      </>
    );
  },
};

// Basic Gallery -----------------------------------------------------------------------------------------------------------------------

export const basicGallery: WidgetDefinition = {
  type: 'basic-gallery',
  label: 'Basic Gallery',
  icon: 'grid',
  category: 'basic',
  keywords: ['images', 'photos', 'grid', 'gallery'],
  defaults: () => ({ settings: { images: [], linkTo: 'lightbox', imageRatio: '1/1' }, style: { columns: 4, gap: 10 } }),
  controls: [
    { key: 'images', label: 'Images', type: 'gallery' },
    { key: 'columns', label: 'Columns', type: 'slider', store: 'style', responsive: true, min: 1, max: 10 },
    { key: 'imageRatio', label: 'Image ratio', type: 'select', options: imageRatioOptions },
    { key: 'linkTo', label: 'On click', type: 'select', options: opts(['lightbox', 'Open in lightbox'], ['file', 'Open the image file'], ['none', 'Nothing']) },
    { key: 'gap', label: 'Gap (px)', type: 'slider', tab: 'style', responsive: true, min: 0, max: 60 },
    { key: 'imageRadius', label: 'Corner radius (px)', type: 'slider', tab: 'style', min: 0, max: 40 },
    { key: 'hoverZoom', label: 'Zoom on hover', type: 'toggle', tab: 'style' },
    { key: 'imageBorder', label: 'Image border', type: 'border', tab: 'style' },
  ],
  css: (bag) => ({
    ' .rwpb-gallery-grid': { 'grid-template-columns': `repeat(${clamp(Math.round(num(bag.columns, 4)), 1, 10)}, minmax(0, 1fr))`, gap: length(bag.gap ?? 10, 'px') },
    ' .rwpb-gallery-item': { 'border-radius': length(bag.imageRadius, 'px'), ...border(bag.imageBorder as Border | undefined) },
    ' .rwpb-gallery-item:hover img': { transform: bag.hoverZoom ? 'scale(1.08)' : undefined },
  }),
  View: function BasicGalleryView({ node }) {
    const images = listOf<string>(node.settings.images).filter((url) => typeof url === 'string' && url);
    const lightbox = useGalleryLightbox(images.map((src) => ({ src })));
    if (!images.length) return <EditorPlaceholder>Add images in the Content tab.</EditorPlaceholder>;
    const ratio = str(node.settings.imageRatio);
    return (
      <>
        <div className="rwpb-gallery-grid">
          {images.map((src, index) => {
            const img = <img src={src} alt="" loading="lazy" style={ratio ? { aspectRatio: ratio } : undefined} />;
            if (node.settings.linkTo === 'lightbox') return <button key={`${src}-${index}`} type="button" className="rwpb-gallery-item" aria-label={`Enlarge image ${index + 1}`} onClick={() => lightbox.open(index)}>{img}</button>;
            if (node.settings.linkTo === 'file') return <a key={`${src}-${index}`} className="rwpb-gallery-item" href={safeUrl(src)} target="_blank" rel="noopener noreferrer">{img}</a>;
            return <div key={`${src}-${index}`} className="rwpb-gallery-item">{img}</div>;
          })}
        </div>
        {lightbox.element}
      </>
    );
  },
};
