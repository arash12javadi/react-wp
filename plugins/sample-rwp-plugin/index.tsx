import { useState } from 'react';
import { defineRwpPlugin } from '../../src/lib/plugin-api';
import manifest from './manifest.json';

function SampleAdminPage() {
  const [message, setMessage] = useState('The sample plugin is active.');

  return (
    <section aria-labelledby="sample-plugin-heading">
      <h2 id="sample-plugin-heading">{manifest.name}</h2>
      <p>{message}</p>
      <button type="button" onClick={() => setMessage('The plugin button works.')}>
        Test plugin action
      </button>
    </section>
  );
}

function SampleDashboardWidget() {
  return (
    <div>
      <strong>Sample plugin widget is running.</strong>
      <p>This confirms that dashboard widget registration works.</p>
    </div>
  );
}

export const samplePluginCleanup = defineRwpPlugin(manifest, ({ admin, filters, actions }) => {
  const removePage = admin.registerPage({
    id: 'sample-plugin',
    label: manifest.name,
    icon: '★',
    component: SampleAdminPage,
  });

  const removeWidget = admin.registerDashboardWidget({
    id: 'sample-plugin-widget',
    title: manifest.name,
    component: SampleDashboardWidget,
  });

  const removeTitleFilter = filters.add(
    'rwp_site_title',
    (title) => `${title} | ${manifest.name}`,
  );

  const makeHomeRed = () => {
    if (window.location.pathname === '/admin') return;
    document.getElementById('rwp-sample-plugin-red-background')?.remove();
    const style = document.createElement('style');
    style.id = 'rwp-sample-plugin-red-background';
    style.textContent = `
      #root > div {
        background: yellow !important;
      }

      #root > div > header,
      #root > div > main,
      #root > div > footer {
        background: transparent !important;
      }
    `;

    document.head.appendChild(style);
  };

  makeHomeRed();
  const removeRedAction = actions.add('rwp_public_loaded', makeHomeRed);

  return () => {
    removePage();
    removeWidget();
    removeTitleFilter();
    removeRedAction();

    document
      .getElementById('rwp-sample-plugin-red-background')
      ?.remove();
  };
});

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    samplePluginCleanup();
  });
}
