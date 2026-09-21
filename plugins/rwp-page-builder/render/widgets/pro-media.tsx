/** Pro media and interactive widgets: playlists, carousels, galleries, off-canvas, search, login and payment buttons. */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import ContentRenderer from '../../../../src/components/ContentRenderer';
import { getSupabaseClient } from '../../../../src/lib/db';
import { signOutAndRedirect } from '../../../../src/lib/account';
import { alignControl, colorControl, headingTags, linkControl, opts, typographyControl } from '../../lib/controls';
import { resolveText } from '../../lib/dynamic';
import { Icon } from '../../lib/icons';
import type { WidgetDefinition } from '../../lib/registry';
import { safeMediaUrl, safeUrl } from '../../lib/sanitize';
import { alignToFlex, border, color, isSet, length, typography, type Border, type Typography } from '../../lib/style';
import { useRenderContext } from '../context';
import { fetchPosts, templateOptions } from '../data';
import { parseVideo } from './basic';
import { EditorPlaceholder, useLinkProps, useText } from './shared';
import { Stars } from './general';
import {
  Carousel, carouselControls, carouselCss, carouselOptions, clamp, headingTag, itemId, linkAttributes, listOf, num, pick,
  str, TemplateContent, useGalleryLightbox, type LightboxItem,
} from './kit';

const alignCss = (bag: Record<string, unknown>) => ({ 'text-align': isSet(bag.align) ? String(bag.align) : undefined });

/** An embeddable player URL for YouTube/Vimeo, or the file URL for self-hosted video. */
const embedUrl = (url: string, autoplay: boolean): { src: string; kind: 'iframe' | 'video' } | null => {
  const parsed = parseVideo(/\.(mp4|webm|ogg|mov)(\?|#|$)/i.test(url) ? 'hosted' : 'auto', url);
  if (!parsed) return null;
  if (parsed.kind === 'hosted') return { src: parsed.id, kind: 'video' };
  const params = new URLSearchParams(autoplay ? { autoplay: '1' } : {});
  if (parsed.kind === 'youtube') params.set('rel', '0');
  return {
    kind: 'iframe',
    src: parsed.kind === 'youtube' ? `https://www.youtube-nocookie.com/embed/${parsed.id}?${params}` : `https://player.vimeo.com/video/${parsed.id}?${params}`,
  };
};

const videoThumb = (url: string) => {
  const parsed = parseVideo('auto', url);
  return parsed?.kind === 'youtube' ? `https://i.ytimg.com/vi/${parsed.id}/mqdefault.jpg` : '';
};

// Video Playlist ------------------------------------------------------------------------------------------------

interface PlaylistItem { id: string; title: string; url: string; duration?: string; thumbnail?: string }

export const videoPlaylist: WidgetDefinition = {
  type: 'video-playlist',
  label: 'Video Playlist',
  icon: 'list-video',
  category: 'pro',
  keywords: ['videos', 'course', 'lessons', 'youtube'],
  defaults: () => ({
    settings: {
      heading: 'Playlist', listPosition: 'right', showNumbers: true, autoNext: true,
      items: [
        { id: itemId(), title: 'Getting started', url: 'https://www.youtube.com/watch?v=XHOmBV4js_E', duration: '3:35' },
        { id: itemId(), title: 'Going further', url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', duration: '10:34' },
      ],
    },
  }),
  controls: [
    { key: 'heading', label: 'Playlist title', type: 'text', dynamic: true },
    { key: 'items', label: 'Videos', type: 'repeater', itemLabel: 'title', newItem: () => ({ id: itemId(), title: 'New video', url: '' }), fields: [
      { key: 'title', label: 'Title', type: 'text' },
      { key: 'url', label: 'YouTube, Vimeo or MP4 URL', type: 'text' },
      { key: 'duration', label: 'Duration', type: 'text', placeholder: '4:20' },
      { key: 'thumbnail', label: 'Thumbnail', type: 'image', help: 'YouTube thumbnails are used automatically when this is empty.' },
    ] },
    { key: 'listPosition', label: 'List position', type: 'select', options: opts(['right', 'Right'], ['left', 'Left'], ['bottom', 'Below the player']) },
    { key: 'showNumbers', label: 'Show numbers', type: 'toggle' },
    { key: 'autoNext', label: 'Play the next self-hosted video automatically', type: 'toggle' },
    colorControl('listBg', 'List background'),
    colorControl('itemColor', 'Item colour'),
    colorControl('activeBg', 'Active item background'),
    colorControl('activeColor', 'Active item colour'),
    typographyControl('itemTypography', 'Item typography'),
  ],
  css: (bag) => ({
    ' .rwpb-playlist-list': { 'background-color': color(bag.listBg) },
    ' .rwpb-playlist-item': { color: color(bag.itemColor), ...typography(bag.itemTypography as Typography | undefined) },
    ' .rwpb-playlist-item[aria-current=true]': { 'background-color': color(bag.activeBg), color: color(bag.activeColor) },
  }),
  View: function VideoPlaylistView({ node }) {
    const { mode } = useRenderContext();
    const items = listOf<PlaylistItem>(node.settings.items).filter((item) => item && item.url);
    const heading = useText(node.settings.heading);
    const [active, setActive] = useState(0);
    const [playing, setPlaying] = useState(false);
    if (!items.length) return <EditorPlaceholder>Add videos in the Content tab.</EditorPlaceholder>;
    const current = items[Math.min(active, items.length - 1)];
    const player = embedUrl(current.url, true);
    const poster = safeMediaUrl(current.thumbnail) || videoThumb(current.url);
    const select = (index: number) => { setActive(index); if (mode === 'view') setPlaying(true); };
    const position = pick(node.settings.listPosition, ['right', 'left', 'bottom'] as const, 'right');
    return (
      <div className={`rwpb-playlist rwpb-playlist-${position}`}>
        <div className="rwpb-playlist-player">
          {!player ? <div className="rwpb-placeholder">This video URL is not a YouTube, Vimeo or video file link.</div>
            : playing && mode === 'view'
              ? (player.kind === 'video'
                ? <video key={player.src} src={player.src} controls autoPlay playsInline onEnded={() => node.settings.autoNext && active < items.length - 1 && setActive(active + 1)} />
                : <iframe key={player.src} src={player.src} title={current.title || 'Video'} allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowFullScreen />)
              : (
                <button type="button" className="rwpb-video-overlay" aria-label={`Play ${current.title || 'video'}`} onClick={() => mode === 'view' && setPlaying(true)}
                  style={poster ? { backgroundImage: `url("${poster.replace(/"/g, '%22')}")` } : undefined}>
                  <span className="rwpb-video-play"><Icon name="play" size={34} /></span>
                </button>
              )}
        </div>
        <div className="rwpb-playlist-list">
          {heading && <p className="rwpb-playlist-heading">{heading} <span>{items.length} videos</span></p>}
          <ol>
            {items.map((item, index) => {
              const thumb = safeMediaUrl(item.thumbnail) || videoThumb(item.url);
              return (
                <li key={item.id || index}>
                  <button type="button" className="rwpb-playlist-item" aria-current={index === active} onClick={() => select(index)}>
                    {Boolean(node.settings.showNumbers) && <span className="rwpb-playlist-number">{index + 1}</span>}
                    {thumb && <img src={thumb} alt="" loading="lazy" />}
                    <span className="rwpb-playlist-title">{item.title || `Video ${index + 1}`}</span>
                    {item.duration && <span className="rwpb-playlist-duration">{item.duration}</span>}
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    );
  },
};

// Testimonial Carousel -----------------------------------------------------------------------------------------------

interface TestimonialItem { id: string; content: string; image?: string; name: string; title?: string; rating?: number }

const sampleTestimonial = (name: string): TestimonialItem => ({ id: itemId(), content: 'I am slide content. Click edit to change this text. Lorem ipsum dolor sit amet, consectetur adipiscing elit.', name, title: 'Customer', rating: 5 });

export const testimonialCarousel: WidgetDefinition = {
  type: 'testimonial-carousel',
  label: 'Testimonial Carousel',
  icon: 'testimonial',
  category: 'pro',
  keywords: ['reviews', 'quotes', 'slider', 'customers'],
  defaults: () => ({ settings: { items: [sampleTestimonial('John Doe'), sampleTestimonial('Jane Smith'), sampleTestimonial('Alex Lee')], skin: 'bubble', arrows: true, dots: true, scrollBy: 'one' }, style: { perView: 1, gap: 24 } }),
  controls: [
    { key: 'items', label: 'Testimonials', type: 'repeater', itemLabel: 'name', newItem: () => sampleTestimonial('New name') as unknown as Record<string, unknown>, fields: [
      { key: 'content', label: 'Content', type: 'textarea' },
      { key: 'image', label: 'Image', type: 'image' },
      { key: 'name', label: 'Name', type: 'text' },
      { key: 'title', label: 'Title', type: 'text' },
      { key: 'rating', label: 'Rating (0 hides it)', type: 'slider', min: 0, max: 5, step: 0.5 },
    ] },
    { key: 'skin', label: 'Skin', type: 'select', options: opts(['default', 'Default'], ['bubble', 'Bubble']) },
    ...carouselControls({ perViewMax: 4 }),
    alignControl(),
    colorControl('cardBg', 'Card / bubble background'),
    colorControl('contentColor', 'Content colour'),
    typographyControl('contentTypography', 'Content typography'),
    colorControl('nameColor', 'Name colour'),
    colorControl('starColor', 'Star colour'),
  ],
  css: (bag) => ({
    ...carouselCss(bag, 1),
    ' .rwpb-tcard': { ...alignCss(bag), '--rwpb-tcard-bg': color(bag.cardBg) },
    ' .rwpb-tcard-footer': { 'justify-content': alignToFlex(bag.align) },
    ' .rwpb-tcard-content': { color: color(bag.contentColor), ...typography(bag.contentTypography as Typography | undefined) },
    ' .rwpb-tcard-name': { color: color(bag.nameColor) },
    ' .rwpb-stars': { '--rwpb-star-color': color(bag.starColor) },
  }),
  View: function TestimonialCarouselView({ node }) {
    const items = listOf<TestimonialItem>(node.settings.items);
    if (!items.length) return <EditorPlaceholder>Add testimonials in the Content tab.</EditorPlaceholder>;
    const skin = node.settings.skin === 'bubble' ? 'bubble' : 'default';
    const slides = items.map((item, index) => {
      const image = safeMediaUrl(item.image);
      return (
        <figure key={item.id || index} className={`rwpb-tcard rwpb-tcard-${skin}`}>
          <blockquote className="rwpb-tcard-content">
            {num(item.rating, 0) > 0 && <Stars value={clamp(num(item.rating, 0), 0, 5)} />}
            <p>{item.content}</p>
          </blockquote>
          <figcaption className="rwpb-tcard-footer">
            {image && <img src={image} alt="" loading="lazy" />}
            <span><strong className="rwpb-tcard-name">{item.name}</strong>{item.title && <span className="rwpb-tcard-title">{item.title}</span>}</span>
          </figcaption>
        </figure>
      );
    });
    return <Carousel slides={slides} options={carouselOptions(node.settings)} label="Testimonials" />;
  },
};

// Reviews ------------------------------------------------------------------------------------------------------------------

interface ReviewItem { id: string; name: string; handle?: string; image?: string; rating?: number; content: string; source?: string; link?: unknown }

const sampleReview = (name: string): ReviewItem => ({ id: itemId(), name, handle: '@username', rating: 5, content: 'Great product and even better support. Would recommend it to anyone!', source: 'x' });

export const reviews: WidgetDefinition = {
  type: 'reviews',
  label: 'Reviews',
  icon: 'star',
  category: 'pro',
  keywords: ['ratings', 'social proof', 'testimonials', 'carousel'],
  defaults: () => ({ settings: { items: [sampleReview('Jane Doe'), sampleReview('John Smith'), sampleReview('Sam Park'), sampleReview('Lee Wong')], arrows: true, dots: true, scrollBy: 'one' }, style: { perView: 3, gap: 20 } }),
  controls: [
    { key: 'items', label: 'Reviews', type: 'repeater', itemLabel: 'name', newItem: () => sampleReview('Reviewer') as unknown as Record<string, unknown>, fields: [
      { key: 'name', label: 'Name', type: 'text' },
      { key: 'handle', label: 'Title or handle', type: 'text' },
      { key: 'image', label: 'Image', type: 'image' },
      { key: 'rating', label: 'Rating', type: 'slider', min: 0, max: 5, step: 0.5 },
      { key: 'content', label: 'Review', type: 'textarea' },
      { key: 'source', label: 'Source icon', type: 'select', options: opts(['', 'None'], ['x', 'X'], ['facebook', 'Facebook'], ['instagram', 'Instagram'], ['linkedin', 'LinkedIn'], ['youtube', 'YouTube'], ['google', 'Google']) },
      linkControl('link', 'Link to the original review'),
    ] },
    ...carouselControls({ perViewMax: 4 }),
    colorControl('cardBg', 'Card background'),
    { key: 'cardBorder', label: 'Card border', type: 'border', tab: 'style' },
    colorControl('nameColor', 'Name colour'),
    colorControl('contentColor', 'Content colour'),
    typographyControl('contentTypography', 'Content typography'),
    colorControl('starColor', 'Star colour'),
  ],
  css: (bag) => ({
    ...carouselCss(bag, 3),
    ' .rwpb-review': { 'background-color': color(bag.cardBg), ...border(bag.cardBorder as Border | undefined) },
    ' .rwpb-review-name': { color: color(bag.nameColor) },
    ' .rwpb-review-content': { color: color(bag.contentColor), ...typography(bag.contentTypography as Typography | undefined) },
    ' .rwpb-stars': { '--rwpb-star-color': color(bag.starColor) },
  }),
  View: function ReviewsView({ node }) {
    const { dynamic } = useRenderContext();
    const items = listOf<ReviewItem>(node.settings.items);
    if (!items.length) return <EditorPlaceholder>Add reviews in the Content tab.</EditorPlaceholder>;
    const slides = items.map((item, index) => {
      const image = safeMediaUrl(item.image);
      const link = linkAttributes(item.link, dynamic);
      const source = item.source === 'google' ? 'globe' : item.source || '';
      return (
        <article key={item.id || index} className="rwpb-review">
          <header className="rwpb-review-header">
            {image ? <img src={image} alt="" loading="lazy" /> : <span className="rwpb-review-initial" aria-hidden="true">{(item.name || '?').charAt(0)}</span>}
            <span className="rwpb-review-who">
              <strong className="rwpb-review-name">{item.name}</strong>
              {item.handle && <span className="rwpb-review-handle">{item.handle}</span>}
            </span>
            {source && (link ? <a className="rwpb-review-source" {...link} aria-label={`Read on ${item.source}`}><Icon name={source} size={18} /></a> : <span className="rwpb-review-source" aria-hidden="true"><Icon name={source} size={18} /></span>)}
          </header>
          {num(item.rating, 0) > 0 && <Stars value={clamp(num(item.rating, 0), 0, 5)} />}
          <p className="rwpb-review-content">{item.content}</p>
        </article>
      );
    });
    return <Carousel slides={slides} options={carouselOptions(node.settings)} label="Reviews" />;
  },
};

// Media Carousel ------------------------------------------------------------------------------------------------------------

interface MediaItem { id: string; mediaType?: string; image?: string; video?: string; caption?: string }

export const mediaCarousel: WidgetDefinition = {
  type: 'media-carousel',
  label: 'Media Carousel',
  icon: 'square-play',
  category: 'pro',
  keywords: ['slider', 'video', 'images', 'lightbox', 'thumbnails'],
  defaults: () => ({ settings: { items: [], skin: 'carousel', lightbox: true, arrows: true, dots: false, scrollBy: 'one' }, style: { perView: 3, gap: 12 } }),
  controls: [
    { key: 'items', label: 'Slides', type: 'repeater', itemLabel: 'caption', newItem: () => ({ id: itemId(), mediaType: 'image' }), fields: [
      { key: 'mediaType', label: 'Type', type: 'select', options: opts(['image', 'Image'], ['video', 'Video']) },
      { key: 'image', label: 'Image (the video poster for videos)', type: 'image' },
      { key: 'video', label: 'Video URL (YouTube, Vimeo or MP4)', type: 'text' },
      { key: 'caption', label: 'Caption', type: 'text' },
    ] },
    { key: 'skin', label: 'Skin', type: 'select', options: opts(['carousel', 'Carousel'], ['slideshow', 'Slideshow with thumbnails']) },
    { key: 'lightbox', label: 'Open in a lightbox on click', type: 'toggle' },
    { key: 'imageRatio', label: 'Slide ratio', type: 'select', options: opts(['4/3', '4:3'], ['16/9', '16:9'], ['1/1', '1:1'], ['3/4', '3:4']) },
    ...carouselControls(),
    { key: 'slideRadius', label: 'Corner radius (px)', type: 'slider', tab: 'style', min: 0, max: 40 },
  ],
  css: (bag, node) => ({
    ...carouselCss(node.settings.skin === 'slideshow' ? { ...bag, perView: 1 } : bag, 3),
    ' .rwpb-media-slide': { 'border-radius': length(bag.slideRadius, 'px') },
  }),
  View: function MediaCarouselView({ node }) {
    const items = listOf<MediaItem>(node.settings.items).filter((item) => item && (item.image || item.video));
    const lightboxItems = useMemo<LightboxItem[]>(() => items.map((item) => {
      const video = item.mediaType === 'video' && item.video ? embedUrl(item.video, true) : null;
      return { src: safeMediaUrl(item.image) || videoThumb(item.video || ''), caption: item.caption, video: video?.kind === 'iframe' ? video.src : undefined };
    }), [items]);
    const lightbox = useGalleryLightbox(lightboxItems);
    const [index, setIndex] = useState(0);
    const onIndex = useCallback((value: number) => setIndex(value), []);
    if (!items.length) return <EditorPlaceholder>Add images or videos in the Content tab.</EditorPlaceholder>;
    const ratio = str(node.settings.imageRatio, '4/3');
    const slideshow = node.settings.skin === 'slideshow';
    const slides = items.map((item, slideIndex) => {
      const poster = lightboxItems[slideIndex].src;
      const isVideo = item.mediaType === 'video';
      const inner = (
        <>
          {poster ? <img src={poster} alt={item.caption || ''} loading="lazy" /> : <span className="rwpb-media-empty" />}
          {isVideo && <span className="rwpb-video-play"><Icon name="play" size={28} /></span>}
          {item.caption && <span className="rwpb-media-caption">{item.caption}</span>}
        </>
      );
      return node.settings.lightbox
        ? <button type="button" className="rwpb-media-slide" style={{ aspectRatio: ratio }} aria-label={item.caption || `Open slide ${slideIndex + 1}`} onClick={() => lightbox.open(slideIndex)}>{inner}</button>
        : <div className="rwpb-media-slide" style={{ aspectRatio: ratio }}>{inner}</div>;
    });
    return (
      <div className={`rwpb-media-carousel rwpb-media-${slideshow ? 'slideshow' : 'carousel'}`}>
        <Carousel key={slideshow ? 'slideshow' : 'carousel'} slides={slides} options={carouselOptions(node.settings)} label="Media carousel" onIndexChange={onIndex} />
        {slideshow && (
          <div className="rwpb-media-thumbs" role="group" aria-label="Thumbnails">
            {items.map((item, thumbIndex) => (
              <span key={item.id || thumbIndex} className={`rwpb-media-thumb${thumbIndex === index ? ' is-active' : ''}`} aria-hidden="true">
                {lightboxItems[thumbIndex].src && <img src={lightboxItems[thumbIndex].src} alt="" loading="lazy" />}
              </span>
            ))}
          </div>
        )}
        {lightbox.element}
      </div>
    );
  },
};

// Carousel (content slides or templates) ---------------------------------------------------------------------------------------

interface ContentSlide { id: string; templateId?: string; image?: string; title?: string; text?: string; buttonText?: string; link?: unknown }

export const contentCarousel: WidgetDefinition = {
  type: 'carousel',
  label: 'Carousel',
  icon: 'gallery-thumbnails',
  category: 'pro',
  keywords: ['slider', 'cards', 'nested carousel', 'templates'],
  defaults: () => ({
    settings: {
      slides: [1, 2, 3, 4].map((number) => ({ id: itemId(), title: `Slide #${number}`, text: 'Add a short description for this slide.', buttonText: 'Learn more', link: { url: '#' } })),
      arrows: true, dots: true, scrollBy: 'one', titleTag: 'h3',
    },
    style: { perView: 3, gap: 20 },
  }),
  controls: [
    { key: 'slides', label: 'Slides', type: 'repeater', itemLabel: 'title', newItem: () => ({ id: itemId(), title: 'New slide', text: '' }), fields: [
      { key: 'templateId', label: 'Saved template', type: 'asyncSelect', loadOptions: templateOptions, placeholder: '— None: use the fields below —', help: 'A template lets a slide hold any layout. It replaces the fields below.' },
      { key: 'image', label: 'Image', type: 'image' },
      { key: 'title', label: 'Title', type: 'text', dynamic: true },
      { key: 'text', label: 'Text', type: 'textarea', dynamic: true },
      { key: 'buttonText', label: 'Button text', type: 'text' },
      linkControl(),
    ] },
    { key: 'titleTag', label: 'Title HTML tag', type: 'select', options: headingTags },
    ...carouselControls(),
    alignControl(),
    colorControl('cardBg', 'Slide background'),
    { key: 'cardBorder', label: 'Slide border', type: 'border', tab: 'style' },
    colorControl('titleColor', 'Title colour'),
    typographyControl('titleTypography', 'Title typography'),
    colorControl('textColor', 'Text colour'),
  ],
  css: (bag) => ({
    ...carouselCss(bag, 3),
    ' .rwpb-slide-card': { ...alignCss(bag), 'background-color': color(bag.cardBg), ...border(bag.cardBorder as Border | undefined) },
    ' .rwpb-slide-card-body': { 'align-items': alignToFlex(bag.align) },
    ' .rwpb-slide-card-title': { color: color(bag.titleColor), ...typography(bag.titleTypography as Typography | undefined) },
    ' .rwpb-slide-card-text': { color: color(bag.textColor) },
  }),
  View: function ContentCarouselView({ node }) {
    const { dynamic, mode } = useRenderContext();
    const items = listOf<ContentSlide>(node.settings.slides);
    if (!items.length) return <EditorPlaceholder>Add slides in the Content tab.</EditorPlaceholder>;
    const TitleTag = headingTag(node.settings.titleTag);
    const text = (value: unknown) => (mode === 'edit' ? str(value) : resolveText(value, dynamic));
    const slides = items.map((slide, index) => {
      if (slide.templateId) return <TemplateContent key={slide.id || index} templateId={slide.templateId} css={items.findIndex((item) => item.templateId === slide.templateId) === index} />;
      const image = safeMediaUrl(slide.image);
      const link = linkAttributes(slide.link, dynamic);
      return (
        <div key={slide.id || index} className="rwpb-slide-card">
          {image && <img className="rwpb-slide-card-image" src={image} alt="" loading="lazy" />}
          <div className="rwpb-slide-card-body">
            {slide.title && <TitleTag className="rwpb-slide-card-title">{text(slide.title)}</TitleTag>}
            {slide.text && <p className="rwpb-slide-card-text">{text(slide.text)}</p>}
            {slide.buttonText && (link ? <a className="rwpb-button rwpb-button-sm" {...link}>{slide.buttonText}</a> : <span className="rwpb-button rwpb-button-sm">{slide.buttonText}</span>)}
          </div>
        </div>
      );
    });
    return <Carousel slides={slides} options={carouselOptions(node.settings)} label="Carousel" />;
  },
};

// Gallery (filterable, masonry, justified) ----------------------------------------------------------------------------------------

interface GallerySet { id: string; title: string; images?: string[] }

export const gallery: WidgetDefinition = {
  type: 'gallery',
  label: 'Gallery',
  icon: 'images',
  category: 'pro',
  keywords: ['portfolio', 'masonry', 'justified', 'filterable', 'photos'],
  defaults: () => ({ settings: { galleries: [{ id: itemId(), title: 'New gallery', images: [] }], layout: 'masonry', filter: true, allLabel: 'All', overlay: 'zoom' }, style: { columns: 3, gap: 10, rowHeight: 220 } }),
  controls: [
    { key: 'galleries', label: 'Galleries', type: 'repeater', itemLabel: 'title', newItem: () => ({ id: itemId(), title: 'New gallery', images: [] }), fields: [
      { key: 'title', label: 'Title (the filter label)', type: 'text' },
      { key: 'images', label: 'Images', type: 'gallery' },
    ] },
    { key: 'layout', label: 'Layout', type: 'select', options: opts(['grid', 'Grid'], ['masonry', 'Masonry'], ['justified', 'Justified']) },
    { key: 'columns', label: 'Columns', type: 'slider', store: 'style', responsive: true, min: 1, max: 8, condition: (settings) => settings.layout !== 'justified' },
    { key: 'rowHeight', label: 'Row height (px)', type: 'slider', store: 'style', responsive: true, min: 80, max: 500, condition: (settings) => settings.layout === 'justified' },
    { key: 'imageRatio', label: 'Image ratio', type: 'select', options: opts(['1/1', '1:1'], ['4/3', '4:3'], ['3/2', '3:2'], ['16/9', '16:9'], ['3/4', '3:4']), condition: (settings) => settings.layout === 'grid' },
    { key: 'filter', label: 'Filter bar', type: 'toggle', help: 'Shown when there is more than one gallery.' },
    { key: 'allLabel', label: '"All" label', type: 'text', condition: (settings) => Boolean(settings.filter) },
    { key: 'overlay', label: 'Hover effect', type: 'select', options: opts(['zoom', 'Zoom'], ['grayscale', 'Greyscale to colour'], ['darken', 'Darken'], ['none', 'None']) },
    { key: 'lightbox', label: 'Open in a lightbox', type: 'toggle' },
    { key: 'gap', label: 'Gap (px)', type: 'slider', tab: 'style', responsive: true, min: 0, max: 60 },
    { key: 'imageRadius', label: 'Corner radius (px)', type: 'slider', tab: 'style', min: 0, max: 40 },
    colorControl('filterColor', 'Filter colour'),
    colorControl('filterActive', 'Active filter colour'),
    typographyControl('filterTypography', 'Filter typography'),
  ],
  css: (bag) => ({
    ' .rwpb-pro-gallery': { '--rwpb-gallery-gap': length(bag.gap ?? 10, 'px'), '--rwpb-gallery-columns': clamp(Math.round(num(bag.columns, 3)), 1, 8), '--rwpb-gallery-row': length(bag.rowHeight ?? 220, 'px') },
    ' .rwpb-gallery-tile': { 'border-radius': length(bag.imageRadius, 'px') },
    ' .rwpb-filter-bar button': { color: color(bag.filterColor), ...typography(bag.filterTypography as Typography | undefined) },
    ' .rwpb-filter-bar button[aria-pressed=true]': { color: color(bag.filterActive), 'border-color': color(bag.filterActive) },
  }),
  View: function GalleryView({ node }) {
    const galleries = listOf<GallerySet>(node.settings.galleries).map((set) => ({ ...set, images: listOf<string>(set.images).filter((url) => typeof url === 'string' && url) }));
    const [filter, setFilter] = useState('');
    const tiles = galleries.flatMap((set) => set.images.map((src) => ({ src, set: set.id, title: set.title })))
      .filter((tile) => !filter || tile.set === filter);
    const lightbox = useGalleryLightbox(tiles.map((tile) => ({ src: tile.src, caption: tile.title })));
    if (!galleries.some((set) => set.images.length)) return <EditorPlaceholder>Add images to a gallery in the Content tab.</EditorPlaceholder>;
    const layout = pick(node.settings.layout, ['grid', 'masonry', 'justified'] as const, 'masonry');
    const ratio = str(node.settings.imageRatio, '1/1');
    const lightboxOn = node.settings.lightbox !== false;
    return (
      <div className={`rwpb-pro-gallery rwpb-gallery-${layout} rwpb-gallery-hover-${str(node.settings.overlay, 'zoom')}`}>
        {Boolean(node.settings.filter) && galleries.length > 1 && (
          <div className="rwpb-filter-bar" role="group" aria-label="Filter gallery">
            <button type="button" aria-pressed={!filter} onClick={() => setFilter('')}>{str(node.settings.allLabel, 'All')}</button>
            {galleries.map((set) => <button key={set.id} type="button" aria-pressed={filter === set.id} onClick={() => setFilter(set.id)}>{set.title}</button>)}
          </div>
        )}
        <div className="rwpb-gallery-tiles">
          {tiles.map((tile, index) => {
            const img = <img src={tile.src} alt="" loading="lazy" style={layout === 'grid' ? { aspectRatio: ratio } : undefined} />;
            return lightboxOn
              ? <button key={`${tile.set}-${tile.src}-${index}`} type="button" className="rwpb-gallery-tile" aria-label={`Enlarge image ${index + 1}`} onClick={() => lightbox.open(index)}>{img}</button>
              : <div key={`${tile.set}-${tile.src}-${index}`} className="rwpb-gallery-tile">{img}</div>;
          })}
        </div>
        {lightbox.element}
      </div>
    );
  },
};

// Off-Canvas ------------------------------------------------------------------------------------------------------------------------

export const offCanvas: WidgetDefinition = {
  type: 'off-canvas',
  label: 'Off-Canvas',
  icon: 'panel-left',
  category: 'pro',
  keywords: ['drawer', 'slide out', 'panel', 'popup', 'sidebar menu'],
  defaults: () => ({ settings: { triggerText: 'Open panel', triggerIcon: 'menu', showTrigger: true, source: 'text', content: '<h3>Panel title</h3><p>Put anything here, or show a saved template.</p>', position: 'left', overlay: true, anchor: '' } }),
  controls: [
    { key: 'showTrigger', label: 'Show a trigger button', type: 'toggle' },
    { key: 'triggerText', label: 'Button text', type: 'text', dynamic: true, condition: (settings) => Boolean(settings.showTrigger) },
    { key: 'triggerIcon', label: 'Button icon', type: 'icon', condition: (settings) => Boolean(settings.showTrigger) },
    { key: 'anchor', label: 'Also open from links to #', type: 'text', placeholder: 'menu-panel', help: 'Any link to #menu-panel on this page (a menu item, a button) opens the panel.' },
    { key: 'source', label: 'Content', type: 'select', options: opts(['text', 'Text editor'], ['template', 'Saved template']) },
    { key: 'content', label: 'Panel content', type: 'richtext', condition: (settings) => settings.source !== 'template' },
    { key: 'templateId', label: 'Template', type: 'asyncSelect', loadOptions: templateOptions, condition: (settings) => settings.source === 'template' },
    { key: 'position', label: 'Opens from', type: 'select', options: opts(['left', 'Left'], ['right', 'Right'], ['top', 'Top'], ['bottom', 'Bottom']) },
    { key: 'overlay', label: 'Dim the page behind', type: 'toggle' },
    { key: 'panelSize', label: 'Panel width / height (px)', type: 'number', tab: 'style', min: 160, max: 1400, help: 'Width for left/right, height for top/bottom. Never wider than the screen.' },
    { key: 'panelBg', label: 'Panel background', type: 'color', tab: 'style' },
    { key: 'panelColor', label: 'Panel text colour', type: 'color', tab: 'style' },
    { key: 'panelPadding', label: 'Panel padding (px)', type: 'number', tab: 'style', min: 0, max: 120 },
    alignControl(),
    colorControl('buttonText', 'Button text colour'),
    colorControl('buttonBg', 'Button background'),
  ],
  css: (bag) => ({
    '': alignCss(bag),
    ' .rwpb-offcanvas-trigger': { color: color(bag.buttonText), 'background-color': color(bag.buttonBg) },
  }),
  View: function OffCanvasView({ node }) {
    const { mode } = useRenderContext();
    const settings = node.settings;
    const [open, setOpen] = useState(false);
    const triggerText = useText(settings.triggerText);
    const panelRef = useRef<HTMLDivElement>(null);
    const returnFocus = useRef<HTMLElement | null>(null);
    const titleId = useId();
    const anchor = str(settings.anchor).trim().replace(/^#/, '').replace(/[^\w-]/g, '');
    const position = pick(settings.position, ['left', 'right', 'top', 'bottom'] as const, 'left');

    const show = useCallback(() => {
      returnFocus.current = document.activeElement as HTMLElement | null;
      setOpen(true);
    }, []);
    const hide = useCallback(() => {
      setOpen(false);
      returnFocus.current?.focus?.();
    }, []);

    useEffect(() => {
      if (mode !== 'view' || !anchor) return undefined;
      const onClick = (event: MouseEvent) => {
        const link = (event.target as HTMLElement).closest?.('a[href]');
        if (link && link.getAttribute('href') === `#${anchor}`) { event.preventDefault(); show(); }
      };
      document.addEventListener('click', onClick);
      if (window.location.hash === `#${anchor}`) show();
      return () => document.removeEventListener('click', onClick);
    }, [mode, anchor, show]);

    useEffect(() => {
      if (!open) return undefined;
      const panel = panelRef.current;
      panel?.focus();
      const overflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      const onKey = (event: KeyboardEvent) => {
        if (event.key === 'Escape') hide();
        // Keep Tab inside the panel while it is open.
        if (event.key === 'Tab' && panel) {
          const focusable = panel.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])');
          if (!focusable.length) { event.preventDefault(); return; }
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
      };
      document.addEventListener('keydown', onKey);
      return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; };
    }, [open, hide]);

    // The panel is portalled outside this widget's CSS scope, so its style values are applied inline.
    const desktop = node.style?.desktop || {};
    const horizontal = position === 'left' || position === 'right';
    const panelSize = clamp(num(desktop.panelSize, horizontal ? 360 : 320), 160, 1400);
    const panelStyle: CSSProperties = {
      [horizontal ? 'width' : 'height']: `min(${panelSize}px, 100${horizontal ? 'vw' : 'vh'})`,
      background: color(desktop.panelBg),
      color: color(desktop.panelColor),
      padding: `${clamp(num(desktop.panelPadding, 28), 0, 120)}px`,
    };

    const body = settings.source === 'template'
      ? <TemplateContent templateId={str(settings.templateId)} />
      : <ContentRenderer className="rwpb-text" html={str(settings.content)} />;

    return (
      <>
        {settings.showTrigger !== false ? (
          <button type="button" className="rwpb-button rwpb-button-md rwpb-offcanvas-trigger" aria-expanded={open} aria-haspopup="dialog" onClick={show}>
            {str(settings.triggerIcon) && <Icon name={str(settings.triggerIcon)} size="1.1em" />}
            {triggerText}
          </button>
        ) : mode === 'edit' && (
          <button type="button" className="rwpb-placeholder rwpb-offcanvas-hint" onClick={show}>Off-canvas panel{anchor ? ` (opens from links to #${anchor})` : ''}. Click to preview.</button>
        )}
        {open && createPortal(
          // A second .rwpb-root: the panel is portalled out of the page, and builder styles are scoped to it.
          <div className={`rwpb-root rwpb-offcanvas rwpb-offcanvas-${position}${settings.overlay !== false ? ' has-overlay' : ''}`}>
            <div className="rwpb-offcanvas-backdrop" onClick={hide} aria-hidden="true" />
            <div ref={panelRef} className="rwpb-offcanvas-panel" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} style={panelStyle}>
              <span id={titleId} className="rwpb-sr-only">{triggerText || 'Panel'}</span>
              <button type="button" className="rwpb-offcanvas-close" aria-label="Close panel" onClick={hide}>×</button>
              {body}
            </div>
          </div>,
          document.body,
        )}
      </>
    );
  },
};

// Search ---------------------------------------------------------------------------------------------------------------------------

export const search: WidgetDefinition = {
  type: 'search',
  label: 'Search',
  icon: 'search',
  category: 'pro',
  keywords: ['find', 'search form', 'live search'],
  defaults: () => ({ settings: { placeholder: 'Search…', skin: 'classic', buttonType: 'icon', buttonText: 'Search', target: 'posts', liveResults: true, liveCount: 5 } }),
  controls: [
    { key: 'skin', label: 'Skin', type: 'select', options: opts(['classic', 'Classic'], ['minimal', 'Minimal'], ['full-screen', 'Full screen (icon opens it)']) },
    { key: 'placeholder', label: 'Placeholder', type: 'text' },
    { key: 'buttonType', label: 'Button', type: 'select', options: opts(['icon', 'Icon'], ['text', 'Text']), condition: (settings) => settings.skin === 'classic' },
    { key: 'buttonText', label: 'Button text', type: 'text', condition: (settings) => settings.skin === 'classic' && settings.buttonType === 'text' },
    { key: 'target', label: 'Search in', type: 'select', options: opts(['posts', 'Posts (the blog)'], ['shop', 'Shop products']) },
    { key: 'liveResults', label: 'Show results while typing', type: 'toggle', condition: (settings) => settings.target !== 'shop' },
    { key: 'liveCount', label: 'Number of live results', type: 'number', min: 1, max: 12, condition: (settings) => Boolean(settings.liveResults) && settings.target !== 'shop' },
    { key: 'inputHeight', label: 'Height (px)', type: 'slider', tab: 'style', min: 30, max: 80 },
    colorControl('inputBg', 'Field background'),
    colorControl('inputColor', 'Field text colour'),
    { key: 'inputBorder', label: 'Field border', type: 'border', tab: 'style' },
    colorControl('buttonColor', 'Button colour'),
    colorControl('buttonBg', 'Button background'),
    typographyControl('inputTypography', 'Field typography'),
  ],
  css: (bag) => ({
    ' .rwpb-search-form': { height: length(bag.inputHeight, 'px'), 'background-color': color(bag.inputBg), ...border(bag.inputBorder as Border | undefined) },
    ' .rwpb-search-input': { color: color(bag.inputColor), ...typography(bag.inputTypography as Typography | undefined) },
    ' .rwpb-search-submit': { color: color(bag.buttonColor), 'background-color': color(bag.buttonBg) },
  }),
  View: function SearchView({ node }) {
    const { mode } = useRenderContext();
    const settings = node.settings;
    const [term, setTerm] = useState('');
    const [results, setResults] = useState<Array<{ id: number; title: string; slug: string }> | null>(null);
    const [expanded, setExpanded] = useState(false);
    const inputId = useId();
    const listId = useId();
    const shop = settings.target === 'shop';
    const live = Boolean(settings.liveResults) && !shop && mode === 'view';
    const skin = pick(settings.skin, ['classic', 'minimal', 'full-screen'] as const, 'classic');

    useEffect(() => {
      if (!live || term.trim().length < 2) { setResults(null); return undefined; }
      let active = true;
      const timer = window.setTimeout(() => {
        fetchPosts({ limit: clamp(num(settings.liveCount, 5), 1, 12), page: 1, orderBy: 'created_at', order: 'desc', search: term }, 10)
          .then((result) => active && setResults(result.posts))
          .catch(() => active && setResults([]));
      }, 250);
      return () => { active = false; window.clearTimeout(timer); };
    }, [live, term, settings.liveCount]);

    const submit = (event: FormEvent) => {
      event.preventDefault();
      if (mode === 'edit' || !term.trim()) return;
      window.location.href = shop ? `/shop?s=${encodeURIComponent(term.trim())}` : `/search?s=${encodeURIComponent(term.trim())}`;
    };

    const form = (
      <form role="search" className={`rwpb-search-form rwpb-search-${skin}`} onSubmit={submit}>
        <label htmlFor={inputId} className="rwpb-sr-only">{shop ? 'Search products' : 'Search posts'}</label>
        {skin === 'minimal' && <Icon name="search" size={18} className="rwpb-search-glyph" />}
        <input id={inputId} className="rwpb-search-input" type="search" value={term} placeholder={str(settings.placeholder, 'Search…')} autoComplete="off"
          aria-controls={results ? listId : undefined} aria-expanded={live ? Boolean(results) : undefined}
          onChange={(event) => setTerm(event.target.value)} autoFocus={skin === 'full-screen' && expanded} />
        {skin !== 'minimal' && (
          <button type="submit" className="rwpb-search-submit" aria-label="Search">
            {settings.buttonType === 'text' && skin === 'classic' ? str(settings.buttonText, 'Search') : <Icon name="search" size={18} />}
          </button>
        )}
      </form>
    );
    const liveList = results && (
      <ul id={listId} className="rwpb-search-results" aria-live="polite">
        {results.length === 0 ? <li className="rwpb-search-none">No posts found.</li> : results.map((post) => <li key={post.id}><a href={`/${post.slug}`}>{post.title}</a></li>)}
        {results.length > 0 && <li className="rwpb-search-all"><a href={`/search?s=${encodeURIComponent(term.trim())}`}>See all results →</a></li>}
      </ul>
    );

    if (skin === 'full-screen') {
      return (
        <>
          <button type="button" className="rwpb-search-toggle" aria-label="Open search" aria-expanded={expanded} onClick={() => mode === 'view' && setExpanded(true)}><Icon name="search" size={22} /></button>
          {expanded && createPortal(
            <div className="rwpb-root rwpb-search-overlay" role="dialog" aria-modal="true" aria-label="Search"
              onKeyDown={(event) => { if (event.key === 'Escape') setExpanded(false); }}>
              <button type="button" className="rwpb-lightbox-close" aria-label="Close search" onClick={() => setExpanded(false)}>×</button>
              <div className="rwpb-search-overlay-inner">{form}{liveList}</div>
            </div>,
            document.body,
          )}
        </>
      );
    }
    return <div className="rwpb-search">{form}{liveList}</div>;
  },
};

// Login ------------------------------------------------------------------------------------------------------------------------------

export const loginForm: WidgetDefinition = {
  type: 'login',
  label: 'Login',
  icon: 'log-in',
  category: 'pro',
  keywords: ['sign in', 'account', 'members', 'user'],
  defaults: () => ({ settings: { showLabels: true, buttonText: 'Log in', showLostPassword: true, showRegister: true, redirect: '', loggedInMessage: true } }),
  controls: [
    { key: 'showLabels', label: 'Show labels', type: 'toggle' },
    { key: 'buttonText', label: 'Button text', type: 'text' },
    { key: 'redirect', label: 'Redirect after login', type: 'text', placeholder: 'Stay on this page', help: 'A path such as /my-account. Empty reloads this page.' },
    { key: 'showLostPassword', label: '"Lost your password?" link', type: 'toggle' },
    { key: 'showRegister', label: '"Register" link', type: 'toggle', help: 'Shown only when Settings → Site allows registration.' },
    { key: 'loggedInMessage', label: 'When signed in, show "Logged in as …"', type: 'toggle', help: 'When off, the widget disappears for signed-in visitors.' },
    alignControl('buttonAlign', 'Button alignment', true),
    { key: 'fieldGap', label: 'Space between fields (px)', type: 'slider', tab: 'style', min: 0, max: 40 },
    colorControl('labelColor', 'Label colour'),
    colorControl('fieldBg', 'Field background'),
    { key: 'fieldBorder', label: 'Field border', type: 'border', tab: 'style' },
    colorControl('buttonColor', 'Button text colour'),
    colorControl('buttonBg', 'Button background'),
  ],
  css: (bag) => ({
    ' .rwpb-form': { gap: length(bag.fieldGap ?? 14, 'px') },
    ' .rwpb-form label': { color: color(bag.labelColor) },
    ' .rwpb-form-control': { 'background-color': color(bag.fieldBg), ...border(bag.fieldBorder as Border | undefined) },
    ' .rwpb-form-actions': { 'justify-content': bag.buttonAlign === 'center' ? 'center' : bag.buttonAlign === 'right' ? 'flex-end' : undefined },
    ' .rwpb-form-submit': { width: bag.buttonAlign === 'justify' ? '100%' : undefined, color: color(bag.buttonColor), 'background-color': color(bag.buttonBg) },
  }),
  View: function LoginView({ node }) {
    const { mode } = useRenderContext();
    const settings = node.settings;
    const uid = useId();
    const [session, setSession] = useState<{ email: string } | null | undefined>(undefined);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [status, setStatus] = useState<{ busy: boolean; error: string }>({ busy: false, error: '' });
    const [canRegister, setCanRegister] = useState(false);

    useEffect(() => {
      const supabase = getSupabaseClient();
      let active = true;
      void supabase.auth.getSession().then(({ data }) => active && setSession(data.session?.user ? { email: data.session.user.email || '' } : null));
      void supabase.from('options').select('option_value').eq('option_name', 'users_can_register').maybeSingle()
        .then(({ data }) => active && setCanRegister(!data || data.option_value === 'true' || data.option_value === '1'));
      const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => active && setSession(next?.user ? { email: next.user.email || '' } : null));
      return () => { active = false; listener.subscription.unsubscribe(); };
    }, []);

    const submit = async (event: FormEvent) => {
      event.preventDefault();
      if (mode === 'edit') return;
      setStatus({ busy: true, error: '' });
      const { error } = await getSupabaseClient().auth.signInWithPassword({ email: email.trim(), password });
      if (error) {
        setStatus({ busy: false, error: /invalid login credentials/i.test(error.message) ? 'The email or password is incorrect.' : /email not confirmed/i.test(error.message) ? 'Confirm your email address first: open the link in the email we sent you.' : error.message });
        return;
      }
      const redirect = safeUrl(settings.redirect);
      if (redirect && redirect !== '#') window.location.href = redirect; else window.location.reload();
    };

    if (session === undefined) return null;
    if (session && mode === 'view') {
      if (!settings.loggedInMessage) return null;
      return (
        <p className="rwpb-login-status">
          You are logged in as <strong>{session.email}</strong>.{' '}
          <button type="button" className="rwpb-link-button" onClick={() => void signOutAndRedirect()}>Log out</button>
        </p>
      );
    }
    const showLabels = settings.showLabels !== false;
    const here = typeof window === 'undefined' ? '/' : window.location.pathname;
    return (
      <form className="rwpb-form rwpb-login" onSubmit={submit} noValidate={mode === 'edit'}>
        {mode === 'edit' && session && <p className="rwpb-placeholder">You are signed in, so visitors who are signed in see “Logged in as …” instead of this form.</p>}
        <div className="rwpb-form-field">
          <label htmlFor={`${uid}-email`} className={showLabels ? 'rwpb-form-label' : 'rwpb-sr-only'}>Email</label>
          <input id={`${uid}-email`} className="rwpb-form-control" type="email" autoComplete="username" required value={email} placeholder={showLabels ? undefined : 'Email'} onChange={(event) => setEmail(event.target.value)} />
        </div>
        <div className="rwpb-form-field">
          <label htmlFor={`${uid}-password`} className={showLabels ? 'rwpb-form-label' : 'rwpb-sr-only'}>Password</label>
          <input id={`${uid}-password`} className="rwpb-form-control" type="password" autoComplete="current-password" required value={password} placeholder={showLabels ? undefined : 'Password'} onChange={(event) => setPassword(event.target.value)} />
        </div>
        {status.error && <div className="rwpb-form-alert" role="alert">{status.error}</div>}
        <div className="rwpb-form-actions">
          <button type="submit" className="rwpb-button rwpb-button-md rwpb-form-submit" disabled={status.busy}>{status.busy ? 'Signing in…' : str(settings.buttonText, 'Log in')}</button>
        </div>
        {(Boolean(settings.showLostPassword) || (Boolean(settings.showRegister) && canRegister)) && (
          <p className="rwpb-login-links">
            {Boolean(settings.showLostPassword) && <a href={`/lost-password?redirect=${encodeURIComponent(here)}`}>Lost your password?</a>}
            {Boolean(settings.showRegister) && canRegister && <a href={`/register?redirect=${encodeURIComponent(here)}`}>Register</a>}
          </p>
        )}
      </form>
    );
  },
};

// PayPal and Stripe buttons -------------------------------------------------------------------------------------------------------------

const currencyOptions = opts(['USD', 'USD'], ['EUR', 'EUR'], ['GBP', 'GBP'], ['CAD', 'CAD'], ['AUD', 'AUD'], ['JPY', 'JPY'], ['CHF', 'CHF'], ['SEK', 'SEK'], ['NOK', 'NOK'], ['DKK', 'DKK'], ['PLN', 'PLN'], ['NZD', 'NZD'], ['SGD', 'SGD'], ['HKD', 'HKD'], ['MXN', 'MXN'], ['BRL', 'BRL'], ['ILS', 'ILS'], ['CZK', 'CZK'], ['HUF', 'HUF'], ['PHP', 'PHP'], ['TWD', 'TWD'], ['THB', 'THB']);

const paymentButtonStyle = [
  alignControl('align', 'Alignment', true),
  colorControl('buttonColor', 'Text colour'),
  colorControl('buttonBg', 'Background colour'),
  typographyControl(),
];

const paymentButtonCss = (bag: Record<string, unknown>) => ({
  '': { 'text-align': bag.align === 'justify' ? undefined : isSet(bag.align) ? String(bag.align) : undefined },
  ' .rwpb-pay-button': { width: bag.align === 'justify' ? '100%' : undefined, color: color(bag.buttonColor), 'background-color': color(bag.buttonBg), ...typography(bag.typography as Typography | undefined) },
});

export const paypalButton: WidgetDefinition = {
  type: 'paypal-button',
  label: 'PayPal Button',
  icon: 'wallet',
  category: 'pro',
  keywords: ['payment', 'buy now', 'donate', 'checkout'],
  defaults: () => ({ settings: { account: '', transaction: 'checkout', itemName: 'Product name', sku: '', price: '10.00', currency: 'USD', quantity: 1, text: 'Buy now', sandbox: false, openNewTab: true, billingCycle: 'M', billingInterval: 1 } }),
  controls: [
    { key: 'account', label: 'PayPal account email', type: 'text', placeholder: 'payments@example.com', help: 'Payments go to this PayPal account. It is visible in the page source, as with any PayPal button.' },
    { key: 'transaction', label: 'Transaction type', type: 'select', options: opts(['checkout', 'Checkout'], ['donation', 'Donation'], ['subscription', 'Subscription']) },
    { key: 'itemName', label: 'Item name', type: 'text' },
    { key: 'sku', label: 'SKU', type: 'text' },
    { key: 'price', label: 'Price', type: 'text', placeholder: '10.00' },
    { key: 'currency', label: 'Currency', type: 'select', options: currencyOptions },
    { key: 'quantity', label: 'Quantity', type: 'number', min: 1, condition: (settings) => settings.transaction === 'checkout' },
    { key: 'billingInterval', label: 'Bill every', type: 'number', min: 1, max: 30, condition: (settings) => settings.transaction === 'subscription' },
    { key: 'billingCycle', label: 'Billing period', type: 'select', options: opts(['D', 'Days'], ['W', 'Weeks'], ['M', 'Months'], ['Y', 'Years']), condition: (settings) => settings.transaction === 'subscription' },
    { key: 'text', label: 'Button text', type: 'text' },
    { key: 'returnUrl', label: 'Return URL after payment', type: 'text', placeholder: '/thank-you' },
    { key: 'cancelUrl', label: 'Return URL if cancelled', type: 'text', placeholder: '/checkout-cancelled' },
    { key: 'openNewTab', label: 'Open PayPal in a new tab', type: 'toggle' },
    { key: 'sandbox', label: 'Sandbox (test) mode', type: 'toggle', help: 'Uses sandbox.paypal.com with a sandbox account; no real money moves.' },
    ...paymentButtonStyle,
  ],
  css: paymentButtonCss,
  View: function PayPalButtonView({ node }) {
    const { mode } = useRenderContext();
    const settings = node.settings;
    const account = str(settings.account).trim();
    const price = Number(str(settings.price).replace(',', '.'));
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account) && !/^[A-Z0-9]{13}$/.test(account)) return <EditorPlaceholder>Enter the PayPal account email (or merchant ID) that receives payments.</EditorPlaceholder>;
    if (settings.transaction !== 'donation' && !(price > 0)) return <EditorPlaceholder>Enter a price greater than zero.</EditorPlaceholder>;
    const origin = typeof window === 'undefined' ? '' : window.location.origin;
    const absolute = (value: unknown) => {
      const url = safeUrl(value);
      if (!url || url === '#') return typeof window === 'undefined' ? '' : window.location.href;
      return url.startsWith('/') ? `${origin}${url}` : url;
    };
    const transaction = pick(settings.transaction, ['checkout', 'donation', 'subscription'] as const, 'checkout');
    const fields: Record<string, string> = {
      business: account, item_name: str(settings.itemName), item_number: str(settings.sku), currency_code: str(settings.currency, 'USD'),
      return: absolute(settings.returnUrl), cancel_return: absolute(settings.cancelUrl), no_shipping: '0', charset: 'utf-8',
      cmd: transaction === 'donation' ? '_donations' : transaction === 'subscription' ? '_xclick-subscriptions' : '_xclick',
    };
    if (transaction === 'subscription') {
      Object.assign(fields, { a3: price.toFixed(2), p3: String(clamp(Math.round(num(settings.billingInterval, 1)), 1, 30)), t3: pick(settings.billingCycle, ['D', 'W', 'M', 'Y'] as const, 'M'), src: '1' });
    } else if (price > 0) {
      fields.amount = price.toFixed(2);
      if (transaction === 'checkout') fields.quantity = String(Math.max(1, Math.round(num(settings.quantity, 1))));
    }
    return (
      <form className="rwpb-pay" action={`https://www.${settings.sandbox ? 'sandbox.' : ''}paypal.com/cgi-bin/webscr`} method="post" target={settings.openNewTab ? '_blank' : '_top'}
        onSubmit={(event) => { if (mode === 'edit') event.preventDefault(); }}>
        {Object.entries(fields).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
        <button type="submit" className="rwpb-button rwpb-button-md rwpb-pay-button rwpb-pay-paypal">
          <Icon name="wallet" size="1.1em" /> {str(settings.text, 'Buy now')}
        </button>
        {Boolean(settings.sandbox) && mode === 'edit' && <p className="rwpb-pay-note">Sandbox mode is on: no real payments.</p>}
      </form>
    );
  },
};

export const stripeButton: WidgetDefinition = {
  type: 'stripe-button',
  label: 'Stripe Button',
  icon: 'credit-card',
  category: 'pro',
  keywords: ['payment', 'buy', 'checkout', 'payment link'],
  defaults: () => ({ settings: { paymentLink: '', text: 'Pay now', openNewTab: false, prefillEmail: false } }),
  controls: [
    { key: 'paymentLink', label: 'Stripe Payment Link', type: 'text', placeholder: 'https://buy.stripe.com/…', help: 'Create a Payment Link in the Stripe Dashboard (Product catalogue → Payment Links) and paste it here. Prices, tax and receipts are set in Stripe, so no secret key is needed on this site.' },
    { key: 'text', label: 'Button text', type: 'text' },
    { key: 'prefillEmail', label: "Pre-fill the signed-in visitor's email", type: 'toggle' },
    { key: 'openNewTab', label: 'Open in a new tab', type: 'toggle' },
    ...paymentButtonStyle,
  ],
  css: paymentButtonCss,
  View: function StripeButtonView({ node }) {
    const { mode, dynamic } = useRenderContext();
    const settings = node.settings;
    const link = str(settings.paymentLink).trim();
    if (!/^https:\/\/(buy|donate)\.stripe\.com\/[\w-]+/.test(link)) return <EditorPlaceholder>Paste a Stripe Payment Link (it starts with https://buy.stripe.com/).</EditorPlaceholder>;
    const email = settings.prefillEmail ? dynamic?.user?.email : '';
    const href = email ? `${link}${link.includes('?') ? '&' : '?'}prefilled_email=${encodeURIComponent(email)}` : link;
    return (
      <a className="rwpb-button rwpb-button-md rwpb-pay-button rwpb-pay-stripe" href={href} target={settings.openNewTab ? '_blank' : undefined} rel={settings.openNewTab ? 'noopener noreferrer' : undefined}
        onClick={(event) => { if (mode === 'edit') event.preventDefault(); }}>
        <Icon name="credit-card" size="1.1em" /> {str(settings.text, 'Pay now')}
      </a>
    );
  },
};
