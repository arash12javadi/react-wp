import { useState, type ReactNode } from 'react';
import { menuPlaceholders } from '../../lib/dynamicMenu';
import { capabilityLabels, roleCapabilities, roleLabels, roles, type UserRole } from '../../lib/roles';
import { rwp } from '../../lib/rwp';
import styles from './Dashboard.module.css';

type Navigate = (section: string, subsection?: string) => void;

const migrations: Array<[string, string]> = [
  ['20260911_create_plugins.sql', 'The plugins table behind the Plugins screen.'],
  ['20260911_create_pages_categories.sql', 'Pages, posts and categories in one pages table.'],
  ['20260912_profiles_capabilities_media.sql', 'Roles in public.profiles (a security fix) and the media library.'],
  ['20260913_page_layout_seo.sql', 'Page width, sidebar and SEO fields.'],
  ['20260914_auth_defaults.sql', 'Default role for new accounts and login options.'],
  ['20260915_comments_profiles_widgets.sql', 'Comments on pages, profile bio and avatar, widgets.'],
  ['20260916_comment_author_fk.sql', 'Lets comments show their author.'],
  ['20260917_shop_plugin.sql', 'Everything the RWP Shop plugin stores.'],
  ['20260918_page_builder.sql', 'Page builder layouts, templates, revisions and forms.'],
  ['20260919_backup_restore.sql', 'Settings → Backup.'],
  ['20260920_app_settings.sql', 'Settings → General, Uploads, SEO and Roles, enforced in the database.'],
  ['20260921_profile_details.sql', 'Optional profile details (Profile → More about you).'],
  ['20260922_theme_editor.sql', 'Appearance → Theme Editor: header, footer, sidebar, comments and home page layout, and custom code.'],
];

const envVars: Array<[string, string, string]> = [
  ['VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY', 'Only without the installer', 'The Supabase project the browser connects to. The installer writes these to data/react-wp-config.json instead, so most sites never set them.'],
  ['SUPABASE_SECRET_KEY', 'Shop payments, guest order emails, builder form emails', 'Supabase → Project Settings → API Keys → secret key. Server only: never give it a VITE_ prefix and never paste it into an admin screen.'],
  ['CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET', 'Deleting Cloudinary files', 'Cloudinary → Settings → API Keys. Uploading needs neither.'],
  ['IMAGEKIT_PRIVATE_KEY', 'Any ImageKit upload or delete', 'ImageKit → Developer options.'],
  ['STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET', 'Card payments', 'Stripe → Developers → API keys / Webhooks. Use sk_test_… while testing.'],
  ['PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_MODE', 'PayPal payments', 'PayPal developer dashboard → Apps & Credentials. PAYPAL_MODE is sandbox or live.'],
  ['SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM', 'Order and form emails', 'From your email provider (for example the SMTP settings of Gmail, Brevo, Mailgun or your host).'],
  ['SITE_URL', 'Payment return links and email links', 'Your public address, if the server sees a different host name (for example behind a proxy).'],
  ['PORT', 'npm start', 'The port the server listens on. Default 3000.'],
];

const troubleshooting: Array<[string, string]> = [
  ['"Could not find the table … in the schema cache" (PGRST205)', 'A migration has not run, or Supabase has not noticed it yet. Run the migration the message names; if you already did, run notify pgrst, \'reload schema\'; in the SQL Editor or wait a minute.'],
  ['"Saved", but nothing changed after a reload', 'Row level security blocked the write. Your role lacks the capability for that screen; check Users → your role.'],
  ['Shop, forms or media deletes fail under npm run dev', 'npm run dev only serves the pages. The /api routes come from npm start, which must also be running (on port 3000).'],
  ['Google or Facebook sign-in returns a redirect error', 'Add https://your-site/login (and http://localhost:3000/login) under Supabase → Authentication → URL Configuration → Redirect URLs.'],
  ['A large backup restore fails with "canceling statement due to statement timeout"', 'Run alter role authenticated set statement_timeout = \'60s\'; notify pgrst, \'reload config\'; in the SQL Editor, then restore again.'],
  ['"Supabase connection failed" on every page', 'The Supabase project is paused (free projects pause after a week without use), deleted, or its URL changed. Resume it in the Supabase dashboard.'],
  ['Link previews on Facebook, X or WhatsApp are blank', 'Those crawlers do not run JavaScript. The server writes the tags into the page only with npm start; on Vercel they are missing.'],
];

function Section({ id, icon, title, children }: { id: string; icon: string; title: string; children: ReactNode }) {
  return (
    <section id={`guide-${id}`} className={styles.guideSection} aria-labelledby={`guide-${id}-heading`}>
      <h2 id={`guide-${id}-heading`}><span aria-hidden="true">{icon}</span> {title}</h2>
      {children}
    </section>
  );
}

function Copy({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button type="button" className={styles.copyButton} onClick={() => {
      void navigator.clipboard?.writeText(text).then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      });
    }}>
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

export default function GuidePanel({ navigate }: { navigate: Navigate }) {
  const shortcodes = [...rwp.getShortcodes()].sort((a, b) => a.name.localeCompare(b.name));
  const activePlugins = rwp.getPlugins().filter((plugin) => plugin.active).map((plugin) => plugin.id);
  const shopActive = activePlugins.includes('rwp-shop');
  const builderActive = activePlugins.includes('rwp-page-builder');
  const roleOrder: UserRole[] = roles.filter((role) => role !== 'super_admin');

  const toc: Array<[string, string, string]> = [
    ['start', '🚀', 'Getting started'],
    ['database', '🗄️', 'Database & migrations'],
    ['environment', '🔑', 'Server secrets (.env.local)'],
    ['content', '📝', 'Pages & posts'],
    ['shortcodes', '🧷', 'Shortcodes'],
    ['menus', '🧭', 'Menus & widgets'],
    ['media', '🎬', 'Media'],
    ['roles', '🛡️', 'Users & roles'],
    ...(builderActive ? [['builder', '🧱', 'Page builder'] as [string, string, string]] : []),
    ...(shopActive ? [['shop', '🛒', 'Shop'] as [string, string, string]] : []),
    ['backup', '💾', 'Backup & updates'],
    ['plugins', '🔌', 'Writing plugins'],
    ['troubleshooting', '🩹', 'Troubleshooting'],
  ];

  const go = (id: string) => document.getElementById(`guide-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className={styles.guide}>
      <nav className={styles.toc} aria-label="Guide contents">
        {toc.map(([id, icon, label]) => (
          <button key={id} type="button" onClick={() => go(id)}><span aria-hidden="true">{icon}</span> {label}</button>
        ))}
      </nav>

      <Section id="start" icon="🚀" title="Getting started">
        <p>React-WP works like WordPress: one Supabase project is the database for one website. A good first hour:</p>
        <ol>
          <li><strong>Name the site</strong> in <button type="button" className={styles.inlineLink} onClick={() => navigate('settings', 'site')}>Settings → Site</button>: title, tagline, logo and icon, and whether the front page shows the latest posts or a page.</li>
          <li><strong>Connect an image host</strong> in <button type="button" className={styles.inlineLink} onClick={() => navigate('media', 'upload-settings')}>Media → Upload providers</button> (Cloudinary is the quickest), so you can upload.</li>
          <li><strong>Fill in your profile</strong> in <button type="button" className={styles.inlineLink} onClick={() => navigate('profile')}>Profile</button>: display name and avatar appear next to your comments.</li>
          <li><strong>Write something</strong> under <button type="button" className={styles.inlineLink} onClick={() => navigate('content', 'new-post')}>Pages &amp; Posts → Add post</button>, then add it to the header in <button type="button" className={styles.inlineLink} onClick={() => navigate('menus', 'menus')}>Menus</button>.</li>
          <li><strong>Decide who can sign up</strong> in <button type="button" className={styles.inlineLink} onClick={() => navigate('settings', 'accounts')}>Settings → Accounts</button>.</li>
          <li>Work through <button type="button" className={styles.inlineLink} onClick={() => navigate('dashboard', 'overview')}>Dashboard → Overview</button>: it lists what is still missing, with the steps to fix each item.</li>
        </ol>
        <p className={styles.muted}>Running the site: <code>npm start</code> builds and serves everything on port 3000. <code>npm run dev</code> is for editing code and needs <code>npm start</code> running beside it.</p>
      </Section>

      <Section id="database" icon="🗄️" title="Database & migrations">
        <p>
          The installer creates every table from <code>supabase/schema.sql</code>. When an update adds features, it ships a
          <strong> migration</strong>: a SQL file you run once by hand, because the site cannot change its own database.
        </p>
        <ol>
          <li>Open your project at <a href="https://supabase.com/dashboard/projects" target="_blank" rel="noreferrer">supabase.com/dashboard ↗</a> → <strong>SQL Editor</strong> → <strong>New query</strong>.</li>
          <li>Open the file from the <code>supabase/migrations/</code> folder, copy all of it, paste, and click <strong>Run</strong>.</li>
          <li>Reload the admin. Every migration is safe to run again, so if one stops halfway, fix the cause and run the whole file again.</li>
        </ol>
        <p>A site installed with the current version already has all of these. An older site needs the ones added after it was installed, oldest first:</p>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>File</th><th>What it adds</th></tr></thead>
            <tbody>{migrations.map(([file, purpose]) => <tr key={file}><td><code>{file}</code></td><td>{purpose}</td></tr>)}</tbody>
          </table>
        </div>
        <p className={styles.muted}>
          Security is enforced in the database with row level security, not by hiding buttons. That is why a role without
          permission gets &ldquo;nothing saved&rdquo; rather than a screen error, and why secrets never belong in admin
          settings: the <code>options</code> table they are stored in is readable by anyone.
        </p>
      </Section>

      <Section id="environment" icon="🔑" title="Server secrets (.env.local)">
        <p>
          Secrets go in a file named <code>.env.local</code> in the project folder (copy <code>.env.example</code>), one
          <code> NAME=value</code> per line. Restart <code>npm start</code> after changing it. On Vercel, add them under
          Project → Settings → Environment Variables instead. Everything is optional; each unlocks one feature.
        </p>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>Variable</th><th>Needed for</th><th>Where to get it</th></tr></thead>
            <tbody>{envVars.map(([name, need, where]) => <tr key={name}><td><code>{name}</code></td><td>{need}</td><td>{where}</td></tr>)}</tbody>
          </table>
        </div>
      </Section>

      <Section id="content" icon="📝" title="Pages & posts">
        <ul>
          <li><strong>Posts</strong> are dated blog entries shown in the feed; <strong>pages</strong> are standalone (About, Contact). Both live under Pages &amp; Posts.</li>
          <li>The editor&rsquo;s side panel sets the URL slug, status, category, width (boxed, wide, full) and whether the sidebar shows.</li>
          <li>The <strong>SEO panel</strong> under the editor sets the search title, description, social image and <code>noindex</code>, with a checklist.</li>
          <li>To use a page as the front page, pick it in <strong>Settings → Site → Home page</strong>, and choose another page as the Posts page for the blog feed.</li>
          <li>Contributors write drafts that an Editor publishes; Authors publish their own posts. See Users &amp; roles below.</li>
        </ul>
      </Section>

      <Section id="shortcodes" icon="🧷" title="Shortcodes">
        <p>
          Type a shortcode in square brackets anywhere in a page or post. It can stand on its own line or sit inside a
          sentence. Attributes use <code>name="value"</code>. These are available with your active plugins:
        </p>
        {shortcodes.length === 0 && <p className={styles.muted}>No shortcodes are registered.</p>}
        <div className={styles.shortcodes}>
          {shortcodes.map((shortcode) => {
            const example = shortcode.example || `[${shortcode.name}]`;
            return (
              <article key={shortcode.name} className={styles.shortcode}>
                <div className={styles.shortcodeHead}>
                  <code>[{shortcode.name}]</code>
                  <Copy text={example} />
                </div>
                {shortcode.description && <p>{shortcode.description}</p>}
                <pre className={styles.example}>{example}</pre>
                {shortcode.attributes && shortcode.attributes.length > 0 && (
                  <dl className={styles.attributes}>
                    {shortcode.attributes.map((attribute) => (
                      <div key={attribute.name}><dt><code>{attribute.name}</code></dt><dd>{attribute.description}</dd></div>
                    ))}
                  </dl>
                )}
              </article>
            );
          })}
        </div>
      </Section>

      <Section id="menus" icon="🧭" title="Menus & widgets">
        <p>Menus → Menus builds the header links, with one level of dropdowns. Menu labels and URLs can personalise themselves for the signed-in visitor:</p>
        <ul>
          {menuPlaceholders.map((placeholder) => (
            <li key={placeholder.token}><code>{placeholder.token}</code> (in the {placeholder.where}): {placeholder.description}</li>
          ))}
        </ul>
        <p>
          Each item also chooses what signed-out visitors see: the item, nothing, or a different label and link (for
          example &ldquo;Log in&rdquo; instead of <code>#profile_both#</code>). Hiding a link does not protect the page behind it.
        </p>
        <p>
          Menus → Sidebar &amp; Widgets places Search, Recent Posts, Categories, Text/HTML, a Navigation Menu or a Login box
          in the sidebar or footer. The sidebar shows on pages with <strong>Show sidebar</strong> ticked in the editor.
        </p>
      </Section>

      <Section id="media" icon="🎬" title="Media">
        <ul>
          <li>Files are stored at <strong>Cloudinary</strong> or <strong>ImageKit</strong>; Supabase keeps the library list, titles and alt text. Images can also be added by URL with no provider at all.</li>
          <li><strong>Cloudinary</strong>: in Cloudinary → Settings → Upload → Upload presets, add a preset with Signing Mode <em>Unsigned</em>. Enter your cloud name and that preset under Media → Upload providers. Add <code>CLOUDINARY_API_KEY</code> and <code>CLOUDINARY_API_SECRET</code> to <code>.env.local</code> so deletes also remove the file at Cloudinary.</li>
          <li><strong>ImageKit</strong>: enter the public key and URL endpoint under Media → Upload providers, and put <code>IMAGEKIT_PRIVATE_KEY</code> in <code>.env.local</code>. It is needed for every upload.</li>
          <li>Size limits, image dimensions and per-role storage quotas are under <strong>Settings → Uploads</strong>.</li>
        </ul>
      </Section>

      <Section id="roles" icon="🛡️" title="Users & roles">
        <p>
          New accounts get the role chosen under Settings → Accounts (never Administrator). Change someone&rsquo;s role under
          Users. Settings → Roles can additionally let Subscribers upload or write drafts, and Contributors upload or publish.
          Create and delete accounts in the Supabase dashboard → Authentication.
        </p>
        <div className={styles.tableWrap}>
          <table className={`${styles.table} ${styles.capTable}`}>
            <thead><tr><th>Capability</th>{roleOrder.map((role) => <th key={role}>{roleLabels[role]}</th>)}</tr></thead>
            <tbody>
              {(Object.keys(capabilityLabels) as Array<keyof typeof capabilityLabels>).map((capability) => (
                <tr key={capability}>
                  <td>{capabilityLabels[capability]}</td>
                  {roleOrder.map((role) => (
                    <td key={role} aria-label={roleCapabilities[role].includes(capability) ? 'Yes' : 'No'}>
                      {roleCapabilities[role].includes(capability) ? '✔' : ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {builderActive && (
        <Section id="builder" icon="🧱" title="Page builder">
          <ul>
            <li>Open any page with <strong>Edit with Builder</strong> in Pages &amp; Posts, or from Page Builder → Pages. Saving from the builder switches that page to its layout.</li>
            <li>Build with sections → columns → widgets. Every element has Content, Style and Advanced tabs, set per device (desktop, tablet, mobile).</li>
            <li>Text fields accept <strong>dynamic tags</strong>, replaced when the page is shown. Add a fallback after a bar: <code>{'{{user.name|there}}'}</code>.</li>
          </ul>
          <p className={styles.tagList}>
            {['page.title', 'page.excerpt', 'page.url', 'page.date', 'page.modified', 'page.author', 'page.category', 'page.featured_image', 'user.name', 'user.email', 'site.title', 'site.tagline', 'site.url', 'date.today', 'date.year']
              .map((tag) => <code key={tag}>{`{{${tag}}}`}</code>)}
          </p>
          <p className={styles.muted}>Custom HTML widgets can only be saved by administrators, and form notification emails need SMTP and <code>SUPABASE_SECRET_KEY</code> on the server.</p>
        </Section>
      )}

      {shopActive && (
        <Section id="shop" icon="🛒" title="Shop">
          <ol>
            <li>Shop → Settings: currency, store address, tax, shipping zones and <strong>at least one payment method</strong>.</li>
            <li>Shop → Products: add products (simple, variable, grouped or external) and publish them.</li>
            <li>For card or PayPal payments, add the Stripe or PayPal keys and <code>SUPABASE_SECRET_KEY</code> to <code>.env.local</code>. Shop → Settings → Status shows which are set.</li>
            <li>Add the shop pages to your menu: <code>/shop</code>, <code>/cart</code>, <code>/checkout</code>, <code>/my-account</code>.</li>
          </ol>
          <p className={styles.muted}>Test Stripe with an <code>sk_test_</code> key and card 4242 4242 4242 4242. Prices, tax and stock are always calculated by the database, never trusted from the browser.</p>
        </Section>
      )}

      <Section id="backup" icon="💾" title="Backup & updates">
        <ul>
          <li><strong>Settings → Backup → Export backup</strong> downloads the whole site (content, settings, shop, media files) as one ZIP. Restore it here or on a fresh installation. It never contains passwords or <code>.env.local</code>, but it does contain customer details: store it safely.</li>
          <li><strong>Dashboard → Updates</strong> checks for new versions of the app and its plugins, by hand or on a schedule, and lists the migrations each update needs. Back up before installing one.</li>
        </ul>
      </Section>

      <Section id="plugins" icon="🔌" title="Writing plugins">
        <p>A plugin is a folder in <code>plugins/</code> with a <code>manifest.json</code> and an <code>index.tsx</code>, picked up at the next build. Inside <code>defineRwpPlugin(manifest, (api) =&gt; …)</code>:</p>
        <ul>
          <li><code>admin.registerPage({'{ id, label, icon, capability, submenu, component }'})</code>: an admin screen. The component receives <code>subsection</code> and <code>navigate</code>.</li>
          <li><code>admin.registerDashboardWidget</code> and <code>admin.registerSetupCheck</code>: a Dashboard panel, and items for the setup checklist.</li>
          <li><code>shortcodes.register({'{ name, render, description, example, attributes }'})</code>: documented here automatically.</li>
          <li><code>routes.register</code>, <code>header.register</code>, <code>content.registerRenderer</code>, <code>content.registerAction</code>, plus <code>actions</code> and <code>filters</code> hooks such as <code>rwp_site_title</code>.</li>
        </ul>
        <p className={styles.muted}>Full reference: <code>plugins/README.md</code>. Add the plugin&rsquo;s id and version to your update feed to have it checked for updates.</p>
      </Section>

      <Section id="troubleshooting" icon="🩹" title="Troubleshooting">
        <dl className={styles.faq}>
          {troubleshooting.map(([problem, fix]) => (
            <div key={problem}><dt>{problem}</dt><dd>{fix}</dd></div>
          ))}
        </dl>
      </Section>
    </div>
  );
}
