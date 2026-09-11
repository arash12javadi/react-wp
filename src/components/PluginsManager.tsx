import { useEffect, useState } from 'react';
import { getOption, getSupabaseClient, updateOption } from '../lib/db';
import { rwp, type RwpInstalledPlugin } from '../lib/rwp';
import styles from './PluginsManager.module.css';

const activationOption = 'rwp_active_plugins';
const deletedOption = 'rwp_deleted_plugins';

interface PluginRow extends RwpInstalledPlugin {
  plugin_id: string;
  folder: string | null;
  source: string;
  installed_at: string;
  updated_at: string;
}

const readActiveIds = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];

const readOptionIds = (value: string | null | undefined): string[] => {
  if (!value) return [];
  try {
    return readActiveIds(JSON.parse(value));
  } catch {
    return [];
  }
};

export default function PluginsManager() {
  const [plugins, setPlugins] = useState<PluginRow[]>([]);
  const [activeIds, setActiveIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState('');
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [deletingId, setDeletingId] = useState('');
  const [, refresh] = useState(0);

  useEffect(() => rwp.subscribe(() => refresh((value) => value + 1)), []);

  useEffect(() => {
    let mounted = true;
    const loadPlugins = async () => {
      const supabase = getSupabaseClient();
      const registeredPlugins = rwp.getPlugins();
      const [{ data: deletedOptionRow }, { data: existingRows, error: existingError }] = await Promise.all([
        supabase.from('options').select('option_value').eq('option_name', deletedOption).maybeSingle(),
        supabase.from('plugins').select('plugin_id,active').eq('source', 'bundled'),
      ]);
      const deletedIds = readOptionIds(deletedOptionRow?.option_value);
      const visiblePlugins = registeredPlugins.filter((plugin) => !deletedIds.includes(plugin.id));
      deletedIds.forEach((id) => {
        if (registeredPlugins.some((plugin) => plugin.id === id)) rwp.deactivatePlugin(id);
      });
      const registeredIds = visiblePlugins.map((plugin) => plugin.id);
      if (existingError) throw existingError;
      const existingById = new Map((existingRows || []).map((row) => [row.plugin_id, row]));
      const metadata = visiblePlugins.map((plugin) => ({
        plugin_id: plugin.id,
        name: plugin.name,
        version: plugin.version,
        author: plugin.author || null,
        description: plugin.description || '',
        folder: `plugins/${plugin.id}`,
        source: 'bundled',
      }));
      const newRows = metadata
        .filter((plugin) => !existingById.has(plugin.plugin_id))
        .map((plugin) => ({ ...plugin, active: true }));
      if (newRows.length > 0) {
        const { error: insertError } = await supabase.from('plugins').insert(newRows);
        if (insertError) throw insertError;
      }
      for (const plugin of metadata.filter((item) => existingById.has(item.plugin_id))) {
        const { error: updateError } = await supabase
          .from('plugins')
          .update({
            name: plugin.name,
            version: plugin.version,
            author: plugin.author,
            description: plugin.description,
            folder: plugin.folder,
            source: plugin.source,
            updated_at: new Date().toISOString(),
          })
          .eq('plugin_id', plugin.plugin_id);
        if (updateError) throw updateError;
      }
      const staleIds = (existingRows || [])
        .map((row) => row.plugin_id)
        .filter((pluginId) => !registeredIds.includes(pluginId));
      if (staleIds.length > 0) {
        const { error: deleteError } = await supabase
          .from('plugins')
          .delete()
          .eq('source', 'bundled')
          .in('plugin_id', staleIds);
        if (deleteError) throw deleteError;
      }
      const [{ data: rows, error: rowsError }, storedIds] = await Promise.all([
        supabase.from('plugins').select('*').order('name'),
        getOption<unknown>(activationOption, []),
      ]);
      if (rowsError) throw rowsError;
      const ids = readActiveIds(storedIds).filter((id) => !deletedIds.includes(id));
      const currentIds = ids.filter((id) => registeredIds.includes(id));
      if (currentIds.length !== ids.length) await updateOption(activationOption, currentIds);
      const dbRows = (rows || []) as PluginRow[];
      const registeredById = new Map(registeredPlugins.map((plugin) => [plugin.id, plugin]));
      const mergedRows = dbRows.map((row) => ({
        ...row,
        ...(registeredById.get(row.plugin_id) || {}),
        id: row.plugin_id,
        active: row.active,
      }));
      return { ids: currentIds, registeredPlugins: visiblePlugins, mergedRows };
    };
    loadPlugins().then(({ ids, registeredPlugins, mergedRows }) => {
        if (!mounted) return;
        setActiveIds(ids);
        setPlugins(mergedRows);
        registeredPlugins.forEach((plugin) => {
          const row = mergedRows.find((item) => item.plugin_id === plugin.id);
          if (row?.active && !plugin.active) rwp.activatePlugin(plugin.id);
          if (!row?.active && plugin.active) rwp.deactivatePlugin(plugin.id);
        });
        setPlugins(mergedRows.map((row) => ({ ...row, active: rwp.getPlugins().find((plugin) => plugin.id === row.plugin_id)?.active ?? row.active })));
      })
      .catch((loadError: unknown) => {
        if (mounted) {
          const message = loadError instanceof Error ? loadError.message : 'Unable to load plugins.';
          setError(
            message.includes('relation') && message.includes('plugins')
              ? 'The plugins table is missing. Run supabase/migrations/20260911_create_plugins.sql in the Supabase SQL Editor, then reload this page.'
              : message,
          );
        }
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const togglePlugin = async (plugin: PluginRow) => {
    setSavingId(plugin.id);
    setError('');
    setFeedback('');
    const nextActive = !plugin.active;
    const nextIds = nextActive
      ? [...new Set([...activeIds, plugin.id])]
      : activeIds.filter((id) => id !== plugin.id);
    try {
      const supabase = getSupabaseClient();
      const { error: updateError } = await supabase
        .from('plugins')
        .update({ active: nextActive, updated_at: new Date().toISOString() })
        .eq('plugin_id', plugin.plugin_id);
      if (updateError) throw updateError;
      const saved = await updateOption(activationOption, nextIds);
      if (!saved) throw new Error('Plugin activation state could not be saved.');
      if (nextActive) rwp.activatePlugin(plugin.id);
      else rwp.deactivatePlugin(plugin.id);
      setActiveIds(nextIds);
      setPlugins((current) => current.map((item) => item.plugin_id === plugin.plugin_id ? { ...item, active: nextActive } : item));
      setFeedback(`${plugin.name} ${nextActive ? 'activated' : 'deactivated'}.`);
    } catch (toggleError: unknown) {
      setError(toggleError instanceof Error ? toggleError.message : 'Unable to update plugin.');
    } finally {
      setSavingId('');
    }
  };

  const deletePlugin = async (plugin: PluginRow) => {
    if (!window.confirm(`Delete "${plugin.name}" from the plugin registry? This does not delete bundled source files.`)) return;
    setDeletingId(plugin.plugin_id);
    setError('');
    setFeedback('');
    try {
      const supabase = getSupabaseClient();
      const { error: deleteError } = await supabase
        .from('plugins')
        .delete()
        .eq('plugin_id', plugin.plugin_id);
      if (deleteError) throw deleteError;
      const nextIds = activeIds.filter((id) => id !== plugin.plugin_id);
      const saved = await updateOption(activationOption, nextIds);
      if (!saved) throw new Error('Plugin registry was deleted, but its activation state could not be saved.');
      if (plugin.active) rwp.deactivatePlugin(plugin.plugin_id);
      const deleted = await getOption<unknown>(deletedOption, []);
      await updateOption(deletedOption, [...new Set([...readActiveIds(deleted), plugin.plugin_id])]);
      setActiveIds(nextIds);
      setPlugins((current) => current.filter((item) => item.plugin_id !== plugin.plugin_id));
      setFeedback(`${plugin.name} was removed from the plugin registry.`);
    } catch (deleteError: unknown) {
      setError(deleteError instanceof Error ? deleteError.message : 'Unable to delete plugin.');
    } finally {
      setDeletingId('');
    }
  };

  const reloadPlugins = () => {
    window.location.reload();
  };

  if (loading) return <div className={styles.status} role="status">Loading plugins…</div>;

  return (
    <section className={styles.wrapper} aria-labelledby="plugins-heading">
      <div className={styles.heading}>
        <div>
          <h2 id="plugins-heading">Plugins</h2>
          <p>Extend React-WP with typed actions, filters, admin pages, widgets, and shortcodes.</p>
          <button type="button" className={styles.refresh} onClick={reloadPlugins}>Refresh plugins</button>
        </div>
      </div>
      {error && <div className={styles.error} role="alert">{error}</div>}
      {feedback && <div className={styles.feedback} role="status">{feedback}</div>}
      <div className={styles.notice}>
        Plugin activation is stored in Supabase and shared by every administrator. Uploaded JavaScript is not executed yet; a sandboxed installer will be added before third-party code installation is enabled.
      </div>
      {plugins.length === 0 ? (
        <div className={styles.empty}>
          <strong>No plugins registered</strong>
          <span>Built-in and bundled plugins will appear here when they register through the RWP API.</span>
        </div>
      ) : (
        <div className={styles.list}>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr><th>Plugin</th><th>Description</th><th>Version</th><th>Author</th><th>Status</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {plugins.map((plugin) => (
                  <tr key={plugin.plugin_id}>
                    <td><strong>{plugin.name}</strong><small>{plugin.plugin_id}</small></td>
                    <td>{plugin.description || 'No description provided.'}</td>
                    <td>{plugin.version}</td>
                    <td>{plugin.author || '—'}</td>
                    <td><span className={plugin.active ? styles.active : styles.inactive}>{plugin.active ? 'Active' : 'Inactive'}</span></td>
                    <td>
                      <button
                        type="button"
                        className={plugin.active ? styles.deactivate : styles.activate}
                        disabled={savingId === plugin.plugin_id || deletingId === plugin.plugin_id}
                        onClick={() => void togglePlugin(plugin)}
                      >
                        {savingId === plugin.plugin_id ? 'Saving…' : plugin.active ? 'Deactivate' : 'Activate'}
                      </button>
                      <button
                        type="button"
                        className={styles.delete}
                        disabled={savingId === plugin.plugin_id || deletingId === plugin.plugin_id}
                        onClick={() => void deletePlugin(plugin)}
                      >
                        {deletingId === plugin.plugin_id ? 'Deleting…' : 'Delete'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
