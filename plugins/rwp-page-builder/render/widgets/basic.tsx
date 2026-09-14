import { useState } from 'react';
import ContentRenderer from '../../../../src/components/ContentRenderer';
import { alignControl, colorControl, headingTags, linkControl, opts, typographyControl } from '../../lib/controls';
import { escapeHtml, resolveText } from '../../lib/dynamic';
import { Icon } from '../../lib/icons';
import type { WidgetDefinition } from '../../lib/registry';
import { safeMediaUrl } from '../../lib/sanitize';
import {
  alignToFlex, boxSides, border, color, isSet, length, radius, size, textShadow, typography,
  type Border, type Box, type Shadow, type SizeValue, type Typography,
} from '../../lib/style';
import { EditableText } from '../NodeView';
import { useRenderContext } from '../context';
import { EditorPlaceholder, Lightbox, MaybeLink, useLightbox, useLinkProps, useMediaUrl, useResolved, useText } from './shared';

const str = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback);

// Heading ----------------------------------------------------------------------------

export const heading: WidgetDefinition = {
  type: 'heading',
  label: 'Heading',
  icon: 'heading',
  category: 'basic',
  keywords: ['title', 'h1', 'h2'],
  defaults: () => ({ settings: { title: 'Add your heading here', tag: 'h2' } }),
  controls: [
    { key: 'title', label: 'Title', type: 'textarea', dynamic: true },
    linkControl(),
    { key: 'tag', label: 'HTML tag', type: 'select', options: headingTags },
    alignControl('align', 'Alignment', true),
    colorControl('color', 'Text colour'),
    typographyControl(),
    { key: 'textShadow', label: 'Text shadow', type: 'textShadow', tab: 'style' },
  ],
  css: (bag) => ({
    '': { 'text-align': isSet(bag.align) ? String(bag.align) : undefined },
    ' .rwpb-heading-title': {
      color: color(bag.color),
      'text-shadow': textShadow(bag.textShadow as Shadow | undefined),
      ...typography(bag.typography as Typography | undefined),
    },
  }),
  View: function HeadingView({ node }) {
    const tag = headingTags.some((option) => option.value === node.settings.tag) ? String(node.settings.tag) : 'h2';
    const link = useLinkProps(node.settings.link);
    const title = <EditableText nodeId={node.id} field="title" value={str(node.settings.title)} as={link ? 'span' : tag as 'h2'} className={link ? undefined : 'rwpb-heading-title'} multiline />;
    if (!link) return title;
    const Tag = tag as 'h2';
    return <Tag className="rwpb-heading-title"><a {...link}>{title}</a></Tag>;
  },
};

// Text editor -------------------------------------------------------------------------

export const text: WidgetDefinition = {
  type: 'text',
  label: 'Text Editor',
  icon: 'type',
  category: 'basic',
  keywords: ['paragraph', 'rich text', 'wysiwyg'],
  defaults: () => ({ settings: { html: '<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Ut elit tellus, luctus nec ullamcorper mattis, pulvinar dapibus leo.</p>' } }),
  controls: [
    { key: 'html', label: 'Content', type: 'richtext', dynamic: true, help: 'Shortcodes such as [rwp_login] work here. Dynamic tags are HTML-escaped when inserted.' },
    alignControl('align', 'Alignment', true),
    colorControl('color', 'Text colour'),
    colorControl('linkColor', 'Link colour'),
    typographyControl(),
    { key: 'columns', label: 'Text columns', type: 'slider', tab: 'style', responsive: true, min: 1, max: 4 },
  ],
  css: (bag) => ({
    '': { 'text-align': isSet(bag.align) ? String(bag.align) : undefined },
    ' .rwpb-text': {
      color: color(bag.color),
      columns: isSet(bag.columns) && Number(bag.columns) > 1 ? Number(bag.columns) : undefined,
      ...typography(bag.typography as Typography | undefined),
    },
    ' .rwpb-text a': { color: color(bag.linkColor) },
  }),
  View: function TextView({ node }) {
    const { dynamic } = useRenderContext();
    const html = resolveText(str(node.settings.html), dynamic, escapeHtml);
    return <ContentRenderer className="rwpb-text" html={html} />;
  },
};

// Image ----------------------------------------------------------------------------------

const aspectRatios = opts(['', 'Original'], ['1/1', '1:1'], ['4/3', '4:3'], ['3/2', '3:2'], ['16/9', '16:9'], ['21/9', '21:9'], ['3/4', '3:4'], ['9/16', '9:16']);

export const image: WidgetDefinition = {
  type: 'image',
  label: 'Image',
  icon: 'image',
  category: 'basic',
  keywords: ['photo', 'picture', 'lightbox'],
  defaults: () => ({ settings: { image: '', alt: '', caption: '', linkTo: 'none' } }),
  controls: [
    { key: 'image', label: 'Image', type: 'image', dynamic: true },
    { key: 'alt', label: 'Alternative text', type: 'text', dynamic: true, help: 'Describe the image for screen readers. Leave empty only for decorative images.' },
    { key: 'caption', label: 'Caption', type: 'text', dynamic: true },
    { key: 'linkTo', label: 'Link', type: 'select', options: opts(['none', 'None'], ['custom', 'Custom URL'], ['lightbox', 'Open in lightbox']) },
    { ...linkControl(), condition: (settings) => settings.linkTo === 'custom' },
    alignControl(),
    { key: 'width', label: 'Width', type: 'size', tab: 'style', responsive: true, units: ['%', 'px', 'vw'] },
    { key: 'maxWidth', label: 'Max width', type: 'size', tab: 'style', responsive: true, units: ['%', 'px'] },
    { key: 'aspectRatio', label: 'Aspect ratio', type: 'select', tab: 'style', responsive: true, options: aspectRatios },
    { key: 'objectFit', label: 'Crop', type: 'select', tab: 'style', options: opts(['cover', 'Fill (crop)'], ['contain', 'Fit (no crop)']), condition: (_settings, style) => Boolean(style.aspectRatio) },
    { key: 'imageRadius', label: 'Corner radius', type: 'dimensions', tab: 'style', units: ['px', '%'] },
    { key: 'hoverZoom', label: 'Zoom on hover', type: 'toggle', tab: 'style' },
    colorControl('captionColor', 'Caption colour'),
    typographyControl('captionTypography', 'Caption typography'),
  ],
  css: (bag) => ({
    '': { 'text-align': isSet(bag.align) ? String(bag.align) : undefined },
    ' .rwpb-image-frame': {
      width: size(bag.width as SizeValue | undefined, '%'),
      'max-width': size(bag.maxWidth as SizeValue | undefined, '%'),
      'aspect-ratio': isSet(bag.aspectRatio) ? String(bag.aspectRatio) : undefined,
      ...radius(bag.imageRadius as Box | undefined),
    },
    ' .rwpb-image-frame img': {
      height: isSet(bag.aspectRatio) ? '100%' : undefined,
      'object-fit': isSet(bag.aspectRatio) ? String(bag.objectFit || 'cover') : undefined,
    },
    ' .rwpb-image-frame:hover img': { transform: bag.hoverZoom ? 'scale(1.06)' : undefined },
    ' figcaption': { color: color(bag.captionColor), ...typography(bag.captionTypography as Typography | undefined) },
  }),
  View: function ImageView({ node }) {
    const src = useMediaUrl(node.settings.image);
    const alt = useText(node.settings.alt);
    const caption = useText(node.settings.caption);
    const link = useLinkProps(node.settings.linkTo === 'custom' ? node.settings.link : '');
    const lightbox = useLightbox();
    const { mode } = useRenderContext();
    if (!src) return <EditorPlaceholder>Choose an image in the Content tab.</EditorPlaceholder>;
    const img = <img src={src} alt={alt} loading="lazy" />;
    let frame = <span className="rwpb-image-frame">{img}</span>;
    if (node.settings.linkTo === 'lightbox') {
      frame = <button type="button" className="rwpb-image-frame rwpb-image-zoom" aria-label={alt ? `Enlarge: ${alt}` : 'Enlarge image'} onClick={() => mode === 'view' && lightbox.show()}>{img}</button>;
    } else if (link) {
      frame = <a className="rwpb-image-frame" {...link}>{img}</a>;
    }
    return (
      <figure className="rwpb-image">
        {frame}
        {caption && <figcaption>{caption}</figcaption>}
        {lightbox.open && <Lightbox src={src} alt={alt} onClose={lightbox.hide} />}
      </figure>
    );
  },
};

// Button -----------------------------------------------------------------------------------

export const button: WidgetDefinition = {
  type: 'button',
  label: 'Button',
  icon: 'button',
  category: 'basic',
  keywords: ['cta', 'link'],
  defaults: () => ({ settings: { text: 'Click here', link: { url: '#' }, size: 'md', iconPosition: 'after' } }),
  controls: [
    { key: 'text', label: 'Text', type: 'text', dynamic: true },
    linkControl(),
    { key: 'size', label: 'Size', type: 'select', options: opts(['sm', 'Small'], ['md', 'Medium'], ['lg', 'Large'], ['xl', 'Extra large']) },
    { key: 'icon', label: 'Icon', type: 'icon' },
    { key: 'iconPosition', label: 'Icon position', type: 'select', options: opts(['before', 'Before'], ['after', 'After']), condition: (settings) => Boolean(settings.icon) },
    { key: 'hoverAnimation', label: 'Hover animation', type: 'select', options: opts(['', 'None'], ['grow', 'Grow'], ['shrink', 'Shrink'], ['float', 'Float'], ['pulse', 'Pulse']) },
    alignControl('align', 'Alignment', true),
    typographyControl(),
    colorControl('textColor', 'Text colour'),
    colorControl('bgColor', 'Background colour'),
    colorControl('hoverTextColor', 'Hover text colour'),
    colorControl('hoverBgColor', 'Hover background colour'),
    { key: 'buttonBorder', label: 'Button border', type: 'border', tab: 'style' },
    { key: 'buttonPadding', label: 'Button padding', type: 'dimensions', tab: 'style', responsive: true, units: ['px', 'em'] },
  ],
  css: (bag) => {
    const buttonBorder = bag.buttonBorder as Border | undefined;
    return {
      '': { 'text-align': bag.align === 'justify' ? undefined : isSet(bag.align) ? String(bag.align) : undefined },
      ' .rwpb-button': {
        display: bag.align === 'justify' ? 'flex' : undefined,
        width: bag.align === 'justify' ? '100%' : undefined,
        color: color(bag.textColor),
        'background-color': color(bag.bgColor),
        ...typography(bag.typography as Typography | undefined),
        ...border(buttonBorder),
        ...boxSides('padding', bag.buttonPadding as Box | undefined),
      },
      ' .rwpb-button:hover| .rwpb-button:focus-visible': {
        color: color(bag.hoverTextColor),
        'background-color': color(bag.hoverBgColor),
      },
    };
  },
  View: function ButtonView({ node }) {
    const link = useLinkProps(node.settings.link);
    const icon = str(node.settings.icon);
    const sizeClass = ['sm', 'md', 'lg', 'xl'].includes(String(node.settings.size)) ? String(node.settings.size) : 'md';
    const animation = ['grow', 'shrink', 'float', 'pulse'].includes(String(node.settings.hoverAnimation)) ? ` rwpb-hover-${node.settings.hoverAnimation}` : '';
    const content = (
      <>
        {icon && node.settings.iconPosition === 'before' && <Icon name={icon} size="1.1em" />}
        <EditableText nodeId={node.id} field="text" value={str(node.settings.text)} />
        {icon && node.settings.iconPosition !== 'before' && <Icon name={icon} size="1.1em" />}
      </>
    );
    const className = `rwpb-button rwpb-button-${sizeClass}${animation}`;
    return link ? <a className={className} {...link}>{content}</a> : <span className={className}>{content}</span>;
  },
};

// Divider ----------------------------------------------------------------------------------

export const divider: WidgetDefinition = {
  type: 'divider',
  label: 'Divider',
  icon: 'divider',
  category: 'basic',
  keywords: ['line', 'separator', 'hr'],
  defaults: () => ({ settings: { lineStyle: 'solid', element: 'none', text: 'Divider', icon: 'star' } }),
  controls: [
    { key: 'lineStyle', label: 'Style', type: 'select', options: opts(['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted'], ['double', 'Double']) },
    { key: 'element', label: 'Add element', type: 'select', options: opts(['none', 'None'], ['text', 'Text'], ['icon', 'Icon']) },
    { key: 'text', label: 'Text', type: 'text', dynamic: true, condition: (settings) => settings.element === 'text' },
    { key: 'icon', label: 'Icon', type: 'icon', condition: (settings) => settings.element === 'icon' },
    { key: 'width', label: 'Width (%)', type: 'slider', tab: 'style', responsive: true, min: 5, max: 100 },
    { key: 'weight', label: 'Weight (px)', type: 'slider', tab: 'style', min: 1, max: 20 },
    colorControl('lineColor', 'Colour'),
    alignControl(),
    { key: 'gap', label: 'Space above and below (px)', type: 'slider', tab: 'style', responsive: true, min: 0, max: 100 },
    colorControl('elementColor', 'Text / icon colour'),
    typographyControl('textTypography', 'Text typography'),
  ],
  css: (bag) => ({
    ' .rwpb-divider': {
      width: isSet(bag.width) ? `${Number(bag.width)}%` : undefined,
      'padding-block': length(bag.gap, 'px'),
      'margin-left': bag.align === 'center' || bag.align === 'right' ? 'auto' : undefined,
      'margin-right': bag.align === 'center' ? 'auto' : undefined,
      '--rwpb-divider-color': color(bag.lineColor),
      '--rwpb-divider-weight': length(bag.weight, 'px'),
    },
    ' .rwpb-divider-element': { color: color(bag.elementColor), ...typography(bag.textTypography as Typography | undefined) },
  }),
  View: function DividerView({ node }) {
    const style = ['solid', 'dashed', 'dotted', 'double'].includes(String(node.settings.lineStyle)) ? String(node.settings.lineStyle) : 'solid';
    const textValue = useText(node.settings.text);
    const element = node.settings.element === 'text' ? <span className="rwpb-divider-element">{textValue}</span>
      : node.settings.element === 'icon' ? <span className="rwpb-divider-element"><Icon name={str(node.settings.icon)} size="1.25em" /></span>
        : null;
    return (
      <div className={`rwpb-divider rwpb-divider-${style}`} role="separator">
        <span className="rwpb-divider-line" />
        {element && <>{element}<span className="rwpb-divider-line" /></>}
      </div>
    );
  },
};

// Spacer -----------------------------------------------------------------------------------

export const spacer: WidgetDefinition = {
  type: 'spacer',
  label: 'Spacer',
  icon: 'spacer',
  category: 'basic',
  keywords: ['gap', 'space', 'blank'],
  defaults: () => ({ settings: {}, style: { space: { size: 50, unit: 'px' } } }),
  controls: [
    { key: 'space', label: 'Space', type: 'size', tab: 'content', store: 'style', responsive: true, units: ['px', 'vh', 'em'] },
  ],
  css: (bag) => ({ ' .rwpb-spacer': { height: size(bag.space as SizeValue | undefined) } }),
  View: () => <div className="rwpb-spacer" aria-hidden="true" />,
};

// Icon and Icon Box -------------------------------------------------------------------------

const iconStyleControls = [
  { key: 'iconView', label: 'View', type: 'select' as const, options: opts(['default', 'Default'], ['stacked', 'Stacked'], ['framed', 'Framed']) },
  { key: 'iconShape', label: 'Shape', type: 'select' as const, options: opts(['circle', 'Circle'], ['square', 'Square']), condition: (settings: Record<string, unknown>) => settings.iconView === 'stacked' || settings.iconView === 'framed' },
  colorControl('iconColor', 'Icon colour'),
  { ...colorControl('iconBg', 'Frame / background colour'), condition: (settings: Record<string, unknown>) => settings.iconView === 'stacked' || settings.iconView === 'framed' },
  { key: 'iconSize', label: 'Icon size (px)', type: 'slider' as const, tab: 'style' as const, responsive: true, min: 8, max: 200 },
  { key: 'iconPadding', label: 'Frame padding (px)', type: 'slider' as const, tab: 'style' as const, min: 0, max: 60, condition: (settings: Record<string, unknown>) => settings.iconView === 'stacked' || settings.iconView === 'framed' },
];

const iconCss = (bag: Record<string, unknown>, view: unknown) => ({
  color: color(bag.iconColor),
  'font-size': length(bag.iconSize, 'px'),
  padding: view === 'stacked' || view === 'framed' ? length(bag.iconPadding ?? 16, 'px') : undefined,
  'background-color': view === 'stacked' ? color(bag.iconBg) || 'var(--rwpb-primary)' : undefined,
  'border-color': view === 'framed' ? color(bag.iconBg) || 'currentColor' : undefined,
});

function IconGlyph({ settings }: { settings: Record<string, unknown> }) {
  const view = ['stacked', 'framed'].includes(String(settings.iconView)) ? String(settings.iconView) : 'default';
  const shape = settings.iconShape === 'square' ? 'square' : 'circle';
  return (
    <span className={`rwpb-icon rwpb-icon-${view} rwpb-icon-${shape}`}>
      <Icon name={str(settings.icon, 'star')} size="1em" />
    </span>
  );
}

export const icon: WidgetDefinition = {
  type: 'icon',
  label: 'Icon',
  icon: 'star',
  category: 'basic',
  defaults: () => ({ settings: { icon: 'star', iconView: 'default' }, style: { iconSize: 48 } }),
  controls: [
    { key: 'icon', label: 'Icon', type: 'icon' },
    linkControl(),
    ...iconStyleControls.map((control) => ({ ...control, tab: control.tab || 'style' as const, store: control.key === 'iconView' || control.key === 'iconShape' ? 'settings' as const : undefined })),
    alignControl(),
  ],
  css: (bag, node) => ({
    '': { 'text-align': isSet(bag.align) ? String(bag.align) : undefined },
    ' .rwpb-icon': iconCss(bag, node.settings.iconView),
  }),
  View: function IconView({ node }) {
    return <MaybeLink link={node.settings.link} className="rwpb-icon-link"><IconGlyph settings={node.settings} /></MaybeLink>;
  },
};

export const iconBox: WidgetDefinition = {
  type: 'icon-box',
  label: 'Icon Box',
  icon: 'blocks',
  category: 'basic',
  keywords: ['feature', 'service'],
  defaults: () => ({
    settings: { icon: 'rocket', title: 'This is the heading', description: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.', position: 'top', titleTag: 'h3', iconView: 'stacked', iconShape: 'circle' },
    style: { iconSize: 28, align: 'center' },
  }),
  controls: [
    { key: 'icon', label: 'Icon', type: 'icon' },
    { key: 'title', label: 'Title', type: 'text', dynamic: true },
    { key: 'description', label: 'Description', type: 'textarea', dynamic: true },
    linkControl(),
    { key: 'position', label: 'Icon position', type: 'select', options: opts(['top', 'Top'], ['left', 'Left'], ['right', 'Right']) },
    { key: 'titleTag', label: 'Title HTML tag', type: 'select', options: headingTags },
    ...iconStyleControls.map((control) => ({ ...control, tab: control.tab || 'style' as const, store: control.key === 'iconView' || control.key === 'iconShape' ? 'settings' as const : undefined })),
    { key: 'iconSpacing', label: 'Icon spacing (px)', type: 'slider', tab: 'style', responsive: true, min: 0, max: 80 },
    alignControl(),
    colorControl('titleColor', 'Title colour'),
    typographyControl('titleTypography', 'Title typography'),
    colorControl('descriptionColor', 'Description colour'),
    typographyControl('descriptionTypography', 'Description typography'),
  ],
  css: (bag, node) => ({
    ' .rwpb-icon-box': { 'text-align': isSet(bag.align) ? String(bag.align) : undefined, gap: length(bag.iconSpacing ?? 16, 'px') },
    ' .rwpb-icon-box-top': { 'align-items': node.settings.position === 'top' ? alignToFlex(bag.align) : undefined },
    ' .rwpb-icon': iconCss(bag, node.settings.iconView),
    ' .rwpb-icon-box-title': { color: color(bag.titleColor), ...typography(bag.titleTypography as Typography | undefined) },
    ' .rwpb-icon-box-description': { color: color(bag.descriptionColor), ...typography(bag.descriptionTypography as Typography | undefined) },
  }),
  View: function IconBoxView({ node }) {
    const position = ['left', 'right'].includes(String(node.settings.position)) ? String(node.settings.position) : 'top';
    const Tag = (headingTags.some((option) => option.value === node.settings.titleTag) ? node.settings.titleTag : 'h3') as 'h3';
    const link = useLinkProps(node.settings.link);
    const title = <EditableText nodeId={node.id} field="title" value={str(node.settings.title)} />;
    return (
      <div className={`rwpb-icon-box rwpb-icon-box-${position}`}>
        <IconGlyph settings={node.settings} />
        <div className="rwpb-icon-box-content">
          <Tag className="rwpb-icon-box-title">{link ? <a {...link}>{title}</a> : title}</Tag>
          <EditableText nodeId={node.id} field="description" value={str(node.settings.description)} as="p" className="rwpb-icon-box-description" multiline />
        </div>
      </div>
    );
  },
};

// Video ----------------------------------------------------------------------------------------

export function parseVideo(source: string, url: string): { kind: 'youtube' | 'vimeo' | 'hosted'; id: string } | null {
  if (source === 'hosted') return safeMediaUrl(url) ? { kind: 'hosted', id: safeMediaUrl(url) } : null;
  const youtube = url.match(/(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/);
  if (youtube) return { kind: 'youtube', id: youtube[1] };
  const vimeo = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vimeo) return { kind: 'vimeo', id: vimeo[1] };
  return null;
}

export const video: WidgetDefinition = {
  type: 'video',
  label: 'Video',
  icon: 'film',
  category: 'basic',
  keywords: ['youtube', 'vimeo', 'mp4', 'embed'],
  defaults: () => ({ settings: { source: 'youtube', url: 'https://www.youtube.com/watch?v=XHOmBV4js_E', controls: true, overlay: true, aspectRatio: '16/9' } }),
  controls: [
    { key: 'source', label: 'Source', type: 'select', options: opts(['youtube', 'YouTube'], ['vimeo', 'Vimeo'], ['hosted', 'Self-hosted (MP4/WebM URL)']) },
    { key: 'url', label: 'Video URL', type: 'text', placeholder: 'https://www.youtube.com/watch?v=…' },
    { key: 'poster', label: 'Poster image', type: 'image', help: 'Shown with a play button until clicked. For YouTube, the video thumbnail is used when empty.' },
    { key: 'overlay', label: 'Click-to-play overlay', type: 'toggle', help: 'Loads the player only when clicked: faster pages, and no third-party requests until then.' },
    { key: 'autoplay', label: 'Autoplay', type: 'toggle', help: 'Browsers only allow autoplay when muted.' },
    { key: 'mute', label: 'Mute', type: 'toggle' },
    { key: 'loop', label: 'Loop', type: 'toggle' },
    { key: 'controls', label: 'Player controls', type: 'toggle' },
    { key: 'aspectRatio', label: 'Aspect ratio', type: 'select', tab: 'style', options: aspectRatios.filter((option) => option.value) },
    colorControl('playColor', 'Play button colour'),
  ],
  css: (bag, node) => ({
    ' .rwpb-video': { 'aspect-ratio': String(node.settings.aspectRatio || '16/9') },
    ' .rwpb-video-play': { color: color(bag.playColor) },
  }),
  View: function VideoView({ node }) {
    const { mode } = useRenderContext();
    const [playing, setPlaying] = useState(false);
    const settings = node.settings;
    const parsed = parseVideo(String(settings.source || 'youtube'), useResolved(settings.url));
    const customPoster = useMediaUrl(settings.poster);
    if (!parsed) return <EditorPlaceholder>Enter a valid {String(settings.source) === 'hosted' ? 'video file' : 'YouTube or Vimeo'} URL.</EditorPlaceholder>;
    const poster = customPoster || (parsed.kind === 'youtube' ? `https://i.ytimg.com/vi/${parsed.id}/hqdefault.jpg` : '');
    const showOverlay = mode === 'edit' || Boolean(settings.overlay && poster && !playing && !settings.autoplay);
    const autoplay = playing || (Boolean(settings.autoplay) && mode === 'view');
    const muted = Boolean(settings.mute) || (Boolean(settings.autoplay) && !playing);

    let player = null;
    if (!showOverlay) {
      if (parsed.kind === 'hosted') {
        player = <video src={parsed.id} poster={poster || undefined} controls={Boolean(settings.controls)} autoPlay={autoplay} muted={muted} loop={Boolean(settings.loop)} playsInline />;
      } else {
        const params = new URLSearchParams();
        if (autoplay) params.set('autoplay', '1');
        if (parsed.kind === 'youtube') {
          if (muted) params.set('mute', '1');
          if (!settings.controls) params.set('controls', '0');
          if (settings.loop) { params.set('loop', '1'); params.set('playlist', parsed.id); }
          params.set('rel', '0');
        } else {
          if (muted) params.set('muted', '1');
          if (settings.loop) params.set('loop', '1');
          if (!settings.controls) params.set('controls', '0');
        }
        const src = parsed.kind === 'youtube'
          ? `https://www.youtube-nocookie.com/embed/${parsed.id}?${params}`
          : `https://player.vimeo.com/video/${parsed.id}?${params}`;
        player = <iframe src={src} title="Video player" allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowFullScreen loading="lazy" />;
      }
    }
    return (
      <div className="rwpb-video">
        {player}
        {showOverlay && (
          <button type="button" className="rwpb-video-overlay" aria-label="Play video" onClick={() => mode === 'view' && setPlaying(true)}
            style={poster ? { backgroundImage: `url("${poster.replace(/"/g, '%22')}")` } : undefined}>
            <span className="rwpb-video-play"><Icon name="play" size={34} /></span>
          </button>
        )}
      </div>
    );
  },
};
