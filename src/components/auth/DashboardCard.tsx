import styles from './UserAccount.module.css';

/**
 * One card on the visitors' dashboard ([rwp_user_dashboard]). Plugins add theirs to the
 * `user_dashboard` slot so they match the built-in ones:
 *
 *   addSlotContent('user_dashboard', 'my-plugin-orders', () => <DashboardCard href="/orders" title="Orders" text="…" />)
 */
export default function DashboardCard({ href, title, text }: { href: string; title: string; text?: string }) {
  return (
    <a className={`${styles.card} rwp-user-dashboard-card`} href={href}>
      <strong>{title}</strong>
      {text && <span>{text}</span>}
    </a>
  );
}
