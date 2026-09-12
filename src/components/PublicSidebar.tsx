import { useEffect, useState } from 'react';
import { loadWidgetAreas, type Widget } from '../lib/widgets';
import type { Post } from '../lib/types';
import WidgetRenderer from './WidgetRenderer';
import styles from './PublicHome.module.css';

interface PublicSidebarProps {
  recentPosts?: Post[];
  search?: string;
  onSearch?: (value: string) => void;
}

/**
 * Renders configured widgets. Falls back to the original hardcoded sidebar when nothing has
 * been configured, so existing sites do not lose their sidebar the moment widgets ship.
 */
export default function PublicSidebar({ recentPosts = [], search, onSearch }: PublicSidebarProps) {
  const [widgets, setWidgets] = useState<Widget[] | null>(null);

  useEffect(() => {
    loadWidgetAreas()
      .then((areas) => setWidgets(areas.sidebar))
      .catch(() => setWidgets([]));
  }, []);

  if (widgets === null) return <aside className={styles.sidebar} aria-label="Sidebar" />;

  if (widgets.length > 0) {
    return (
      <aside className={styles.sidebar} aria-label="Sidebar">
        {widgets.map((widget) => <WidgetRenderer key={widget.id} widget={widget} />)}
      </aside>
    );
  }

  return (
    <aside className={styles.sidebar} aria-label="Sidebar">
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
    </aside>
  );
}
