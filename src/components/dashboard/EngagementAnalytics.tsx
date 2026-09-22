import { useEffect, useState } from 'react';
import { fetchEngagementReport, type EngagementReport } from '../../lib/engagement';
import styles from './EngagementAnalytics.module.css';

const number = (value: number) => value.toLocaleString();
const day = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/** Dashboard → Analytics (Editors and above): views, likes, saves and follows over a period. */
export default function EngagementAnalytics() {
  const [days, setDays] = useState(30);
  const [report, setReport] = useState<EngagementReport | null>(null);
  const [error, setError] = useState('');
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    setError('');
    fetchEngagementReport(days)
      .then((loaded) => { if (active) setReport(loaded); })
      .catch((loadError: unknown) => { if (active) setError(loadError instanceof Error ? loadError.message : 'The report could not be loaded.'); });
    return () => { active = false; };
  }, [days]);

  const peak = Math.max(1, ...(report?.daily.map((entry) => entry.views) || [0]));
  const hovered = hover !== null && report ? report.daily[hover] : null;

  return (
    <section className={styles.wrap} aria-labelledby="analytics-heading">
      <div className={styles.toolbar}>
        <h2 id="analytics-heading">Engagement analytics</h2>
        <label>
          Period{' '}
          <select value={days} onChange={(event) => setDays(Number(event.target.value))}>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
            <option value={365}>Last 12 months</option>
          </select>
        </label>
      </div>

      {error && <div className={styles.error} role="alert">{error}</div>}
      {!report && !error && <p className={styles.muted} role="status">Loading…</p>}

      {report && (
        <>
          <div className={styles.tiles}>
            {([
              ['Views', report.totals.views], ['Likes', report.totals.likes], ['Saves', report.totals.saves],
              ['New followers', report.totals.follows], ['Category follows', report.totals.category_follows],
            ] as Array<[string, number]>).map(([label, value]) => (
              <div key={label} className={styles.tile}><span>{label}</span><strong>{number(value)}</strong></div>
            ))}
          </div>

          <div className={styles.panel}>
            <h3>Views per day</h3>
            <div className={styles.chart} role="img" aria-label={`Views per day over the last ${report.days} days, peak ${number(peak)}`}
              onMouseLeave={() => setHover(null)}>
              {report.daily.map((entry, index) => (
                <button key={entry.date} type="button" className={styles.bar}
                  aria-label={`${day(entry.date)}: ${number(entry.views)} views, ${number(entry.likes)} likes`}
                  onMouseEnter={() => setHover(index)} onFocus={() => setHover(index)} onBlur={() => setHover(null)}>
                  <span style={{ height: `${(entry.views / peak) * 100}%` }} />
                </button>
              ))}
              {hovered && hover !== null && (
                <div className={styles.tooltip} style={{ insetInlineStart: `${((hover + 0.5) / report.daily.length) * 100}%` }}>
                  <strong>{day(hovered.date)}</strong> · {number(hovered.views)} views · {number(hovered.likes)} likes
                </div>
              )}
            </div>
            <div className={styles.axis} aria-hidden="true">
              <span>{report.daily[0] ? day(report.daily[0].date) : ''}</span>
              <span>peak {number(peak)}</span>
              <span>{report.daily.length ? day(report.daily[report.daily.length - 1].date) : ''}</span>
            </div>
          </div>

          <div className={styles.twoColumns}>
            <div className={styles.panel}>
              <h3>Top content</h3>
              {report.top.length === 0 ? <p className={styles.muted}>Nothing was viewed, liked or saved in this period.</p> : (
                <table className={styles.table}>
                  <thead><tr><th>Item</th><th className={styles.num}>Views</th><th className={styles.num}>Likes</th><th className={styles.num}>Saves</th></tr></thead>
                  <tbody>
                    {report.top.map((row) => (
                      <tr key={`${row.target_type}:${row.target_id}`}>
                        <td><a href={row.url} target="_blank" rel="noreferrer">{row.title}</a>{row.target_type !== 'page' && <span className={styles.muted}> · {row.target_type}</span>}</td>
                        <td className={styles.num}>{number(row.views)}</td>
                        <td className={styles.num}>{number(row.likes)}</td>
                        <td className={styles.num}>{number(row.saves)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className={styles.panel}>
              <h3>Most-followed authors</h3>
              {report.top_authors.length === 0 ? <p className={styles.muted}>Nobody follows an author yet.</p> : (
                <table className={styles.table}>
                  <thead><tr><th>Author</th><th className={styles.num}>Followers</th></tr></thead>
                  <tbody>
                    {report.top_authors.map((row) => (
                      <tr key={row.id}><td>{row.name}</td><td className={styles.num}>{number(row.followers)}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className={styles.muted}>
                Views count once per browser per item every 30 minutes, never for authors reading their own posts.
                Raw view records are kept for 400 days; the lifetime totals on each post are kept for good.
              </p>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
