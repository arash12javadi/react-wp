/** Pro content widgets: animated headline, price list and table, flip box, countdown, blockquote, code, hotspots, TOC, progress tracker, Lottie. */
import { Fragment, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { alignControl, colorControl, headingTags, linkControl, opts, typographyControl } from '../../lib/controls';
import { resolveText } from '../../lib/dynamic';
import { Icon } from '../../lib/icons';
import type { WidgetDefinition } from '../../lib/registry';
import { cssUrl, safeMediaUrl, safeUrl } from '../../lib/sanitize';
import { alignToFlex, border, color, isSet, length, size, typography, type Border, type SizeValue, type Typography } from '../../lib/style';
import { useRenderContext } from '../context';
import { EditableText } from '../NodeView';
import { EditorPlaceholder, useLinkProps, useMediaUrl, useResolved, useText } from './shared';
import { clamp, headingTag, itemId, linkAttributes, listOf, num, pick, prefersReducedMotion, str } from './kit';

const alignCss = (bag: Record<string, unknown>) => ({ 'text-align': isSet(bag.align) ? String(bag.align) : undefined });

// Animated Headline ---------------------------------------------------------------------------------------------

const highlightShapes: Record<string, string[]> = {
  circle: ['M325,18C228.7-8.3,118.5,8.3,78,21C22.4,38.4,4.6,54.6,5.6,77.6c1.4,32.4,52.2,54,142.6,63.7c66.2,7.1,212.2,7.5,273.5-8.3c64.4-16.6,104.3-57.6,33.8-98.2C386.7-4.9,179.4-1.4,126.3,20.7'],
  underline: ['M7.7,145.6C109,125,299.9,116.2,401,121.3c42.1,2.2,87.6,11.8,87.3,25.7'],
  curly: ['M3,146.1c17.1-8.8,33.5-17.8,51.4-17.8c15.6,0,17.1,18.1,30.2,18.1c22.9,0,36-18.6,53.9-18.6c17.1,0,21.3,18.5,37.5,18.5c21.3,0,31.8-18.6,49-18.6c22.1,0,18.8,18.8,36.8,18.8c18.8,0,37.5-18.6,49-18.6c20.4,0,17.1,19,36.8,19c22.9,0,36.8-20.6,54.7-18.6c17.7,1.4,7.1,19.5,33.5,18.8c17.1,0,47.2-6.5,61.1-15.6'],
  zigzag: ['M9.3,127.3c49.3-3,150.7-7.6,199.7-7.4c121.9,0.4,189.9,0.4,282.3,7.2C380.1,129.6,181.2,130.6,70,139c82.6-2.9,254.2-1,335.9,1.3c-56,1.4-137.2-0.3-197.1,9'],
  double: ['M8.4,143.1c14.2-8,97.6-8.8,200.6-9.2c122.3-0.4,287.5,7.2,287.5,7.2', 'M8,19.4c72.3-5.3,162-7.8,216-7.8c54,0,136.2,0,267,7.8'],
  'double-underline': ['M5,125.4c30.5-3.8,137.9-7.6,177.3-7.6c117.2,0,252.2,4.7,312.7,7.6', 'M26.9,143.8c55.1-6.1,126-6.3,162.2-6.1c46.5,0.2,203.9,3.2,268.9,6.4'],
  strikethrough: ['M3,75h493.5'],
  cross: ['M497.4,23.9C301.6,40,155.9,80.6,4,144.4', 'M14.1,27.6c204.5,20.3,393.8,74,467.3,111.7'],
  diagonal: ['M13.5,15.5c131,13.7,289.3,55.5,475,125.5'],
};

export const animatedHeadline: WidgetDefinition = {
  type: 'animated-headline',
  label: 'Animated Headline',
  icon: 'sparkles',
  category: 'pro',
  keywords: ['typing', 'rotating', 'highlight', 'text animation'],
  defaults: () => ({
    settings: { headlineStyle: 'highlight', shape: 'circle', animation: 'typing', before: 'This page is', highlighted: 'Amazing', rotating: 'Better\nBigger\nFaster', after: '', tag: 'h3', loop: true, duration: 2500 },
    style: { align: 'center' },
  }),
  controls: [
    { key: 'headlineStyle', label: 'Style', type: 'select', options: opts(['highlight', 'Highlighted'], ['rotate', 'Rotating']) },
    { key: 'shape', label: 'Shape', type: 'select', options: opts(['circle', 'Circle'], ['curly', 'Curly'], ['underline', 'Underline'], ['double', 'Double'], ['double-underline', 'Double underline'], ['zigzag', 'Underline zigzag'], ['diagonal', 'Diagonal'], ['strikethrough', 'Strikethrough'], ['cross', 'X']), condition: (settings) => settings.headlineStyle !== 'rotate' },
    { key: 'animation', label: 'Animation', type: 'select', options: opts(['typing', 'Typing'], ['clip', 'Clip'], ['flip', 'Flip'], ['slide', 'Slide up'], ['drop', 'Drop in'], ['fade', 'Fade']), condition: (settings) => settings.headlineStyle === 'rotate' },
    { key: 'before', label: 'Before text', type: 'text', dynamic: true },
    { key: 'highlighted', label: 'Highlighted text', type: 'text', dynamic: true, condition: (settings) => settings.headlineStyle !== 'rotate' },
    { key: 'rotating', label: 'Rotating text (one per line)', type: 'textarea', condition: (settings) => settings.headlineStyle === 'rotate' },
    { key: 'after', label: 'After text', type: 'text', dynamic: true },
    linkControl(),
    { key: 'loop', label: 'Infinite loop', type: 'toggle' },
    { key: 'duration', label: 'Duration (ms)', type: 'slider', min: 800, max: 10000, step: 100 },
    { key: 'tag', label: 'HTML tag', type: 'select', options: headingTags },
    alignControl(),
    colorControl('titleColor', 'Headline colour'),
    typographyControl('titleTypography', 'Headline typography'),
    colorControl('wordColor', 'Animated text colour'),
    typographyControl('wordTypography', 'Animated text typography'),
    colorControl('shapeColor', 'Shape colour'),
    { key: 'shapeWidth', label: 'Shape stroke width', type: 'slider', tab: 'style', min: 1, max: 30 },
    { key: 'shapeInFront', label: 'Shape in front of the text', type: 'toggle', tab: 'style' },
  ],
  css: (bag) => ({
    '': alignCss(bag),
    ' .rwpb-headline': { color: color(bag.titleColor), ...typography(bag.titleTypography as Typography | undefined) },
    ' .rwpb-headline-word': { color: color(bag.wordColor), ...typography(bag.wordTypography as Typography | undefined) },
    ' .rwpb-headline-shape path': { stroke: color(bag.shapeColor), 'stroke-width': isSet(bag.shapeWidth) ? num(bag.shapeWidth, 9) : undefined },
    ' .rwpb-headline-shape': { 'z-index': bag.shapeInFront ? 2 : undefined },
  }),
  View: function AnimatedHeadlineView({ node }) {
    const { mode } = useRenderContext();
    const settings = node.settings;
    const before = useText(settings.before);
    const after = useText(settings.after);
    const highlighted = useText(settings.highlighted);
    const link = useLinkProps(settings.link);
    const Tag = headingTag(settings.tag);
    const duration = clamp(num(settings.duration, 2500), 800, 10000);
    const rotate = settings.headlineStyle === 'rotate';
    const words = useMemo(() => str(settings.rotating).split('\n').map((word) => word.trim()).filter(Boolean), [settings.rotating]);
    const animation = pick(settings.animation, ['typing', 'clip', 'flip', 'slide', 'drop', 'fade'] as const, 'typing');
    const animate = mode === 'view' && !prefersReducedMotion();
    const [index, setIndex] = useState(0);
    const [typed, setTyped] = useState<number | null>(null);
    const [cycle, setCycle] = useState(0);

    // Rotating: advance a word every "duration"; typing types, holds, then deletes.
    useEffect(() => {
      if (!animate || !rotate || words.length < 2) return undefined;
      if (animation !== 'typing') {
        const timer = window.setInterval(() => setIndex((current) => {
          if (!settings.loop && current >= words.length - 1) return current;
          return (current + 1) % words.length;
        }), duration);
        return () => window.clearInterval(timer);
      }
      let cancelled = false;
      let timer = 0;
      let wordIndex = 0;
      const run = (count: number, deleting: boolean) => {
        if (cancelled) return;
        const word = words[wordIndex];
        setIndex(wordIndex);
        setTyped(count);
        if (!deleting && count < word.length) { timer = window.setTimeout(() => run(count + 1, false), 80); return; }
        if (!deleting) {
          if (!settings.loop && wordIndex === words.length - 1) return;
          timer = window.setTimeout(() => run(count, true), duration);
          return;
        }
        if (count > 0) { timer = window.setTimeout(() => run(count - 1, true), 40); return; }
        wordIndex = (wordIndex + 1) % words.length;
        timer = window.setTimeout(() => run(0, false), 250);
      };
      run(0, false);
      return () => { cancelled = true; window.clearTimeout(timer); };
    }, [animate, rotate, words, animation, duration, settings.loop]);

    // Highlighted: redraw the shape every cycle while looping.
    useEffect(() => {
      if (!animate || rotate || !settings.loop) return undefined;
      const timer = window.setInterval(() => setCycle((value) => value + 1), duration + 1200);
      return () => window.clearInterval(timer);
    }, [animate, rotate, settings.loop, duration]);

    let dynamicPart: ReactNode;
    if (rotate) {
      const word = words[Math.min(index, Math.max(0, words.length - 1))] || '';
      const shown = animation === 'typing' && animate && typed !== null ? word.slice(0, typed) : word;
      dynamicPart = (
        <span className={`rwpb-headline-dynamic rwpb-headline-${animation}`}>
          {/* The longest word reserves the width, so the line does not jump between words. */}
          <span className="rwpb-headline-sizer" aria-hidden="true">{words.reduce((longest, item) => (item.length > longest.length ? item : longest), '')}</span>
          <span key={animate ? index : 0} className={`rwpb-headline-word${animate ? ' is-animating' : ''}`}>{shown}{animation === 'typing' && animate && <span className="rwpb-headline-caret" aria-hidden="true" />}</span>
        </span>
      );
    } else {
      const shape = highlightShapes[str(settings.shape, 'circle')] || highlightShapes.circle;
      dynamicPart = (
        <span className="rwpb-headline-dynamic rwpb-headline-highlight">
          <span className="rwpb-headline-word">{highlighted}</span>
          <svg key={cycle} className={`rwpb-headline-shape${animate ? ' is-animating' : ''}`} viewBox="0 0 500 150" preserveAspectRatio="none" aria-hidden="true">
            {shape.map((d, pathIndex) => <path key={pathIndex} d={d} pathLength={1} style={{ animationDelay: `${pathIndex * 0.4}s` }} />)}
          </svg>
        </span>
      );
    }
    // Screen readers get the whole sentence once, not every animation frame.
    const plain = [before, rotate ? words.join(', ') : highlighted, after].filter(Boolean).join(' ');
    const content = (
      <>
        <span className="rwpb-sr-only">{plain}</span>
        <span aria-hidden="true">
          {before && <span className="rwpb-headline-plain">{before} </span>}
          {dynamicPart}
          {after && <span className="rwpb-headline-plain"> {after}</span>}
        </span>
      </>
    );
    return <Tag className="rwpb-headline">{link ? <a {...link}>{content}</a> : content}</Tag>;
  },
};

// Price List -------------------------------------------------------------------------------------------------------

interface PriceListItem { id: string; title: string; price: string; description?: string; image?: string; link?: unknown }

export const priceList: WidgetDefinition = {
  type: 'price-list',
  label: 'Price List',
  icon: 'receipt',
  category: 'pro',
  keywords: ['menu', 'pricing', 'restaurant', 'services'],
  defaults: () => ({
    settings: {
      items: [
        { id: itemId(), title: 'First item on the list', price: '$20', description: 'Lorem ipsum dolor sit amet consectetur adipiscing elit.' },
        { id: itemId(), title: 'Second item on the list', price: '$9', description: 'Lorem ipsum dolor sit amet consectetur adipiscing elit.' },
        { id: itemId(), title: 'Third item on the list', price: '$32', description: 'Lorem ipsum dolor sit amet consectetur adipiscing elit.' },
      ],
      separator: 'dotted',
    },
  }),
  controls: [
    { key: 'items', label: 'Items', type: 'repeater', itemLabel: 'title', newItem: () => ({ id: itemId(), title: 'New item', price: '$10' }), fields: [
      { key: 'title', label: 'Title', type: 'text', dynamic: true },
      { key: 'price', label: 'Price', type: 'text', dynamic: true },
      { key: 'description', label: 'Description', type: 'textarea', dynamic: true },
      { key: 'image', label: 'Image', type: 'image' },
      linkControl(),
    ] },
    { key: 'separator', label: 'Separator', type: 'select', options: opts(['dotted', 'Dotted'], ['dashed', 'Dashed'], ['solid', 'Solid'], ['double', 'Double'], ['none', 'None']) },
    { key: 'itemSpacing', label: 'Space between items (px)', type: 'slider', tab: 'style', responsive: true, min: 0, max: 80 },
    { key: 'imageSize', label: 'Image size (px)', type: 'slider', tab: 'style', min: 30, max: 200 },
    colorControl('titleColor', 'Title colour'),
    typographyControl('titleTypography', 'Title typography'),
    colorControl('priceColor', 'Price colour'),
    typographyControl('priceTypography', 'Price typography'),
    colorControl('descriptionColor', 'Description colour'),
    typographyControl('descriptionTypography', 'Description typography'),
    colorControl('separatorColor', 'Separator colour'),
  ],
  css: (bag) => ({
    ' .rwpb-price-list': { gap: length(bag.itemSpacing ?? 22, 'px') },
    ' .rwpb-price-list-image': { width: length(bag.imageSize, 'px'), height: length(bag.imageSize, 'px') },
    ' .rwpb-price-list-title': { color: color(bag.titleColor), ...typography(bag.titleTypography as Typography | undefined) },
    ' .rwpb-price-list-price': { color: color(bag.priceColor), ...typography(bag.priceTypography as Typography | undefined) },
    ' .rwpb-price-list-description': { color: color(bag.descriptionColor), ...typography(bag.descriptionTypography as Typography | undefined) },
    ' .rwpb-price-list-separator': { 'border-bottom-color': color(bag.separatorColor) },
  }),
  View: function PriceListView({ node }) {
    const { dynamic, mode } = useRenderContext();
    const items = listOf<PriceListItem>(node.settings.items);
    const text = (value: unknown) => (mode === 'edit' ? str(value) : resolveText(value, dynamic));
    const separator = pick(node.settings.separator, ['dotted', 'dashed', 'solid', 'double', 'none'] as const, 'dotted');
    if (!items.length) return <EditorPlaceholder>Add items in the Content tab.</EditorPlaceholder>;
    return (
      <ul className="rwpb-price-list">
        {items.map((item, index) => {
          const link = linkAttributes(item.link, dynamic);
          const image = safeMediaUrl(item.image);
          const body = (
            <>
              {image && <img className="rwpb-price-list-image" src={image} alt="" loading="lazy" />}
              <span className="rwpb-price-list-text">
                <span className="rwpb-price-list-header">
                  <span className="rwpb-price-list-title">{text(item.title)}</span>
                  {separator !== 'none' && <span className={`rwpb-price-list-separator rwpb-sep-${separator}`} aria-hidden="true" />}
                  <span className="rwpb-price-list-price">{text(item.price)}</span>
                </span>
                {item.description && <span className="rwpb-price-list-description">{text(item.description)}</span>}
              </span>
            </>
          );
          return <li key={item.id || index}>{link ? <a className="rwpb-price-list-item" {...link}>{body}</a> : <div className="rwpb-price-list-item">{body}</div>}</li>;
        })}
      </ul>
    );
  },
};

// Price Table ----------------------------------------------------------------------------------------------------------

interface Feature { id: string; text: string; icon?: string; excluded?: boolean }

export const priceTable: WidgetDefinition = {
  type: 'price-table',
  label: 'Price Table',
  icon: 'circle-dollar',
  category: 'pro',
  keywords: ['pricing', 'plan', 'subscription'],
  defaults: () => ({
    settings: {
      heading: 'Enter your title', subHeading: 'Enter your description', headingTag: 'h3', currency: '$', price: '39.99', originalPrice: '', period: 'Monthly', fractionSuper: true,
      features: [
        { id: itemId(), text: 'List item', icon: 'check' },
        { id: itemId(), text: 'List item', icon: 'check' },
        { id: itemId(), text: 'Not included', icon: 'x', excluded: true },
      ],
      buttonText: 'Click here', link: { url: '#' }, footer: 'This is text element', ribbon: '', ribbonSide: 'right',
    },
  }),
  controls: [
    { key: '_header', label: 'Header', type: 'heading' },
    { key: 'heading', label: 'Title', type: 'text', dynamic: true },
    { key: 'subHeading', label: 'Description', type: 'text', dynamic: true },
    { key: 'headingTag', label: 'Title HTML tag', type: 'select', options: headingTags },
    { key: '_pricing', label: 'Pricing', type: 'heading' },
    { key: 'currency', label: 'Currency symbol', type: 'text' },
    { key: 'price', label: 'Price', type: 'text', dynamic: true },
    { key: 'fractionSuper', label: 'Raise the cents', type: 'toggle' },
    { key: 'originalPrice', label: 'Original price (shown struck through)', type: 'text' },
    { key: 'period', label: 'Period', type: 'text' },
    { key: '_features', label: 'Features', type: 'heading' },
    { key: 'features', label: 'Features', type: 'repeater', itemLabel: 'text', newItem: () => ({ id: itemId(), text: 'List item', icon: 'check' }), fields: [
      { key: 'text', label: 'Text', type: 'text', dynamic: true },
      { key: 'icon', label: 'Icon', type: 'icon' },
      { key: 'excluded', label: 'Not included (dimmed)', type: 'toggle' },
    ] },
    { key: '_footer', label: 'Footer', type: 'heading' },
    { key: 'buttonText', label: 'Button text', type: 'text', dynamic: true },
    linkControl(),
    { key: 'footer', label: 'Additional info', type: 'text', dynamic: true },
    { key: 'ribbon', label: 'Ribbon text', type: 'text', help: 'Leave empty to hide the ribbon.' },
    { key: 'ribbonSide', label: 'Ribbon side', type: 'select', options: opts(['right', 'Right'], ['left', 'Left']) },
    colorControl('headerBg', 'Header background'),
    colorControl('headingColor', 'Title colour'),
    typographyControl('headingTypography', 'Title typography'),
    colorControl('priceColor', 'Price colour'),
    typographyControl('priceTypography', 'Price typography'),
    colorControl('featureColor', 'Features colour'),
    colorControl('featureIconColor', 'Feature icon colour'),
    { key: 'featureAlign', label: 'Features alignment', type: 'align', tab: 'style', options: opts(['left', 'Left'], ['center', 'Center'], ['right', 'Right']) },
    colorControl('buttonText', 'Button text colour'),
    colorControl('buttonBg', 'Button background'),
    colorControl('ribbonBg', 'Ribbon background'),
  ],
  css: (bag) => ({
    ' .rwpb-price-table-header': { 'background-color': color(bag.headerBg) },
    ' .rwpb-price-table-heading': { color: color(bag.headingColor), ...typography(bag.headingTypography as Typography | undefined) },
    ' .rwpb-price-table-price': { color: color(bag.priceColor), ...typography(bag.priceTypography as Typography | undefined) },
    ' .rwpb-price-table-features': { color: color(bag.featureColor), 'text-align': isSet(bag.featureAlign) ? String(bag.featureAlign) : undefined },
    ' .rwpb-price-table-features li': { 'justify-content': alignToFlex(bag.featureAlign) },
    ' .rwpb-price-table-features svg': { color: color(bag.featureIconColor) },
    ' .rwpb-price-table .rwpb-button': { color: color(bag.buttonText), 'background-color': color(bag.buttonBg) },
    ' .rwpb-price-table-ribbon': { 'background-color': color(bag.ribbonBg) },
  }),
  View: function PriceTableView({ node }) {
    const { dynamic, mode } = useRenderContext();
    const settings = node.settings;
    const heading = useText(settings.heading);
    const subHeading = useText(settings.subHeading);
    const price = useText(settings.price);
    const buttonText = useText(settings.buttonText);
    const footer = useText(settings.footer);
    const link = useLinkProps(settings.link);
    const Tag = headingTag(settings.headingTag);
    const features = listOf<Feature>(settings.features);
    const [whole, fraction] = price.split(/[.,](?=\d+$)/);
    return (
      <div className="rwpb-price-table">
        {str(settings.ribbon) && <span className={`rwpb-price-table-ribbon rwpb-ribbon-${settings.ribbonSide === 'left' ? 'left' : 'right'}`}>{str(settings.ribbon)}</span>}
        <div className="rwpb-price-table-header">
          {heading && <Tag className="rwpb-price-table-heading">{heading}</Tag>}
          {subHeading && <p className="rwpb-price-table-subheading">{subHeading}</p>}
        </div>
        <div className="rwpb-price-table-pricing">
          {str(settings.originalPrice) && <del className="rwpb-price-table-original">{str(settings.currency)}{str(settings.originalPrice)}</del>}
          <span className="rwpb-price-table-price">
            <span className="rwpb-price-table-currency">{str(settings.currency)}</span>
            <span className="rwpb-price-table-whole">{whole}</span>
            {fraction && (settings.fractionSuper ? <sup className="rwpb-price-table-fraction">{fraction}</sup> : <span>.{fraction}</span>)}
          </span>
          {str(settings.period) && <span className="rwpb-price-table-period">{str(settings.period)}</span>}
        </div>
        {features.length > 0 && (
          <ul className="rwpb-price-table-features">
            {features.map((feature, index) => (
              <li key={feature.id || index} className={feature.excluded ? 'is-excluded' : undefined}>
                {feature.icon && <Icon name={feature.icon} size="1em" />}
                <span>{mode === 'edit' ? feature.text : resolveText(feature.text, dynamic)}</span>
                {feature.excluded && <span className="rwpb-sr-only"> (not included)</span>}
              </li>
            ))}
          </ul>
        )}
        <div className="rwpb-price-table-footer">
          {buttonText && (link ? <a className="rwpb-button rwpb-button-md" {...link}>{buttonText}</a> : <span className="rwpb-button rwpb-button-md">{buttonText}</span>)}
          {footer && <p className="rwpb-price-table-info">{footer}</p>}
        </div>
      </div>
    );
  },
};

// Flip Box -------------------------------------------------------------------------------------------------------------------

export const flipBox: WidgetDefinition = {
  type: 'flip-box',
  label: 'Flip Box',
  icon: 'flip-box',
  category: 'pro',
  keywords: ['hover', 'card', 'flip', '3d'],
  defaults: () => ({
    settings: {
      frontIcon: 'star', frontTitle: 'This is the heading', frontDescription: 'Lorem ipsum dolor sit amet consectetur adipiscing elit dolor',
      backTitle: 'This is the heading', backDescription: 'Lorem ipsum dolor sit amet consectetur adipiscing elit dolor', buttonText: 'Click here', link: { url: '#' },
      effect: 'flip', direction: 'up',
    },
    style: { boxHeight: { size: 280, unit: 'px' }, frontBg: 'global:primary', backBg: 'global:secondary' },
  }),
  controls: [
    { key: '_front', label: 'Front', type: 'heading' },
    { key: 'frontImage', label: 'Background image', type: 'image', dynamic: true },
    { key: 'frontIcon', label: 'Icon', type: 'icon' },
    { key: 'frontTitle', label: 'Title', type: 'text', dynamic: true },
    { key: 'frontDescription', label: 'Description', type: 'textarea', dynamic: true },
    { key: '_back', label: 'Back', type: 'heading' },
    { key: 'backImage', label: 'Background image', type: 'image', dynamic: true },
    { key: 'backTitle', label: 'Title', type: 'text', dynamic: true },
    { key: 'backDescription', label: 'Description', type: 'textarea', dynamic: true },
    { key: 'buttonText', label: 'Button text', type: 'text', dynamic: true },
    linkControl(),
    { key: '_settings', label: 'Settings', type: 'heading' },
    { key: 'effect', label: 'Flip effect', type: 'select', options: opts(['flip', 'Flip'], ['slide', 'Slide'], ['push', 'Push'], ['zoom', 'Zoom in'], ['fade', 'Fade']) },
    { key: 'direction', label: 'Direction', type: 'select', options: opts(['up', 'Up'], ['down', 'Down'], ['left', 'Left'], ['right', 'Right']), condition: (settings) => ['flip', 'slide', 'push'].includes(String(settings.effect || 'flip')) },
    { key: 'boxHeight', label: 'Height', type: 'size', tab: 'style', responsive: true, units: ['px', 'vh'] },
    { key: 'boxRadius', label: 'Corner radius (px)', type: 'slider', tab: 'style', min: 0, max: 60 },
    alignControl(),
    colorControl('frontBg', 'Front background'),
    colorControl('frontOverlay', 'Front image overlay'),
    colorControl('frontColor', 'Front text colour'),
    typographyControl('frontTitleTypography', 'Front title typography'),
    { key: 'iconSize', label: 'Front icon size (px)', type: 'slider', tab: 'style', min: 12, max: 120 },
    colorControl('backBg', 'Back background'),
    colorControl('backOverlay', 'Back image overlay'),
    colorControl('backColor', 'Back text colour'),
    typographyControl('backTitleTypography', 'Back title typography'),
    colorControl('buttonText', 'Button text colour'),
    colorControl('buttonBg', 'Button background'),
  ],
  css: (bag) => ({
    ' .rwpb-flip-box': { height: size(bag.boxHeight as SizeValue | undefined) || '280px', '--rwpb-flip-radius': length(bag.boxRadius, 'px') },
    ' .rwpb-flip-face': { ...alignCss(bag), 'align-items': alignToFlex(bag.align) },
    ' .rwpb-flip-front': { 'background-color': color(bag.frontBg), color: color(bag.frontColor) },
    ' .rwpb-flip-front::before': { 'background-color': color(bag.frontOverlay) },
    ' .rwpb-flip-front .rwpb-flip-title': typography(bag.frontTitleTypography as Typography | undefined),
    ' .rwpb-flip-front svg': { 'font-size': length(bag.iconSize, 'px') },
    ' .rwpb-flip-back': { 'background-color': color(bag.backBg), color: color(bag.backColor) },
    ' .rwpb-flip-back::before': { 'background-color': color(bag.backOverlay) },
    ' .rwpb-flip-back .rwpb-flip-title': typography(bag.backTitleTypography as Typography | undefined),
    ' .rwpb-flip-box .rwpb-button': { color: color(bag.buttonText), 'background-color': color(bag.buttonBg) },
  }),
  View: function FlipBoxView({ node }) {
    const settings = node.settings;
    const frontImage = cssUrl(useMediaUrl(settings.frontImage));
    const backImage = cssUrl(useMediaUrl(settings.backImage));
    const buttonText = useText(settings.buttonText);
    const link = useLinkProps(settings.link);
    const [flipped, setFlipped] = useState(false);
    const effect = pick(settings.effect, ['flip', 'slide', 'push', 'zoom', 'fade'] as const, 'flip');
    const direction = pick(settings.direction, ['up', 'down', 'left', 'right'] as const, 'up');
    return (
      // Hover and keyboard focus flip it; a tap toggles it on touch screens, which have no hover.
      <div className={`rwpb-flip-box rwpb-flip-${effect} rwpb-flip-${direction}${flipped ? ' is-flipped' : ''}`}
        onClick={(event) => { if (!(event.target as HTMLElement).closest('a')) setFlipped((value) => !value); }}>
        <div className="rwpb-flip-inner">
          <div className="rwpb-flip-face rwpb-flip-front" style={frontImage ? { backgroundImage: frontImage } : undefined}>
            <div className="rwpb-flip-content">
              {str(settings.frontIcon) && <Icon name={str(settings.frontIcon)} size="1em" />}
              <EditableText nodeId={node.id} field="frontTitle" value={str(settings.frontTitle)} as="h3" className="rwpb-flip-title" />
              <EditableText nodeId={node.id} field="frontDescription" value={str(settings.frontDescription)} as="p" className="rwpb-flip-text" multiline />
            </div>
          </div>
          <div className="rwpb-flip-face rwpb-flip-back" style={backImage ? { backgroundImage: backImage } : undefined}>
            <div className="rwpb-flip-content">
              <EditableText nodeId={node.id} field="backTitle" value={str(settings.backTitle)} as="h3" className="rwpb-flip-title" />
              <EditableText nodeId={node.id} field="backDescription" value={str(settings.backDescription)} as="p" className="rwpb-flip-text" multiline />
              {buttonText && (link ? <a className="rwpb-button rwpb-button-sm" {...link}>{buttonText}</a> : <span className="rwpb-button rwpb-button-sm">{buttonText}</span>)}
            </div>
          </div>
        </div>
      </div>
    );
  },
};

// Countdown ------------------------------------------------------------------------------------------------------------------

const evergreenKey = (id: string) => `rwpb-countdown-${id}`;

export const countdown: WidgetDefinition = {
  type: 'countdown',
  label: 'Countdown',
  icon: 'hourglass',
  category: 'pro',
  keywords: ['timer', 'launch', 'sale', 'deadline'],
  defaults: () => {
    const due = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    due.setMinutes(0, 0, 0);
    const local = new Date(due.getTime() - due.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    return {
      settings: { countdownType: 'due', dueDate: local, evergreenHours: 47, evergreenMinutes: 59, showDays: true, showHours: true, showMinutes: true, showSeconds: true, showLabels: true, labelDays: 'Days', labelHours: 'Hours', labelMinutes: 'Minutes', labelSeconds: 'Seconds', expireAction: 'message', expireMessage: 'This offer has ended.' },
    };
  },
  controls: [
    { key: 'countdownType', label: 'Type', type: 'select', options: opts(['due', 'Due date'], ['evergreen', 'Evergreen timer (per visitor)']) },
    { key: 'dueDate', label: 'Due date', type: 'text', placeholder: '2026-12-31T23:59', help: "Format YYYY-MM-DDTHH:MM, in the visitor's time zone. Add a zone to fix it, e.g. 2026-12-31T23:59+01:00.", condition: (settings) => settings.countdownType !== 'evergreen' },
    { key: 'evergreenHours', label: 'Hours', type: 'number', min: 0, condition: (settings) => settings.countdownType === 'evergreen' },
    { key: 'evergreenMinutes', label: 'Minutes', type: 'number', min: 0, max: 59, condition: (settings) => settings.countdownType === 'evergreen' },
    { key: 'showDays', label: 'Days', type: 'toggle' },
    { key: 'showHours', label: 'Hours', type: 'toggle' },
    { key: 'showMinutes', label: 'Minutes', type: 'toggle' },
    { key: 'showSeconds', label: 'Seconds', type: 'toggle' },
    { key: 'showLabels', label: 'Show labels', type: 'toggle' },
    { key: 'labelDays', label: 'Days label', type: 'text', condition: (settings) => Boolean(settings.showLabels) },
    { key: 'labelHours', label: 'Hours label', type: 'text', condition: (settings) => Boolean(settings.showLabels) },
    { key: 'labelMinutes', label: 'Minutes label', type: 'text', condition: (settings) => Boolean(settings.showLabels) },
    { key: 'labelSeconds', label: 'Seconds label', type: 'text', condition: (settings) => Boolean(settings.showLabels) },
    { key: 'expireAction', label: 'When it ends', type: 'select', options: opts(['none', 'Keep showing zeros'], ['hide', 'Hide the countdown'], ['message', 'Show a message'], ['redirect', 'Redirect']) },
    { key: 'expireMessage', label: 'Message', type: 'textarea', condition: (settings) => settings.expireAction === 'message' },
    { key: 'redirectUrl', label: 'Redirect to', type: 'text', placeholder: '/offer-ended', condition: (settings) => settings.expireAction === 'redirect' },
    { key: 'boxGap', label: 'Space between boxes (px)', type: 'slider', tab: 'style', responsive: true, min: 0, max: 60 },
    colorControl('boxBg', 'Box background'),
    { key: 'boxBorder', label: 'Box border', type: 'border', tab: 'style' },
    colorControl('digitColor', 'Digits colour'),
    typographyControl('digitTypography', 'Digits typography'),
    colorControl('labelColor', 'Label colour'),
    typographyControl('labelTypography', 'Label typography'),
    colorControl('messageColor', 'Message colour'),
  ],
  css: (bag) => ({
    ' .rwpb-countdown': { gap: length(bag.boxGap ?? 12, 'px') },
    ' .rwpb-countdown-box': { 'background-color': color(bag.boxBg), ...border(bag.boxBorder as Border | undefined) },
    ' .rwpb-countdown-digits': { color: color(bag.digitColor), ...typography(bag.digitTypography as Typography | undefined) },
    ' .rwpb-countdown-label': { color: color(bag.labelColor), ...typography(bag.labelTypography as Typography | undefined) },
    ' .rwpb-countdown-message': { color: color(bag.messageColor) },
  }),
  View: function CountdownView({ node }) {
    const { mode } = useRenderContext();
    const settings = node.settings;
    const [now, setNow] = useState(() => Date.now());
    const [target, setTarget] = useState<number | null>(null);

    useEffect(() => {
      if (settings.countdownType !== 'evergreen') {
        const parsed = Date.parse(str(settings.dueDate));
        setTarget(Number.isNaN(parsed) ? null : parsed);
        return;
      }
      const span = (num(settings.evergreenHours, 0) * 60 + num(settings.evergreenMinutes, 0)) * 60000;
      if (mode === 'edit') { setTarget(Date.now() + span); return; }
      // Each visitor's timer starts on their first visit and survives reloads.
      let started = Date.now();
      try {
        const stored = Number(localStorage.getItem(evergreenKey(node.id)));
        if (stored > 0) started = stored; else localStorage.setItem(evergreenKey(node.id), String(started));
      } catch { /* Storage blocked: the timer restarts on each visit. */ }
      setTarget(started + span);
    }, [mode, node.id, settings.countdownType, settings.dueDate, settings.evergreenHours, settings.evergreenMinutes]);

    useEffect(() => {
      const timer = window.setInterval(() => setNow(Date.now()), 1000);
      return () => window.clearInterval(timer);
    }, []);

    const remaining = target === null ? 0 : Math.max(0, target - now);
    const expired = target !== null && remaining === 0;

    useEffect(() => {
      if (mode !== 'view' || !expired || settings.expireAction !== 'redirect') return;
      const url = safeUrl(settings.redirectUrl);
      if (url && url !== '#') window.location.href = url;
    }, [mode, expired, settings.expireAction, settings.redirectUrl]);

    if (target === null) return <EditorPlaceholder>Enter a valid due date, e.g. 2026-12-31T23:59.</EditorPlaceholder>;
    if (expired && mode === 'view') {
      if (settings.expireAction === 'hide' || settings.expireAction === 'redirect') return null;
      if (settings.expireAction === 'message') return <p className="rwpb-countdown-message" role="status">{str(settings.expireMessage)}</p>;
    }
    let seconds = Math.floor(remaining / 1000);
    const units: Array<{ key: string; show: boolean; label: string; value: number }> = [];
    const take = (show: boolean, per: number) => {
      if (!show) return 0;
      const value = Math.floor(seconds / per);
      seconds -= value * per;
      return value;
    };
    // Hidden larger units fold into the next shown unit (e.g. no days → 50 hours).
    const days = take(settings.showDays !== false, 86400);
    const hours = take(settings.showHours !== false, 3600);
    const minutes = take(settings.showMinutes !== false, 60);
    const secs = take(settings.showSeconds !== false, 1);
    units.push(
      { key: 'days', show: settings.showDays !== false, label: str(settings.labelDays, 'Days'), value: days },
      { key: 'hours', show: settings.showHours !== false, label: str(settings.labelHours, 'Hours'), value: hours },
      { key: 'minutes', show: settings.showMinutes !== false, label: str(settings.labelMinutes, 'Minutes'), value: minutes },
      { key: 'seconds', show: settings.showSeconds !== false, label: str(settings.labelSeconds, 'Seconds'), value: secs },
    );
    const shown = units.filter((unit) => unit.show);
    return (
      <div className="rwpb-countdown" role="timer" aria-live="off" aria-label={shown.map((unit) => `${unit.value} ${unit.label}`).join(', ')}>
        {shown.map((unit) => (
          <div key={unit.key} className={`rwpb-countdown-box rwpb-countdown-${unit.key}`} aria-hidden="true">
            <span className="rwpb-countdown-digits">{String(unit.value).padStart(2, '0')}</span>
            {Boolean(settings.showLabels) && <span className="rwpb-countdown-label">{unit.label}</span>}
          </div>
        ))}
      </div>
    );
  },
};

// Blockquote -----------------------------------------------------------------------------------------------------------------

export const blockquote: WidgetDefinition = {
  type: 'blockquote',
  label: 'Blockquote',
  icon: 'text-quote',
  category: 'pro',
  keywords: ['quote', 'citation', 'tweet'],
  defaults: () => ({ settings: { quote: 'Lorem ipsum dolor sit amet consectetur adipiscing elit dolor, tempor incididunt ut labore et dolore magna aliqua.', author: 'John Doe', skin: 'border', tweet: true, tweetLabel: 'Tweet' } }),
  controls: [
    { key: 'skin', label: 'Skin', type: 'select', options: opts(['border', 'Border'], ['quotation', 'Quotation'], ['boxed', 'Boxed'], ['clean', 'Clean']) },
    { key: 'quote', label: 'Content', type: 'textarea', dynamic: true },
    { key: 'author', label: 'Author', type: 'text', dynamic: true },
    { key: 'tweet', label: 'Share on X button', type: 'toggle' },
    { key: 'tweetLabel', label: 'Button label', type: 'text', condition: (settings) => Boolean(settings.tweet) },
    { key: 'via', label: 'Via @username', type: 'text', placeholder: 'yourbrand', condition: (settings) => Boolean(settings.tweet) },
    alignControl(),
    colorControl('quoteColor', 'Content colour'),
    typographyControl('quoteTypography', 'Content typography'),
    colorControl('authorColor', 'Author colour'),
    colorControl('accentColor', 'Border / quote mark colour'),
    colorControl('boxBg', 'Box background'),
  ],
  css: (bag) => ({
    ' .rwpb-blockquote': { ...alignCss(bag), '--rwpb-quote-accent': color(bag.accentColor), 'background-color': color(bag.boxBg) },
    ' .rwpb-blockquote-content': { color: color(bag.quoteColor), ...typography(bag.quoteTypography as Typography | undefined) },
    ' .rwpb-blockquote-author': { color: color(bag.authorColor) },
  }),
  View: function BlockquoteView({ node }) {
    const quote = useText(node.settings.quote);
    const author = useText(node.settings.author);
    const skin = pick(node.settings.skin, ['border', 'quotation', 'boxed', 'clean'] as const, 'border');
    const pageUrl = typeof window === 'undefined' ? '' : window.location.href;
    const via = str(node.settings.via).replace(/^@/, '').replace(/[^\w]/g, '');
    const intent = `https://twitter.com/intent/tweet?${new URLSearchParams({ text: `“${quote}”${author ? ` — ${author}` : ''}`, url: pageUrl, ...(via ? { via } : {}) })}`;
    return (
      <blockquote className={`rwpb-blockquote rwpb-blockquote-${skin}`}>
        <EditableText nodeId={node.id} field="quote" value={str(node.settings.quote)} as="p" className="rwpb-blockquote-content" multiline />
        <footer className="rwpb-blockquote-footer">
          {author && <cite className="rwpb-blockquote-author">{author}</cite>}
          {Boolean(node.settings.tweet) && (
            <a className="rwpb-blockquote-tweet" href={intent} target="_blank" rel="noopener noreferrer"><Icon name="x" size="1em" /> {str(node.settings.tweetLabel, 'Tweet')}</a>
          )}
        </footer>
      </blockquote>
    );
  },
};

// Code Highlight ----------------------------------------------------------------------------------------------------------------

type TokenRule = [type: string, pattern: string];

const jsKeywords = 'abstract|as|async|await|break|case|catch|class|const|continue|debugger|default|delete|do|else|enum|export|extends|false|finally|for|from|function|get|if|implements|import|in|instanceof|interface|let|new|null|of|private|protected|public|readonly|return|set|static|super|switch|this|throw|true|try|type|typeof|undefined|var|void|while|with|yield';

const languageRules: Record<string, { rules: TokenRule[]; flags?: string }> = {
  javascript: { rules: [['comment', '\\/\\/.*|\\/\\*[\\s\\S]*?\\*\\/'], ['string', '`(?:\\\\[\\s\\S]|[^`\\\\])*`|\'(?:\\\\.|[^\'\\\\\\n])*\'|"(?:\\\\.|[^"\\\\\\n])*"'], ['keyword', `\\b(?:${jsKeywords})\\b`], ['number', '\\b\\d+(?:\\.\\d+)?\\b'], ['function', '\\b[A-Za-z_$][\\w$]*(?=\\s*\\()'], ['punctuation', '[{}()[\\];,.]|=>']] },
  python: { rules: [['comment', '#.*'], ['string', '"""[\\s\\S]*?"""|\'\'\'[\\s\\S]*?\'\'\'|\'(?:\\\\.|[^\'\\\\\\n])*\'|"(?:\\\\.|[^"\\\\\\n])*"'], ['keyword', '\\b(?:and|as|assert|async|await|break|class|continue|def|del|elif|else|except|False|finally|for|from|global|if|import|in|is|lambda|None|nonlocal|not|or|pass|raise|return|self|True|try|while|with|yield)\\b'], ['number', '\\b\\d+(?:\\.\\d+)?\\b'], ['function', '\\b[A-Za-z_]\\w*(?=\\s*\\()']] },
  php: { rules: [['comment', '\\/\\/.*|#.*|\\/\\*[\\s\\S]*?\\*\\/'], ['string', '\'(?:\\\\.|[^\'\\\\])*\'|"(?:\\\\.|[^"\\\\])*"'], ['variable', '\\$[A-Za-z_]\\w*'], ['keyword', '\\b(?:array|as|break|case|catch|class|const|continue|default|do|echo|else|elseif|extends|false|finally|fn|for|foreach|function|if|implements|include|interface|namespace|new|null|private|protected|public|require|require_once|return|static|switch|throw|true|try|use|while)\\b'], ['number', '\\b\\d+(?:\\.\\d+)?\\b'], ['function', '\\b[A-Za-z_]\\w*(?=\\s*\\()'], ['tag', '<\\?php|\\?>']] },
  css: { rules: [['comment', '\\/\\*[\\s\\S]*?\\*\\/'], ['string', '\'(?:\\\\.|[^\'\\\\])*\'|"(?:\\\\.|[^"\\\\])*"'], ['keyword', '@[\\w-]+|!important'], ['property', '[\\w-]+(?=\\s*:(?!:))'], ['number', '#[0-9a-fA-F]{3,8}\\b|-?\\d*\\.?\\d+(?:px|em|rem|%|vh|vw|s|ms|deg|fr)?\\b'], ['function', '[\\w-]+(?=\\()'], ['selector', '[.#][\\w-]+|::?[\\w-]+']] },
  html: { rules: [['comment', '<!--[\\s\\S]*?-->'], ['tag', '<\\/?[A-Za-z][\\w:-]*|\\/?>'], ['property', '\\s[A-Za-z_:][\\w:.-]*(?==)'], ['string', '"[^"]*"|\'[^\']*\'']] },
  sql: { flags: 'i', rules: [['comment', '--.*|\\/\\*[\\s\\S]*?\\*\\/'], ['string', '\'(?:\'\'|[^\'])*\''], ['keyword', '\\b(?:add|all|alter|and|as|asc|begin|between|by|case|check|column|commit|constraint|create|cross|database|default|delete|desc|distinct|drop|else|end|exists|foreign|from|full|function|grant|group|having|if|in|index|inner|insert|into|is|join|key|left|like|limit|not|null|offset|on|or|order|outer|primary|references|returns|revoke|right|select|set|table|then|union|unique|update|using|values|view|when|where|with)\\b'], ['number', '\\b\\d+(?:\\.\\d+)?\\b'], ['function', '\\b[A-Za-z_]\\w*(?=\\s*\\()']] },
  bash: { rules: [['comment', '#.*'], ['string', '"(?:\\\\.|[^"\\\\])*"|\'[^\']*\''], ['variable', '\\$\\{[^}]+\\}|\\$[A-Za-z_]\\w*'], ['keyword', '\\b(?:case|do|done|echo|elif|else|esac|exit|export|fi|for|function|if|in|local|return|then|until|while|sudo|cd|npm|npx|git)\\b'], ['number', '\\b\\d+\\b']] },
  json: { rules: [['property', '"(?:\\\\.|[^"\\\\])*"(?=\\s*:)'], ['string', '"(?:\\\\.|[^"\\\\])*"'], ['keyword', '\\b(?:true|false|null)\\b'], ['number', '-?\\b\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b']] },
};
languageRules.typescript = languageRules.javascript;
languageRules.jsx = languageRules.javascript;
languageRules.scss = languageRules.css;
languageRules.xml = languageRules.html;

const languageLabels = opts(['javascript', 'JavaScript'], ['typescript', 'TypeScript'], ['jsx', 'JSX'], ['html', 'HTML'], ['css', 'CSS'], ['scss', 'SCSS'], ['php', 'PHP'], ['python', 'Python'], ['sql', 'SQL'], ['bash', 'Bash / shell'], ['json', 'JSON'], ['xml', 'XML'], ['plain', 'Plain text']);

/** A small regex tokenizer: enough colour to read code, with no library and no HTML injection. */
function tokenize(code: string, language: string): Array<{ type: string; text: string }> {
  const definition = languageRules[language];
  if (!definition) return [{ type: '', text: code }];
  const pattern = new RegExp(definition.rules.map(([, source]) => `(${source})`).join('|'), `g${definition.flags || ''}`);
  const tokens: Array<{ type: string; text: string }> = [];
  let cursor = 0;
  for (const match of code.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (!match[0]) continue;
    if (index > cursor) tokens.push({ type: '', text: code.slice(cursor, index) });
    const group = match.slice(1).findIndex((value) => value !== undefined);
    tokens.push({ type: definition.rules[group]?.[0] || '', text: match[0] });
    cursor = index + match[0].length;
  }
  if (cursor < code.length) tokens.push({ type: '', text: code.slice(cursor) });
  return tokens;
}

const parseLineList = (value: string): Set<number> => {
  const lines = new Set<number>();
  value.split(',').forEach((part) => {
    const [from, to] = part.split('-').map((item) => Number(item.trim()));
    if (Number.isInteger(from) && from > 0) {
      const end = Number.isInteger(to) && to >= from ? Math.min(to, from + 2000) : from;
      for (let line = from; line <= end; line += 1) lines.add(line);
    }
  });
  return lines;
};

export const codeHighlight: WidgetDefinition = {
  type: 'code-highlight',
  label: 'Code Highlight',
  icon: 'file-code',
  category: 'pro',
  keywords: ['code', 'snippet', 'syntax', 'pre'],
  defaults: () => ({ settings: { language: 'javascript', code: "function greet(name) {\n  // Say hello\n  return `Hello, ${name}!`;\n}\n\nconsole.log(greet('world'));", lineNumbers: true, copyButton: true, theme: 'dark', wordWrap: false, highlightLines: '' } }),
  controls: [
    { key: 'language', label: 'Language', type: 'select', options: languageLabels },
    { key: 'code', label: 'Code', type: 'code', language: 'js' },
    { key: 'theme', label: 'Theme', type: 'select', options: opts(['dark', 'Dark'], ['light', 'Light']) },
    { key: 'lineNumbers', label: 'Line numbers', type: 'toggle' },
    { key: 'copyButton', label: 'Copy to clipboard button', type: 'toggle' },
    { key: 'highlightLines', label: 'Highlight lines', type: 'text', placeholder: '1, 3-5' },
    { key: 'wordWrap', label: 'Word wrap', type: 'toggle' },
    { key: 'maxHeight', label: 'Maximum height', type: 'size', tab: 'style', responsive: true, units: ['px', 'vh'] },
    { key: 'fontSize', label: 'Font size (px)', type: 'slider', tab: 'style', responsive: true, min: 10, max: 24 },
    { key: 'codeRadius', label: 'Corner radius (px)', type: 'slider', tab: 'style', min: 0, max: 24 },
  ],
  css: (bag) => ({
    ' .rwpb-code': { 'border-radius': length(bag.codeRadius, 'px'), 'font-size': length(bag.fontSize, 'px') },
    ' .rwpb-code pre': { 'max-height': size(bag.maxHeight as SizeValue | undefined) },
  }),
  View: function CodeHighlightView({ node }) {
    const settings = node.settings;
    const code = str(settings.code).replace(/\s+$/, '');
    const language = str(settings.language, 'javascript');
    const lines = useMemo(() => {
      const result: Array<Array<{ type: string; text: string }>> = [[]];
      tokenize(code, language).forEach((token) => {
        token.text.split('\n').forEach((part, index) => {
          if (index > 0) result.push([]);
          if (part) result[result.length - 1].push({ type: token.type, text: part });
        });
      });
      return result;
    }, [code, language]);
    const highlighted = useMemo(() => parseLineList(str(settings.highlightLines)), [settings.highlightLines]);
    const [copied, setCopied] = useState(false);
    if (!code) return <EditorPlaceholder>Paste code in the Content tab.</EditorPlaceholder>;
    const copy = async () => {
      try {
        await navigator.clipboard.writeText(code);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1800);
      } catch { setCopied(false); }
    };
    return (
      <div className={`rwpb-code rwpb-code-${settings.theme === 'light' ? 'light' : 'dark'}${settings.wordWrap ? ' rwpb-code-wrap' : ''}${settings.lineNumbers ? ' rwpb-code-numbered' : ''}`}>
        <div className="rwpb-code-bar">
          <span className="rwpb-code-language">{languageLabels.find((option) => option.value === language)?.label || language}</span>
          {Boolean(settings.copyButton) && <button type="button" className="rwpb-code-copy" onClick={copy} aria-live="polite">{copied ? 'Copied!' : 'Copy'}</button>}
        </div>
        <pre tabIndex={0}>
          <code>
            {lines.map((line, lineIndex) => (
              <span key={lineIndex} className={`rwpb-code-line${highlighted.has(lineIndex + 1) ? ' is-highlighted' : ''}`} data-line={lineIndex + 1}>
                {line.map((token, tokenIndex) => (token.type ? <span key={tokenIndex} className={`rwpb-tok-${token.type}`}>{token.text}</span> : <Fragment key={tokenIndex}>{token.text}</Fragment>))}
                {'\n'}
              </span>
            ))}
          </code>
        </pre>
      </div>
    );
  },
};

// Hotspot ---------------------------------------------------------------------------------------------------------------------

interface Hotspot { id: string; x: number; y: number; label?: string; icon?: string; content?: string; link?: unknown; position?: string }

export const hotspot: WidgetDefinition = {
  type: 'hotspot',
  label: 'Hotspot',
  icon: 'crosshair',
  category: 'pro',
  keywords: ['image map', 'tooltip', 'pins', 'points'],
  defaults: () => ({
    settings: {
      image: '', trigger: 'click', pulse: true,
      spots: [
        { id: itemId(), x: 30, y: 40, icon: 'plus', content: 'Describe this part of the image.' },
        { id: itemId(), x: 65, y: 60, icon: 'plus', content: 'And this one.' },
      ],
    },
  }),
  controls: [
    { key: 'image', label: 'Image', type: 'image', dynamic: true },
    { key: 'alt', label: 'Alternative text', type: 'text', dynamic: true },
    { key: 'spots', label: 'Hotspots', type: 'repeater', itemLabel: 'label', newItem: () => ({ id: itemId(), x: 50, y: 50, icon: 'plus', content: 'Tooltip content' }), fields: [
      { key: 'x', label: 'Horizontal position (%)', type: 'slider', min: 0, max: 100 },
      { key: 'y', label: 'Vertical position (%)', type: 'slider', min: 0, max: 100 },
      { key: 'label', label: 'Label', type: 'text' },
      { key: 'icon', label: 'Icon', type: 'icon' },
      { key: 'content', label: 'Tooltip content', type: 'textarea', dynamic: true },
      { key: 'position', label: 'Tooltip position', type: 'select', options: opts(['top', 'Above'], ['bottom', 'Below'], ['left', 'Left'], ['right', 'Right']) },
      linkControl(),
    ] },
    { key: 'trigger', label: 'Show tooltip on', type: 'select', options: opts(['click', 'Click'], ['hover', 'Hover'], ['always', 'Always visible']) },
    { key: 'pulse', label: 'Pulse animation', type: 'toggle' },
    { key: 'spotSize', label: 'Hotspot size (px)', type: 'slider', tab: 'style', responsive: true, min: 14, max: 80 },
    colorControl('spotColor', 'Hotspot icon colour'),
    colorControl('spotBg', 'Hotspot background'),
    colorControl('tooltipBg', 'Tooltip background'),
    colorControl('tooltipColor', 'Tooltip text colour'),
    { key: 'tooltipWidth', label: 'Tooltip width (px)', type: 'slider', tab: 'style', min: 100, max: 500 },
    typographyControl('tooltipTypography', 'Tooltip typography'),
  ],
  css: (bag) => ({
    ' .rwpb-hotspot-button': { width: length(bag.spotSize, 'px'), height: length(bag.spotSize, 'px'), color: color(bag.spotColor), 'background-color': color(bag.spotBg), 'min-width': length(bag.spotSize, 'px') },
    ' .rwpb-hotspot-tooltip': { 'background-color': color(bag.tooltipBg), color: color(bag.tooltipColor), width: length(bag.tooltipWidth, 'px'), '--rwpb-tooltip-bg': color(bag.tooltipBg), ...typography(bag.tooltipTypography as Typography | undefined) },
  }),
  View: function HotspotView({ node }) {
    const { dynamic, mode } = useRenderContext();
    const src = useMediaUrl(node.settings.image);
    const alt = useText(node.settings.alt);
    const spots = listOf<Hotspot>(node.settings.spots);
    const [open, setOpen] = useState<string | null>(null);
    const baseId = useId();
    const trigger = pick(node.settings.trigger, ['click', 'hover', 'always'] as const, 'click');
    const rootRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      if (!open) return undefined;
      const close = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(null); };
      const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(null); };
      document.addEventListener('click', close);
      document.addEventListener('keydown', onKey);
      return () => { document.removeEventListener('click', close); document.removeEventListener('keydown', onKey); };
    }, [open]);

    if (!src) return <EditorPlaceholder>Choose an image, then place hotspots in the Content tab.</EditorPlaceholder>;
    return (
      <div ref={rootRef} className={`rwpb-hotspots rwpb-hotspots-${trigger}${node.settings.pulse ? ' rwpb-hotspots-pulse' : ''}`}>
        <img src={src} alt={alt} />
        {spots.map((spot, index) => {
          const id = spot.id || String(index);
          const visible = trigger === 'always' || open === id || (mode === 'edit' && open === id);
          const tooltipId = `${baseId}-${index}`;
          const link = linkAttributes(spot.link, dynamic);
          const content = mode === 'edit' ? str(spot.content) : resolveText(spot.content, dynamic);
          const position = pick(spot.position, ['top', 'bottom', 'left', 'right'] as const, 'top');
          const inner = (
            <>
              {spot.icon && <Icon name={spot.icon} size="1em" />}
              {spot.label && <span className="rwpb-hotspot-label">{spot.label}</span>}
              {!spot.icon && !spot.label && <span className="rwpb-sr-only">Hotspot {index + 1}</span>}
            </>
          );
          return (
            <div key={id} className={`rwpb-hotspot${visible ? ' is-open' : ''}`} style={{ left: `${clamp(num(spot.x, 50), 0, 100)}%`, top: `${clamp(num(spot.y, 50), 0, 100)}%` }}
              onMouseEnter={() => trigger === 'hover' && setOpen(id)} onMouseLeave={() => trigger === 'hover' && setOpen(null)}>
              {link && mode === 'view'
                ? <a className="rwpb-hotspot-button" {...link} aria-describedby={content ? tooltipId : undefined} onFocus={() => setOpen(id)} onBlur={() => setOpen(null)}>{inner}</a>
                : (
                  <button type="button" className="rwpb-hotspot-button" aria-expanded={trigger === 'always' ? undefined : visible} aria-describedby={content ? tooltipId : undefined}
                    onClick={(event) => { event.stopPropagation(); if (trigger !== 'always') setOpen(open === id ? null : id); }}
                    onFocus={() => trigger === 'hover' && setOpen(id)} onBlur={() => trigger === 'hover' && setOpen(null)}>
                    {inner}
                  </button>
                )}
              {content && <span id={tooltipId} role="tooltip" className={`rwpb-hotspot-tooltip rwpb-tooltip-${position}`} hidden={!visible}>{content}</span>}
            </div>
          );
        })}
      </div>
    );
  },
};

// Progress Tracker ----------------------------------------------------------------------------------------------------------------

export const progressTracker: WidgetDefinition = {
  type: 'progress-tracker',
  label: 'Progress Tracker',
  icon: 'activity',
  category: 'pro',
  keywords: ['reading progress', 'scroll', 'indicator'],
  defaults: () => ({ settings: { trackerType: 'horizontal', relativeTo: 'page', placement: 'top', showPercent: false } }),
  controls: [
    { key: 'trackerType', label: 'Type', type: 'select', options: opts(['horizontal', 'Horizontal bar'], ['circular', 'Circle']) },
    { key: 'relativeTo', label: 'Progress relative to', type: 'select', options: opts(['page', 'The whole page'], ['section', 'The section containing this widget'], ['content', 'The page builder content only']) },
    { key: 'placement', label: 'Position', type: 'select', options: opts(['top', 'Fixed to the top of the screen'], ['bottom', 'Fixed to the bottom of the screen'], ['inline', 'Where the widget is placed']) },
    { key: 'showPercent', label: 'Show percentage', type: 'toggle' },
    { key: 'barHeight', label: 'Height / circle size (px)', type: 'slider', tab: 'style', min: 2, max: 160 },
    colorControl('fillColor', 'Progress colour'),
    colorControl('trackColor', 'Track colour'),
    colorControl('percentColor', 'Percentage colour'),
  ],
  css: (bag, node) => ({
    ' .rwpb-tracker': {
      '--rwpb-tracker-fill': color(bag.fillColor), '--rwpb-tracker-track': color(bag.trackColor),
      '--rwpb-tracker-size': length(bag.barHeight ?? (node.settings.trackerType === 'circular' ? 80 : 6), 'px'),
    },
    ' .rwpb-tracker-percent': { color: color(bag.percentColor) },
  }),
  View: function ProgressTrackerView({ node }) {
    const { mode } = useRenderContext();
    const rootRef = useRef<HTMLDivElement>(null);
    const [progress, setProgress] = useState(mode === 'edit' ? 45 : 0);
    const relativeTo = pick(node.settings.relativeTo, ['page', 'section', 'content'] as const, 'page');

    useEffect(() => {
      if (mode === 'edit') return undefined;
      let frame = 0;
      const measure = () => {
        frame = 0;
        let value: number;
        if (relativeTo === 'page') {
          const scrollable = document.documentElement.scrollHeight - window.innerHeight;
          value = scrollable > 0 ? window.scrollY / scrollable : 1;
        } else {
          const target = relativeTo === 'section' ? rootRef.current?.closest('.rwpb-section') : rootRef.current?.closest('.rwpb-root');
          if (!target) return;
          const rect = target.getBoundingClientRect();
          const distance = rect.height - window.innerHeight;
          value = distance > 0 ? -rect.top / distance : rect.top <= 0 ? 1 : 0;
        }
        setProgress(Math.round(clamp(value, 0, 1) * 100));
      };
      const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
      measure();
      window.addEventListener('scroll', schedule, { passive: true });
      window.addEventListener('resize', schedule);
      return () => { window.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule); if (frame) cancelAnimationFrame(frame); };
    }, [mode, relativeTo]);

    const circular = node.settings.trackerType === 'circular';
    const placement = mode === 'edit' ? 'inline' : pick(node.settings.placement, ['top', 'bottom', 'inline'] as const, 'top');
    const percent = <span className="rwpb-tracker-percent">{progress}%</span>;
    return (
      <div ref={rootRef} className={`rwpb-tracker rwpb-tracker-${circular ? 'circular' : 'horizontal'} rwpb-tracker-${placement}`}
        role="progressbar" aria-label="Reading progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
        {circular ? (
          <span className="rwpb-tracker-circle">
            <svg viewBox="0 0 36 36" aria-hidden="true">
              <circle className="rwpb-tracker-circle-track" cx="18" cy="18" r="15.9" />
              <circle className="rwpb-tracker-circle-fill" cx="18" cy="18" r="15.9" pathLength={100} style={{ strokeDashoffset: 100 - progress }} />
            </svg>
            {Boolean(node.settings.showPercent) && percent}
          </span>
        ) : (
          <span className="rwpb-tracker-bar"><span className="rwpb-tracker-fill" style={{ width: `${progress}%` }}>{Boolean(node.settings.showPercent) && percent}</span></span>
        )}
      </div>
    );
  },
};

// Table of Contents ------------------------------------------------------------------------------------------------------------------

interface TocEntry { id: string; text: string; level: number }

const slugify = (text: string) => text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').slice(0, 60) || 'section';

export const tableOfContents: WidgetDefinition = {
  type: 'table-of-contents',
  label: 'Table of Contents',
  icon: 'list-tree',
  category: 'pro',
  keywords: ['toc', 'contents', 'headings', 'navigation'],
  defaults: () => ({ settings: { title: 'Table of Contents', headings: 'h2,h3', marker: 'numbers', hierarchical: true, collapsible: true, collapsed: false, excludeClass: '' } }),
  controls: [
    { key: 'title', label: 'Title', type: 'text', dynamic: true },
    { key: 'headings', label: 'Include headings', type: 'select', options: opts(['h2', 'H2'], ['h2,h3', 'H2 – H3'], ['h2,h3,h4', 'H2 – H4'], ['h1,h2,h3,h4,h5,h6', 'All (H1 – H6)'], ['h3', 'H3'], ['h3,h4', 'H3 – H4']) },
    { key: 'scope', label: 'Look for headings in', type: 'select', options: opts(['builder', 'The page builder content'], ['document', 'The whole page (including the theme)']) },
    { key: 'excludeClass', label: 'Skip headings with this CSS class', type: 'text', placeholder: 'no-toc' },
    { key: 'marker', label: 'Marker', type: 'select', options: opts(['numbers', 'Numbers'], ['bullets', 'Bullets'], ['none', 'None']) },
    { key: 'hierarchical', label: 'Indent sub-headings', type: 'toggle' },
    { key: 'collapsible', label: 'Collapsible', type: 'toggle' },
    { key: 'collapsed', label: 'Start collapsed', type: 'toggle', condition: (settings) => Boolean(settings.collapsible) },
    colorControl('boxBg', 'Background'),
    colorControl('titleColor', 'Title colour'),
    typographyControl('titleTypography', 'Title typography'),
    colorControl('linkColor', 'Link colour'),
    colorControl('linkHover', 'Link hover / active colour'),
    typographyControl('listTypography', 'List typography'),
  ],
  css: (bag) => ({
    ' .rwpb-toc': { 'background-color': color(bag.boxBg) },
    ' .rwpb-toc-title': { color: color(bag.titleColor), ...typography(bag.titleTypography as Typography | undefined) },
    ' .rwpb-toc-list a': { color: color(bag.linkColor), ...typography(bag.listTypography as Typography | undefined) },
    ' .rwpb-toc-list a:hover| .rwpb-toc-list a.is-active': { color: color(bag.linkHover) },
  }),
  View: function TableOfContentsView({ node }) {
    const { mode } = useRenderContext();
    const title = useText(node.settings.title);
    const rootRef = useRef<HTMLElement>(null);
    const [entries, setEntries] = useState<TocEntry[]>([]);
    const [collapsed, setCollapsed] = useState(Boolean(node.settings.collapsible && node.settings.collapsed));
    const [active, setActive] = useState('');
    const listId = useId();
    const selector = str(node.settings.headings, 'h2,h3').split(',').filter((tag) => /^h[1-6]$/.test(tag)).join(',') || 'h2,h3';
    const exclude = str(node.settings.excludeClass).replace(/[^\w-]/g, '');
    const scope = node.settings.scope === 'document' ? 'document' : 'builder';

    useEffect(() => {
      const root = rootRef.current;
      if (!root) return undefined;
      const container = scope === 'document' ? document.body : root.closest('.rwpb-root') || document.body;
      const scan = () => {
        const used = new Set<string>();
        const found: TocEntry[] = [];
        container.querySelectorAll<HTMLElement>(selector).forEach((heading) => {
          if (root.contains(heading) || heading.closest('.rwpb-toc') || (exclude && heading.classList.contains(exclude))) return;
          const text = heading.textContent?.trim() || '';
          if (!text) return;
          let id = heading.id;
          if (!id) {
            const base = `toc-${slugify(text)}`;
            id = base;
            for (let suffix = 2; used.has(id) || document.getElementById(id); suffix += 1) id = `${base}-${suffix}`;
            // Anchors only on the live page; the editor canvas is rebuilt on every change.
            if (mode === 'view') heading.id = id;
          }
          used.add(id);
          found.push({ id, text, level: Number(heading.tagName.slice(1)) });
        });
        setEntries((current) => (JSON.stringify(current) === JSON.stringify(found) ? current : found));
      };
      scan();
      // Widgets that load content (posts, templates) add headings after this one renders.
      let timer = 0;
      const observer = new MutationObserver(() => { window.clearTimeout(timer); timer = window.setTimeout(scan, 300); });
      observer.observe(container, { childList: true, subtree: true, characterData: mode === 'edit' });
      return () => { observer.disconnect(); window.clearTimeout(timer); };
    }, [mode, selector, exclude, scope]);

    useEffect(() => {
      if (mode !== 'view' || !entries.length || !('IntersectionObserver' in window)) return undefined;
      const observer = new IntersectionObserver((items) => {
        const visible = items.filter((item) => item.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      }, { rootMargin: '0px 0px -70% 0px' });
      entries.forEach((entry) => { const element = document.getElementById(entry.id); if (element) observer.observe(element); });
      return () => observer.disconnect();
    }, [mode, entries]);

    const minLevel = entries.reduce((lowest, entry) => Math.min(lowest, entry.level), 6);
    const marker = pick(node.settings.marker, ['numbers', 'bullets', 'none'] as const, 'numbers');
    const ListTag = marker === 'numbers' ? 'ol' : 'ul';
    return (
      <nav ref={rootRef} className={`rwpb-toc rwpb-toc-marker-${marker}`} aria-label={title || 'Table of contents'}>
        <div className="rwpb-toc-header">
          {title && <p className="rwpb-toc-title">{title}</p>}
          {Boolean(node.settings.collapsible) && (
            <button type="button" className="rwpb-toc-toggle" aria-expanded={!collapsed} aria-controls={listId} aria-label={collapsed ? 'Expand the table of contents' : 'Collapse the table of contents'} onClick={() => setCollapsed((value) => !value)}>
              <Icon name={collapsed ? 'chevron-down' : 'chevron-up'} size={18} />
            </button>
          )}
        </div>
        <div id={listId} hidden={collapsed}>
          {entries.length === 0
            ? (mode === 'edit' ? <p className="rwpb-toc-empty">No {selector.toUpperCase().replace(/,/g, ', ')} headings on this page yet.</p> : null)
            : (
              <ListTag className="rwpb-toc-list">
                {entries.map((entry) => (
                  <li key={entry.id} style={node.settings.hierarchical ? { marginInlineStart: `${(entry.level - minLevel) * 1.1}em` } : undefined}>
                    <a href={`#${entry.id}`} className={active === entry.id ? 'is-active' : undefined}
                      onClick={(event) => {
                        if (mode === 'edit') { event.preventDefault(); return; }
                        const target = document.getElementById(entry.id);
                        if (!target) return;
                        event.preventDefault();
                        target.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
                        history.replaceState(null, '', `#${entry.id}`);
                      }}>
                      {entry.text}
                    </a>
                  </li>
                ))}
              </ListTag>
            )}
        </div>
      </nav>
    );
  },
};

// Lottie ----------------------------------------------------------------------------------------------------------------------------

interface LottiePlayer { play: () => void; pause: () => void; stop: () => void; destroy: () => void; setSpeed: (speed: number) => void; setDirection: (direction: 1 | -1) => void; goToAndStop: (value: number, isFrame?: boolean) => void; totalFrames: number; addEventListener: (name: string, callback: () => void) => void }

export const lottie: WidgetDefinition = {
  type: 'lottie',
  label: 'Lottie',
  icon: 'sparkles',
  category: 'pro',
  keywords: ['animation', 'json', 'bodymovin', 'motion'],
  defaults: () => ({ settings: { url: '', trigger: 'viewport', loop: true, speed: 1, reverse: false }, style: { lottieWidth: 60, align: 'center' } }),
  controls: [
    { key: 'url', label: 'Lottie JSON file URL', type: 'text', dynamic: true, placeholder: 'https://…/animation.json', help: 'Upload the .json file to the media library (or any host that allows cross-origin requests) and paste its URL.' },
    linkControl(),
    { key: 'trigger', label: 'Play', type: 'select', options: opts(['autoplay', 'Automatically'], ['viewport', 'When scrolled into view'], ['hover', 'On hover'], ['click', 'On click'], ['scroll', 'With page scroll']) },
    { key: 'loop', label: 'Loop', type: 'toggle', condition: (settings) => settings.trigger !== 'scroll' },
    { key: 'speed', label: 'Speed', type: 'slider', min: 0.1, max: 5, step: 0.1, condition: (settings) => settings.trigger !== 'scroll' },
    { key: 'reverse', label: 'Play in reverse', type: 'toggle' },
    { key: 'lottieWidth', label: 'Width (%)', type: 'slider', tab: 'style', responsive: true, min: 5, max: 100 },
    alignControl(),
  ],
  css: (bag) => ({
    '': alignCss(bag),
    ' .rwpb-lottie': { width: `${num(bag.lottieWidth, 60)}%` },
  }),
  View: function LottieView({ node }) {
    const { mode } = useRenderContext();
    const url = safeMediaUrl(useResolved(node.settings.url));
    const link = useLinkProps(node.settings.link);
    const hostRef = useRef<HTMLDivElement>(null);
    const playerRef = useRef<LottiePlayer | null>(null);
    const [error, setError] = useState('');
    const trigger = pick(node.settings.trigger, ['autoplay', 'viewport', 'hover', 'click', 'scroll'] as const, 'viewport');
    const reduced = prefersReducedMotion();

    useEffect(() => {
      const host = hostRef.current;
      if (!url || !host) return undefined;
      let cancelled = false;
      let observer: IntersectionObserver | null = null;
      let onScroll: (() => void) | null = null;
      setError('');
      // lottie-web is a separate chunk, downloaded only by pages that use this widget.
      import('lottie-web/build/player/lottie_light').then(({ default: lottieWeb }) => {
        if (cancelled) return;
        const player = lottieWeb.loadAnimation({
          container: host, renderer: 'svg', path: url,
          loop: trigger !== 'scroll' && Boolean(node.settings.loop), autoplay: false,
        }) as unknown as LottiePlayer;
        playerRef.current = player;
        player.setSpeed(clamp(num(node.settings.speed, 1), 0.1, 5));
        if (node.settings.reverse) player.setDirection(-1);
        player.addEventListener('data_failed', () => !cancelled && setError('The Lottie file could not be loaded. Check the URL, and that its host allows cross-origin requests.'));
        player.addEventListener('DOMLoaded', () => {
          if (cancelled) return;
          if (reduced || mode === 'edit') { player.goToAndStop(node.settings.reverse ? player.totalFrames - 1 : 0, true); if (mode === 'edit' && !reduced) player.play(); return; }
          if (trigger === 'autoplay') player.play();
          if (trigger === 'viewport' && 'IntersectionObserver' in window) {
            observer = new IntersectionObserver(([entry]) => (entry.isIntersecting ? player.play() : player.pause()), { threshold: 0.25 });
            observer.observe(host);
          }
          if (trigger === 'scroll') {
            onScroll = () => {
              const rect = host.getBoundingClientRect();
              const progress = clamp((window.innerHeight - rect.top) / (window.innerHeight + rect.height), 0, 1);
              player.goToAndStop((node.settings.reverse ? 1 - progress : progress) * (player.totalFrames - 1), true);
            };
            onScroll();
            window.addEventListener('scroll', onScroll, { passive: true });
          }
        });
      }).catch(() => !cancelled && setError('The Lottie player could not be loaded.'));
      return () => {
        cancelled = true;
        observer?.disconnect();
        if (onScroll) window.removeEventListener('scroll', onScroll);
        playerRef.current?.destroy();
        playerRef.current = null;
      };
    }, [url, mode, trigger, reduced, node.settings.loop, node.settings.speed, node.settings.reverse]);

    if (!url) return <EditorPlaceholder>Enter the URL of a Lottie .json file in the Content tab.</EditorPlaceholder>;
    const player = (
      <div ref={hostRef} className="rwpb-lottie" role="img" aria-label="Animation"
        onMouseEnter={() => trigger === 'hover' && !reduced && playerRef.current?.play()}
        onMouseLeave={() => trigger === 'hover' && playerRef.current?.stop()}
        onClick={() => trigger === 'click' && !reduced && playerRef.current?.play()} />
    );
    return (
      <>
        {error && mode === 'edit' && <div className="rwpb-placeholder rwpb-placeholder-error">{error}</div>}
        {link ? <a {...link} className="rwpb-lottie-link">{player}</a> : player}
      </>
    );
  },
};
