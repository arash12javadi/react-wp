# React-WP

React-WP uses one Supabase project per deployed website, just like WordPress uses one database for one site. Configure the site's Supabase connection in the deployment environment so every browser loads the same content.

Copy `.env.example` to `.env.local` and set:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

The publishable key is safe for browser use when Row Level Security is configured. Never expose `SUPABASE_SECRET_KEY` to the browser or commit `.env.local`.

The browser-local setup wizard remains a development fallback when the Vite environment variables are absent. For a deployed site, configure the variables in the hosting provider (for example, Vercel) and redeploy.

## Self-hosted WordPress-style installation

For a host with a persistent Node.js process and writable storage, use the portable server:

```bash
npm run build
npm start
```

The first installation writes the public site configuration to:

```text
data/react-wp-config.json
```

This is the React-WP equivalent of `wp-config.php`. It is created by the installer, is excluded from Git, and is served only through the public values needed by the browser. Database passwords and PostgreSQL connection strings are never returned to browsers.

Keep the `data/` directory on a persistent volume. If the host clears that directory on restart, React-WP will ask for installation again.

The installer first tries the generated PostgreSQL host. If that is unavailable from the host, enter the exact Supabase Session pooler connection string in the setup wizard. The server uses it to install the schema and then stores the shared public Supabase configuration for every browser.

## RWP plugin and hook API

React-WP exposes a typed extension API from [`src/lib/plugin-api.ts`](./src/lib/plugin-api.ts). Plugin IDs should use a unique prefix such as `ajdwp-`; public hooks use the `rwp_` prefix.

```ts
import { rwp } from './src/lib/plugin-api';

const cleanup = rwp.registerPlugin({
  id: 'ajdwp-seo-checklist',
  name: 'AJDWP SEO Checklist',
  version: '1.0.0',
  author: 'Arash Javadi',
  register({ actions, filters, admin, shortcodes }) {
    const removeFilter = filters.add('rwp_post_excerpt', (excerpt) => `${excerpt} [SEO]`);
    const removeAction = actions.add('rwp_post_created', (post) => {
      console.log('New post:', post);
    });
    const removePage = admin.registerPage({
      id: 'seo-checklist',
      label: 'SEO Checklist',
      component: SeoChecklistPage,
    });
    const removeShortcode = shortcodes.register({
      name: 'seo_score',
      render: () => 'SEO score',
    });
    return () => {
      removeFilter();
      removeAction();
      removePage();
      removeShortcode();
    };
  },
});
```

Available actions include `rwp_init`, `rwp_admin_loaded`, `rwp_public_loaded`, `rwp_user_logged_in`, `rwp_post_created`, `rwp_post_updated`, `rwp_settings_saved`, and `rwp_menu_saved`. Filters include `rwp_site_title`, `rwp_public_menu`, `rwp_posts`, `rwp_post_title`, `rwp_post_excerpt`, and `rwp_admin_navigation`.

Registered admin pages appear in the admin navigation, dashboard widgets render on the dashboard, and registered shortcodes can be rendered by future content components. Plugin cleanup functions should always remove registrations when a plugin is deactivated.

### Installing a personal copy

The repository contains only placeholders. Each person can download or clone the project and install it against their own Supabase project:

1. Copy the project to their computer or Node.js host.
2. Run `npm install`, `npm run build`, and `npm start`.
3. Open the site and enter their own Supabase URL, publishable/anon key, database password, and (when needed) Session pooler connection string.
4. Complete the administrator setup.

The installer creates `data/react-wp-config.json` locally on that installation. The file is intentionally ignored by Git, so it is not uploaded to GitHub. It contains only the public Supabase URL/key used by browsers; database passwords and PostgreSQL connection strings are used by the server during installation and are not written to that file.

Never commit `.env`, `.env.local`, database dumps, connection strings, database passwords, secret keys, or service-role keys. The tracked [`react-wp.config.example.json`](./react-wp.config.example.json) contains placeholders only.

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
