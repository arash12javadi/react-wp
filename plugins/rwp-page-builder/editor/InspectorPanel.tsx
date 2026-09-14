import { ChevronRight, Copy, LayoutTemplate, Plus, Trash2 } from 'lucide-react';
import { advancedControls, boxControls, columnControls, getPath, kindLabels, sectionControls } from '../lib/controls';
import { Icon } from '../lib/icons';
import { getWidget, type Control, type ControlTab } from '../lib/registry';
import { effectiveBag } from '../lib/style';
import { findNode, locate } from '../lib/tree';
import type { BuilderNode } from '../lib/types';
import { ControlInput, Row } from './Controls';
import { useEditor, useStore } from './store';
import styles from './editor.module.css';

const tabs: Array<[ControlTab, string]> = [['content', 'Content'], ['style', 'Style'], ['advanced', 'Advanced']];

export function nodeTitle(node: BuilderNode): string {
  if (node.label) return node.label;
  if (node.kind === 'widget') return getWidget(node.type)?.label || node.type;
  return kindLabels[node.kind];
}

function controlsFor(node: BuilderNode, tab: ControlTab): Control[] {
  if (tab === 'advanced') return advancedControls;
  if (node.kind === 'section') return tab === 'content' ? sectionControls : boxControls;
  if (node.kind === 'column') return tab === 'content' ? columnControls : boxControls;
  const definition = getWidget(node.type);
  const own = (definition?.controls || []).filter((control) => (control.tab || 'content') === tab);
  return tab === 'style' ? [...own, ...boxControls] : own;
}

export default function InspectorPanel({ nodeId, onSaveTemplate }: { nodeId: string; onSaveTemplate: (nodeId: string) => void }) {
  const store = useStore();
  const { actions } = store;
  const doc = useEditor((state) => state.doc);
  const device = useEditor((state) => state.device);
  const tab = useEditor((state) => state.inspectorTab);
  const canManageOptions = useEditor((state) => state.canManageOptions);
  const node = findNode(doc, nodeId);
  if (!node) return null;

  const location = locate(doc, nodeId);
  const path = [...(location?.ancestors || []), node];
  const definition = node.kind === 'widget' ? getWidget(node.type) : null;
  const bag = effectiveBag(node.style, device);
  const controls = controlsFor(node, tab).filter((control) => !control.condition || control.condition(node.settings, bag));

  return (
    <div className={styles.inspector}>
      <nav className={styles.breadcrumb} aria-label="Selected element path">
        {path.map((item, index) => (
          <span key={item.id} className={styles.crumb}>
            {index > 0 && <ChevronRight size={12} aria-hidden="true" />}
            <button type="button" aria-current={item.id === nodeId ? 'true' : undefined} onClick={() => actions.select(item.id)}>{nodeTitle(item)}</button>
          </span>
        ))}
      </nav>

      <div className={styles.inspectorHead}>
        <span className={styles.inspectorIcon}><Icon name={definition?.icon || (node.kind === 'section' ? 'columns' : 'square')} size={18} /></span>
        <div>
          <strong>Edit {nodeTitle(node)}</strong>
          {node.label && <small>{definition?.label || kindLabels[node.kind]}</small>}
        </div>
        <div className={styles.inspectorActions}>
          {node.kind === 'section' && (
            <>
              <button type="button" title="Add a column" aria-label="Add a column" onClick={() => actions.addColumn(node.id)}><Plus size={15} /></button>
              <button type="button" title="Save as template" aria-label="Save as template" onClick={() => onSaveTemplate(node.id)}><LayoutTemplate size={15} /></button>
            </>
          )}
          <button type="button" title="Duplicate (Ctrl+D)" aria-label="Duplicate" onClick={() => actions.duplicate(node.id)}><Copy size={15} /></button>
          <button type="button" title="Delete (Del)" aria-label="Delete" onClick={() => actions.remove(node.id)}><Trash2 size={15} /></button>
        </div>
      </div>

      {definition?.adminOnly && !canManageOptions && (
        <p className={styles.warning}>Only an administrator can save a page containing a new or changed Custom HTML widget, because its code runs in visitors&apos; browsers. Saving will be refused until it is removed.</p>
      )}

      <div className={styles.tabs} role="tablist">
        {tabs.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? styles.tabActive : styles.tab} onClick={() => actions.setInspectorTab(id)}>{label}</button>
        ))}
      </div>

      <div className={styles.controls} role="tabpanel">
        {controls.length === 0 && <p className={styles.hint}>Nothing to set here for this element.</p>}
        {controls.map((control) => {
          if (control.type === 'heading') return <h4 key={control.key} className={styles.controlHeading}>{control.label}</h4>;
          const { value, inherited } = actions.readControlValue(node, control);
          const hasOverride = control.responsive && device !== 'desktop' && getPath(node.style[device] as Record<string, unknown> | undefined, control.key) !== undefined;
          return (
            <Row key={control.key} label={control.label} help={control.help}
              device={control.responsive ? device : undefined}
              inherited={inherited && value !== undefined}
              onReset={hasOverride ? () => actions.resetResponsive(node.id, control.key) : undefined}>
              <ControlInput
                control={control}
                value={value}
                kind={node.kind}
                settings={node.settings}
                onSettingChange={(key, next) => actions.setSetting(node.id, key, next)}
                onChange={(next) => actions.setControlValue(node.id, control, next)}
              />
            </Row>
          );
        })}
      </div>
    </div>
  );
}
