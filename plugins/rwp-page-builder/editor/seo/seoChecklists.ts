/**
 * Manual SEO tasks the editor cannot verify (keyword research, off-page promotion). Ticks are
 * stored in the layout's document settings (doc.settings.seoChecklist), so they save with the
 * page and go through undo like any other edit. That JSON is public for published pages, so only
 * booleans keyed by these ids are ever stored there.
 */

export const CHECKLIST_SETTING = 'seoChecklist';

export interface ChecklistTask {
  id: string;
  label: string;
  help: string;
  link?: { href: string; label: string };
}

export const keywordResearchTasks: ChecklistTask[] = [
  {
    id: 'kw-research', label: 'Researched volume and competition',
    help: 'Find high-volume, low-competition phrases in Google Keyword Planner, Ubersuggest, Semrush or Ahrefs.',
    link: { href: 'https://ads.google.com/aw/keywordplanner/home', label: 'Keyword Planner' },
  },
  {
    id: 'kw-intent', label: 'Confirmed the search intent',
    help: 'Search the keyword privately: are the top results guides, product pages, lists or tools? This page should be the same kind.',
  },
  {
    id: 'kw-long-tail', label: 'Chose long-tail variations',
    help: 'Longer, specific phrases ("burr coffee grinder for espresso") bring more targeted visitors than head terms.',
  },
  {
    id: 'kw-competitors', label: 'Analysed the competitors that rank',
    help: 'Note what the top 3 results cover, their headings and length, and what they miss.',
  },
  {
    id: 'kw-refresh', label: 'Planned a content refresh',
    help: 'Put a date in the calendar to update facts, links and examples, usually every 3–6 months.',
  },
];

export const outreachTasks: ChecklistTask[] = [
  { id: 'bl-social', label: 'Shared on 3+ social platforms', help: 'For example LinkedIn, X, Facebook, Pinterest or relevant communities.' },
  { id: 'bl-guest', label: 'Guest blogging', help: 'Write for a relevant site in your niche and link back to this page where it genuinely helps.' },
  { id: 'bl-broken', label: 'Broken link building', help: 'Find dead links on related sites (e.g. with Ahrefs or Check My Links) and suggest this page as the replacement.' },
  { id: 'bl-directories', label: 'Directory & Google Business Profile listings', help: 'List the business in reputable, niche-relevant directories and keep the Google Business Profile current.', link: { href: 'https://business.google.com/', label: 'Google Business Profile' } },
  { id: 'bl-skyscraper', label: 'Skyscraper technique', help: 'Find a popular piece on this topic, make a clearly better one, then contact the sites linking to the original.' },
  { id: 'bl-haro', label: 'HARO / Connectively / Qwoted', help: 'Answer journalist requests in your field to earn press mentions and links.', link: { href: 'https://www.qwoted.com/', label: 'Qwoted' } },
  { id: 'bl-testimonials', label: 'Testimonials for tools you use', help: 'Vendors often publish customer testimonials with a link to the reviewer.' },
  { id: 'bl-repurpose', label: 'Content repurposing', help: 'Turn this page into a video, infographic, slide deck or thread, each linking back here.' },
];

export type ChecklistState = Record<string, boolean>;

export const readChecklist = (settings: Record<string, unknown> | undefined): ChecklistState => {
  const value = settings?.[CHECKLIST_SETTING];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, done]) => done === true)) as ChecklistState;
};

export const progress = (tasks: ChecklistTask[], state: ChecklistState) => tasks.filter((task) => state[task.id]).length;
