import { useEffect, useState } from 'react';
import { loadWidgetAreas, type WidgetAreas } from '../lib/widgets';
import type { Post } from '../lib/types';
import { useTheme } from '../lib/theme';
import WidgetRenderer from './WidgetRenderer';
import { ThemeSidebarBlocks } from './theme/ThemeLayoutRenderer';
import styles from './PublicHome.module.css';

interface PublicSidebarProps {
  recentPosts?: Post[];
  search?: string;
  onSearch?: (value: string) => void;
}

/**
 * The sidebar's blocks come from Appearance → Theme Editor → Sidebar. Its default is one Widget
 * area, which renders the widgets from Menus → Sidebar & Widgets, and falls back to the original
 * hardcoded sidebar when none are configured, so existing sites do not lose their sidebar.
 */
export default function PublicSidebar({ recentPosts = [], search, onSearch }: PublicSidebarProps) {
  const [areas, setAreas] = useState<WidgetAreas | null>(null);
  const { theme } = useTheme();

  useEffect(() => {
    loadWidgetAreas()
      .then(setAreas)
      .catch(() => setAreas({ sidebar: [], footer: [] }));
  }, []);

  const className = `${styles.sidebar} rwp-sidebar${theme.layout.sidebar.options.sticky ? ' rwpt-sidebar-sticky' : ''}`;
  if (areas === null) return <aside className={className} aria-label="Sidebar" />;

  const renderWidgetArea = (source: 'sidebar' | 'footer') => {
    const widgets = areas[source];
    if (widgets.length > 0) {
      return <div className="rwpt-widget-stack">{widgets.map((widget) => <WidgetRenderer key={widget.id} widget={widget} />)}</div>;
    }
    if (source === 'footer') return null;
    return (
      <div className="rwpt-widget-stack">
        {onSearch && (
          <div className={styles.widget}>
            <h2>Search</h2>
            <label htmlFor="public-search" className={styles.srOnly}>Search posts</label>
            <input id="public-search" type="search" value={search}
              onChange={(event) => onSearch(event.target.value)} placeholder="Search posts…" />
          </div>
        )}
        {recentPosts.length > 0 && (
          <div className={styles.widget}>
            <h2>Recent Posts</h2>
            <ul>{recentPosts.map((post) => <li key={post.id}><a href={`/${post.slug}`}>{post.title}</a></li>)}</ul>
          </div>
        )}
        <div className={styles.widget}>
          <h2>Meta</h2>
          <ul><li><a href="/admin">Log in</a></li></ul>
        </div>
      </div>
    );
  };

  return (
    <aside className={className} aria-label="Sidebar">
      <ThemeSidebarBlocks renderWidgetArea={renderWidgetArea} />
    </aside>
  );
}
