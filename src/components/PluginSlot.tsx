import { useSyncExternalStore } from 'react';
import { rwp, type RwpDashboardWidget } from '../lib/rwp';

let revision = 0;
const listeners = new Set<() => void>();
const notify = () => {
  revision += 1;
  listeners.forEach((listener) => listener());
};

export function notifyRwpRegistryChanged(): void {
  notify();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const snapshot = () => revision;

export function PluginDashboardWidgets() {
  useSyncExternalStore(subscribe, snapshot);
  const widgets: RwpDashboardWidget[] = rwp.getDashboardWidgets();
  return (
    <>
      {widgets.map(({ id, title, component: Widget }) => (
        <section key={id} aria-labelledby={`${id}-heading`}>
          <h2 id={`${id}-heading`}>{title}</h2>
          <Widget />
        </section>
      ))}
    </>
  );
}

