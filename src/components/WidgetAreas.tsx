import { useEffect, useState, type DragEvent } from 'react';
import { getSupabaseClient } from '../lib/db';
import {
  areaLabels, createWidget, emptyAreas, loadWidgetAreas, saveWidgetAreas,
  widgetTypes, type Widget, type WidgetAreaId, type WidgetAreas as Areas, type WidgetType,
} from '../lib/widgets';
import ClassicEditor from './ClassicEditor';
import styles from './WidgetAreas.module.css';

interface MenuOption {
  id: number;
  name: string;
}

const areaIds: WidgetAreaId[] = ['sidebar', 'footer'];

export default function WidgetAreas() {
  const [areas, setAreas] = useState<Areas>(emptyAreas);
  const [menus, setMenus] = useState<MenuOption[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [dragged, setDragged] = useState<{ area: WidgetAreaId; id: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const [stored, { data }] = await Promise.all([
          loadWidgetAreas(),
          getSupabaseClient().from('menus').select('id,name').order('name'),
        ]);
        setAreas(stored);
        setMenus((data || []) as MenuOption[]);
      } catch (loadError: unknown) {
        setError(loadError instanceof Error ? loadError.message : 'Unable to load widgets.');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  const updateArea = (area: WidgetAreaId, widgets: Widget[]) =>
    setAreas((current) => ({ ...current, [area]: widgets }));

  const addWidget = (area: WidgetAreaId, type: WidgetType) => {
    const widget = createWidget(type);
    updateArea(area, [...areas[area], widget]);
    setExpanded(widget.id);
  };

  const patchWidget = (area: WidgetAreaId, id: string, changes: Partial<Widget>) =>
    updateArea(area, areas[area].map((widget) => (widget.id === id ? { ...widget, ...changes } : widget)));

  const patchSetting = (area: WidgetAreaId, id: string, key: string, value: string | number | boolean) =>
    updateArea(area, areas[area].map((widget) =>
      widget.id === id ? { ...widget, settings: { ...widget.settings, [key]: value } } : widget));

  const handleDrop = (event: DragEvent, area: WidgetAreaId, targetId: string | null) => {
    event.preventDefault();
    if (!dragged) return;
    const source = areas[dragged.area].find((widget) => widget.id === dragged.id);
    if (!source) return;

    const withoutSource = areas[dragged.area].filter((widget) => widget.id !== dragged.id);
    const next: Areas = { ...areas, [dragged.area]: withoutSource };
    const destination = [...(dragged.area === area ? withoutSource : next[area])];
    const index = targetId ? destination.findIndex((widget) => widget.id === targetId) : destination.length;
    destination.splice(index < 0 ? destination.length : index, 0, source);

    setAreas({ ...next, [area]: destination });
    setDragged(null);
  };

  const save = async () => {
    setSaving(true);
    setError('');
    setFeedback('');
    try {
      await saveWidgetAreas(areas);
      setFeedback('Widgets saved.');
    } catch (saveError: unknown) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save widgets.');
    } finally {
      setSaving(false);
    }
  };

  const renderSettings = (area: WidgetAreaId, widget: Widget) => {
    switch (widget.type) {
      case 'search':
        return (
          <label>Placeholder
            <input value={String(widget.settings.placeholder ?? '')}
              onChange={(event) => patchSetting(area, widget.id, 'placeholder', event.target.value)} />
          </label>
        );
      case 'recent-posts':
        return (
          <label>Number of posts
            <input type="number" min={1} max={20} value={Number(widget.settings.count ?? 5)}
              onChange={(event) => patchSetting(area, widget.id, 'count', Number(event.target.value))} />
          </label>
        );
      case 'categories':
        return (
          <label className={styles.checkbox}>
            <input type="checkbox" checked={Boolean(widget.settings.showCounts)}
              onChange={(event) => patchSetting(area, widget.id, 'showCounts', event.target.checked)} />
            Show post counts
          </label>
        );
      case 'text':
        return (
          <div className={styles.editorField}>
            <span>Content</span>
            <ClassicEditor
              value={String(widget.settings.content ?? '')}
              onChange={(content) => patchSetting(area, widget.id, 'content', content)}
              placeholder="Widget content…"
            />
          </div>
        );
      case 'menu':
        return (
          <label>Menu
            <select value={String(widget.settings.menuId ?? '')}
              onChange={(event) => patchSetting(area, widget.id, 'menuId', event.target.value)}>
              <option value="">Select a menu</option>
              {menus.map((menu) => <option key={menu.id} value={String(menu.id)}>{menu.name}</option>)}
            </select>
            {menus.length === 0 && <span className={styles.help}>No menus yet — create one under the Menus tab.</span>}
          </label>
        );
      case 'login':
        return (
          <>
            <label>Button label
              <input value={String(widget.settings.label ?? '')} placeholder="Log in"
                onChange={(event) => patchSetting(area, widget.id, 'label', event.target.value)} />
            </label>
            <label>Style
              <select value={String(widget.settings.style ?? 'button')}
                onChange={(event) => patchSetting(area, widget.id, 'style', event.target.value)}>
                <option value="button">Button</option>
                <option value="link">Link</option>
              </select>
            </label>
          </>
        );
      default:
        return null;
    }
  };

  if (loading) return <div className={styles.loading} role="status">Loading widgets…</div>;

  return (
    <div>
      <div className={styles.heading}>
        <p className={styles.lead}>
          Drag widgets into an area, reorder them, and open one to change its settings. The sidebar appears on pages
          that have <strong>Show sidebar</strong> enabled in the editor.
        </p>
        <button type="button" className={styles.primary} onClick={() => void save()} disabled={saving}>
          {saving ? 'Saving…' : 'Save widgets'}
        </button>
      </div>

      {error && <div className={styles.error} role="alert">{error}</div>}
      {feedback && <div className={styles.feedback} role="status">{feedback}</div>}

      <div className={styles.layout}>
        <aside className={styles.available}>
          <h3>Available widgets</h3>
          {widgetTypes.map((definition) => (
            <div key={definition.type} className={styles.availableItem}>
              <strong>{definition.label}</strong>
              <span>{definition.description}</span>
              <div className={styles.addButtons}>
                {areaIds.map((area) => (
                  <button key={area} type="button" onClick={() => addWidget(area, definition.type)}>
                    Add to {areaLabels[area]}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </aside>

        <div className={styles.areas}>
          {areaIds.map((area) => (
            <section
              key={area}
              className={styles.area}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => handleDrop(event, area, null)}
            >
              <h3>{areaLabels[area]}</h3>
              {areas[area].length === 0 ? (
                <p className={styles.empty}>Drop widgets here, or use “Add to {areaLabels[area]}”.</p>
              ) : areas[area].map((widget) => (
                <div
                  key={widget.id}
                  className={styles.widget}
                  draggable
                  onDragStart={() => setDragged({ area, id: widget.id })}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => { event.stopPropagation(); handleDrop(event, area, widget.id); }}
                >
                  <div className={styles.widgetHeader}>
                    <span className={styles.handle} aria-hidden="true">⠿</span>
                    <strong>{widget.title || widget.type}</strong>
                    <span className={styles.typeTag}>{widget.type}</span>
                    <button type="button" aria-expanded={expanded === widget.id}
                      onClick={() => setExpanded(expanded === widget.id ? null : widget.id)}>
                      {expanded === widget.id ? 'Close' : 'Edit'}
                    </button>
                    <button type="button" className={styles.danger}
                      onClick={() => updateArea(area, areas[area].filter((item) => item.id !== widget.id))}>
                      Remove
                    </button>
                  </div>
                  {expanded === widget.id && (
                    <div className={styles.widgetBody}>
                      <label>Title
                        <input value={widget.title}
                          onChange={(event) => patchWidget(area, widget.id, { title: event.target.value })} />
                        <span className={styles.help}>Leave blank to hide the heading.</span>
                      </label>
                      {renderSettings(area, widget)}
                    </div>
                  )}
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
