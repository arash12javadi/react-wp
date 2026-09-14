import {
  AlertTriangle, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Award, BarChart3, Blocks, Briefcase, Building, Calendar,
  Camera, Check, CheckCircle, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Clock, Cloud, Code, Code2, Coffee,
  Columns2, CreditCard, DollarSign, Download, ExternalLink, FileText, Film, Flame, Gift, Globe, Headphones, Heading,
  Heart, HelpCircle, Home, Image, Info, Laptop, Layers, LayoutGrid, Leaf, Lightbulb, Link, ListCollapse, Lock, Mail,
  MapPin, Megaphone, Menu, MessageCircle, Minus, Monitor, Moon, MousePointerClick, Music, Navigation, Newspaper,
  Package, Percent, Phone, Play, Plus, Quote, Rocket, Search, Send, SeparatorHorizontal, Settings, Shield,
  ShieldCheck, ShoppingCart, Smartphone, Smile, Sparkles, Square, Star, Sun, Tag, Target, ThumbsUp, TrendingUp,
  Trophy, Truck, Type, User, Users, Video, Wrench, X, Zap, GalleryHorizontal, MoveVertical, Hash, Inbox,
  type LucideIcon,
} from 'lucide-react';

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
  // Widget panel icons.
  heading: Heading, type: Type, columns: Columns2, grid: LayoutGrid, square: Square, button: MousePointerClick,
  divider: SeparatorHorizontal, spacer: MoveVertical, film: Film, newspaper: Newspaper, 'file-text': FileText,
  accordion: ListCollapse, navigation: Navigation, html: Code2, slides: GalleryHorizontal, blocks: Blocks, hash: Hash,
  inbox: Inbox,
};

export const iconNames = Object.keys(icons);

export function Icon({ name, size = 20, className, strokeWidth }: { name: string; size?: number | string; className?: string; strokeWidth?: number }) {
  const Component = icons[name];
  if (!Component) return null;
  return <Component size={size} className={className} strokeWidth={strokeWidth} aria-hidden="true" />;
}
