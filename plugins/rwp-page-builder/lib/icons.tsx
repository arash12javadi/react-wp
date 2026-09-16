import {
  AlertTriangle, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Award, BarChart3, Blocks, Briefcase, Building, Calendar,
  Camera, Check, CheckCircle, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Clock, Cloud, Code, Code2, Coffee,
  Columns2, CreditCard, DollarSign, Download, ExternalLink, FileText, Film, Flame, Gift, Globe, Headphones, Heading,
  Heart, HelpCircle, Home, Image, Info, Laptop, Layers, LayoutGrid, Leaf, Lightbulb, Link, ListCollapse, Lock, Mail,
  MapPin, Megaphone, Menu, MessageCircle, Minus, Monitor, Moon, MousePointerClick, Music, Navigation, Newspaper,
  Package, Percent, Phone, Play, Plus, Quote, Rocket, Search, Send, SeparatorHorizontal, Settings, Shield,
  ShieldCheck, ShoppingCart, Smartphone, Smile, Sparkles, Square, Star, Sun, Tag, Target, ThumbsUp, TrendingUp,
  Trophy, Truck, Type, User, Users, Video, Wrench, X, Zap, GalleryHorizontal, MoveVertical, Hash, Inbox,
  Images, GalleryThumbnails, List, ListChecks, ListOrdered, Timer, Gauge, SlidersHorizontal, MessageSquareQuote,
  ToggleLeft, Share2, Bell, AudioLines, Anchor, BookOpen, Spline, Map as MapIcon, StarHalf, FlipHorizontal2, Receipt,
  Table, FileCode, Crosshair, Activity, PanelRight, PanelLeft, LogIn, MessageSquare, LayoutList, Network, Captions,
  LayoutTemplate, Filter, Tv, CirclePlay, ShoppingBag, Store, BadgePercent, Boxes, PackageCheck, Wallet, Bookmark,
  CalendarDays, Archive, Tags, SquareMenu, TextCursor, Copy, FolderTree, ListTree, CircleDollarSign, BadgeCheck,
  ClipboardList, ShoppingBasket, PanelTop, AppWindow, SquareStack, Signpost, Hourglass, TextQuote, Braces, ScrollText,
  SquarePlay, ListVideo, Ticket, LockOpen, CircleCheck, CircleAlert, TriangleAlert, CircleUser, Rss, AtSign,
  createLucideIcon, type LucideIcon,
} from 'lucide-react';

/**
 * Brand marks. lucide-react 1.x dropped its brand icons, so these are drawn in the same
 * 24×24 stroke style and built with createLucideIcon to take the same props.
 */
export const brandIcons: Record<string, LucideIcon> = {
  facebook: createLucideIcon('rwpb-facebook', [['path', { d: 'M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z', key: 'a' }]]),
  instagram: createLucideIcon('rwpb-instagram', [
    ['rect', { width: '20', height: '20', x: '2', y: '2', rx: '5', ry: '5', key: 'a' }],
    ['path', { d: 'M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z', key: 'b' }],
    ['line', { x1: '17.5', x2: '17.51', y1: '6.5', y2: '6.5', key: 'c' }],
  ]),
  x: createLucideIcon('rwpb-x-twitter', [
    ['path', { d: 'M4 4l11.733 16h4.267l-11.733-16z', key: 'a' }],
    ['path', { d: 'M4 20l6.768-6.768m2.46-2.46l6.772-6.772', key: 'b' }],
  ]),
  twitter: createLucideIcon('rwpb-twitter', [['path', { d: 'M22 4s-.7 2.1-2 3.4c1.6 10-9.4 17.3-18 11.6 2.2.1 4.4-.6 6-2C3 15.5.5 9.6 3 5c2.2 2.6 5.6 4.1 9 4-.9-4.2 4-6.6 7-3.8 1.1 0 3-1.2 3-1.2z', key: 'a' }]]),
  linkedin: createLucideIcon('rwpb-linkedin', [
    ['path', { d: 'M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z', key: 'a' }],
    ['rect', { width: '4', height: '12', x: '2', y: '9', key: 'b' }],
    ['circle', { cx: '4', cy: '4', r: '2', key: 'c' }],
  ]),
  youtube: createLucideIcon('rwpb-youtube', [
    ['path', { d: 'M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17', key: 'a' }],
    ['path', { d: 'm10 15 5-3-5-3z', key: 'b' }],
  ]),
  github: createLucideIcon('rwpb-github', [
    ['path', { d: 'M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4', key: 'a' }],
    ['path', { d: 'M9 18c-4.51 2-5-2-7-2', key: 'b' }],
  ]),
  twitch: createLucideIcon('rwpb-twitch', [['path', { d: 'M21 2H3v16h5v4l4-4h5l4-4V2zm-10 9V7m5 4V7', key: 'a' }]]),
  dribbble: createLucideIcon('rwpb-dribbble', [
    ['circle', { cx: '12', cy: '12', r: '10', key: 'a' }],
    ['path', { d: 'M19.13 5.09C15.22 9.14 10 10.44 2.25 10.94', key: 'b' }],
    ['path', { d: 'M21.75 12.84c-6.62-1.41-12.14 1-16.38 6.32', key: 'c' }],
    ['path', { d: 'M8.56 2.75c4.37 6 6 9.42 8 17.72', key: 'd' }],
  ]),
  pinterest: createLucideIcon('rwpb-pinterest', [
    ['path', { d: 'M8 20l4-9', key: 'a' }],
    ['path', { d: 'M10.7 14c.437 1.263 1.43 2 2.55 2 2.071 0 3.75-1.554 3.75-4a5 5 0 1 0-9.7 1.7', key: 'b' }],
    ['circle', { cx: '12', cy: '12', r: '9', key: 'c' }],
  ]),
  tiktok: createLucideIcon('rwpb-tiktok', [['path', { d: 'M21 7.917v4.034a9.948 9.948 0 0 1-5-1.951v4.5a6.5 6.5 0 1 1-8-6.326v4.326a2.5 2.5 0 1 0 4 2V3h4.083A6.005 6.005 0 0 0 21 7.917z', key: 'a' }]]),
  whatsapp: createLucideIcon('rwpb-whatsapp', [
    ['path', { d: 'M3 21l1.65-3.8a9 9 0 1 1 3.4 2.9L3 21', key: 'a' }],
    ['path', { d: 'M9 10a.5.5 0 0 0 1 0V9a.5.5 0 0 0-1 0v1a5 5 0 0 0 5 5h1a.5.5 0 0 0 0-1h-1a.5.5 0 0 0 0 1', key: 'b' }],
  ]),
  telegram: createLucideIcon('rwpb-telegram', [['path', { d: 'M15 10l-4 4l6 6l4-16l-18 7l4 2l2 6l3-4', key: 'a' }]]),
  reddit: createLucideIcon('rwpb-reddit', [
    ['circle', { cx: '12', cy: '14', r: '7', key: 'a' }],
    ['path', { d: 'M9.5 16c1.5 1 3.5 1 5 0', key: 'b' }],
    ['circle', { cx: '18.5', cy: '4.5', r: '1.5', key: 'c' }],
    ['path', { d: 'M12 7l1.5-4 5 1.5', key: 'd' }],
    ['path', { d: 'M9.5 12.5h.01M14.5 12.5h.01', key: 'e' }],
  ]),
  discord: createLucideIcon('rwpb-discord', [
    ['path', { d: 'M8 12a1 1 0 1 0 2 0a1 1 0 0 0-2 0M14 12a1 1 0 1 0 2 0a1 1 0 0 0-2 0', key: 'a' }],
    ['path', { d: 'M15.5 17c0 1 1.5 3 2 3c1.5 0 2.833-1.667 3.5-3c.667-1.667.5-5.833-1.5-11.5c-1.457-1.015-3-1.34-4.5-1.5l-.972 1.923a11.913 11.913 0 0 0-4.053 0L9 4c-1.5.16-3.043.485-4.5 1.5c-2 5.667-2.167 9.833-1.5 11.5c.667 1.333 2 3 3.5 3c.5 0 2-2 2-3', key: 'b' }],
    ['path', { d: 'M7 16.5c3.5 1 6.5 1 10 0', key: 'c' }],
  ]),
};

/**
 * A curated set rather than all of lucide-react: importing the full icon map by name would
 * put every icon into the public bundle. Add names here to offer more.
 */
export const icons: Record<string, LucideIcon> = {
  'arrow-right': ArrowRight, 'arrow-left': ArrowLeft, 'arrow-up': ArrowUp, 'arrow-down': ArrowDown,
  'chevron-right': ChevronRight, 'chevron-left': ChevronLeft, 'chevron-down': ChevronDown, 'chevron-up': ChevronUp,
  check: Check, 'check-circle': CheckCircle, plus: Plus, minus: Minus, x: X, star: Star, heart: Heart,
  mail: Mail, phone: Phone, 'map-pin': MapPin, clock: Clock, calendar: Calendar, user: User, users: Users,
  cart: ShoppingCart, search: Search, menu: Menu, play: Play, globe: Globe, shield: Shield, 'shield-check': ShieldCheck,
  zap: Zap, rocket: Rocket, award: Award, trophy: Trophy, gift: Gift, lightbulb: Lightbulb, target: Target,
  'trending-up': TrendingUp, chart: BarChart3, camera: Camera, image: Image, video: Video, music: Music,
  headphones: Headphones, message: MessageCircle, send: Send, download: Download, link: Link, 'external-link': ExternalLink,
  lock: Lock, settings: Settings, wrench: Wrench, code: Code, laptop: Laptop, smartphone: Smartphone, monitor: Monitor,
  cloud: Cloud, sun: Sun, moon: Moon, leaf: Leaf, coffee: Coffee, home: Home, building: Building, briefcase: Briefcase,
  'credit-card': CreditCard, dollar: DollarSign, percent: Percent, tag: Tag, truck: Truck, package: Package, quote: Quote,
  'thumbs-up': ThumbsUp, smile: Smile, sparkles: Sparkles, flame: Flame, info: Info, alert: AlertTriangle, help: HelpCircle,
  megaphone: Megaphone, layers: Layers,
  bell: Bell, bookmark: Bookmark, anchor: Anchor, 'book-open': BookOpen, map: MapIcon, 'lock-open': LockOpen,
  'circle-check': CircleCheck, 'circle-alert': CircleAlert, 'triangle-alert': TriangleAlert, 'circle-user': CircleUser,
  rss: Rss, 'at-sign': AtSign, copy: Copy, wallet: Wallet, ticket: Ticket, store: Store, 'shopping-bag': ShoppingBag,
  hourglass: Hourglass, activity: Activity, receipt: Receipt, 'log-in': LogIn, filter: Filter, archive: Archive,
  // Widget panel icons.
  heading: Heading, type: Type, columns: Columns2, grid: LayoutGrid, square: Square, button: MousePointerClick,
  divider: SeparatorHorizontal, spacer: MoveVertical, film: Film, newspaper: Newspaper, 'file-text': FileText,
  accordion: ListCollapse, navigation: Navigation, html: Code2, slides: GalleryHorizontal, blocks: Blocks, hash: Hash,
  inbox: Inbox, images: Images, 'gallery-thumbnails': GalleryThumbnails, list: List, 'list-checks': ListChecks,
  'list-ordered': ListOrdered, timer: Timer, gauge: Gauge, sliders: SlidersHorizontal, testimonial: MessageSquareQuote,
  toggle: ToggleLeft, share: Share2, 'audio-lines': AudioLines, spline: Spline, 'star-half': StarHalf,
  'flip-box': FlipHorizontal2, table: Table, 'file-code': FileCode, crosshair: Crosshair, 'panel-right': PanelRight,
  'panel-left': PanelLeft, 'message-square': MessageSquare, 'layout-list': LayoutList, network: Network, captions: Captions,
  template: LayoutTemplate, tv: Tv, 'circle-play': CirclePlay, 'badge-percent': BadgePercent, boxes: Boxes,
  'package-check': PackageCheck, 'calendar-days': CalendarDays, tags: Tags, 'square-menu': SquareMenu,
  'text-cursor': TextCursor, 'folder-tree': FolderTree, 'list-tree': ListTree, 'circle-dollar': CircleDollarSign,
  'badge-check': BadgeCheck, 'clipboard-list': ClipboardList, basket: ShoppingBasket, 'panel-top': PanelTop,
  'app-window': AppWindow, 'square-stack': SquareStack, signpost: Signpost, 'text-quote': TextQuote, braces: Braces,
  'scroll-text': ScrollText, 'square-play': SquarePlay, 'list-video': ListVideo,
  ...brandIcons,
};

export const iconNames = Object.keys(icons);

export function Icon({ name, size = 20, className, strokeWidth }: { name: string; size?: number | string; className?: string; strokeWidth?: number }) {
  const Component = icons[name];
  if (!Component) return null;
  return <Component size={size} className={className} strokeWidth={strokeWidth} aria-hidden="true" />;
}
