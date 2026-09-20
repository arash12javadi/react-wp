import { useEffect, useMemo, useState } from 'react';
import { describeDbError, getSupabaseClient, updateOption } from '../lib/db';
import { rwp, type RwpInstalledPlugin } from '../lib/rwp';
import { BulkBar, RowCheckbox, SelectAllCheckbox, useBulkSelection } from './BulkActions';
import PluginUploadModal, { readPendingInstallResult } from './PluginUploadModal';
import PluginUninstallModal from './PluginUninstallModal';
import { installPluginSchema, isEndpointUnavailable } from '../lib/pluginSchema';
import styles from './PluginsManager.module.css';

const activationOption = 'rwp_active_plugins';

interface PluginRow extends RwpInstalledPlugin {
  plugin_id: string;
  folder: string | null;
  source: string;
  installed_at: string;
  updated_at: string;
}

/** What server.mjs found in plugins/ on disk. */
interface PluginFiles {
  /** False when the listing could not be fetched; `reason` says why. Delete is disabled then. */
  available: boolean;
  reason?: string;
  onDisk: string[];
  /** Folders on disk that the running build does not contain yet. */
  notBuilt: Array<{ id: string; folder: string; name: string }>;
  problems: string[];
}

const fetchPluginFiles = async (accessToken: string | undefined): Promise<Omit<PluginFiles, 'notBuilt'> & { plugins: Array<{ id: string; folder: string; name: string }> }> => {
  const unavailable = (reason: string) => ({ available: false, reason, onDisk: [], plugins: [], problems: [] });
  if (!accessToken) return unavailable('You are not signed in.');
  let response: Response;
  try {
    response = await fetch('/api/plugin-files', { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' });
  } catch {
    return unavailable('The Node server (server.mjs) could not be reached.');
  }
  const body = await response.json().catch(() => ({})) as { plugins?: Array<{ id: string; folder: string; name: string }>; problems?: string[]; error?: string };
  if (!response.ok) {
    return unavailable(response.status === 404
      ? 'This host has no /api/plugin-files endpoint. Plugin files can only be managed when the site runs on server.mjs (npm start); on Vercel, remove the folder from the repository and redeploy.'
      : body.error || `GET /api/plugin-files returned HTTP ${response.status}${response.status >= 500 ? '. In development, is server.mjs running on :3000?' : '.'}`);
  }
  const plugins = body.plugins || [];
  return { available: true, onDisk: plugins.map((plugin) => plugin.id), plugins, problems: body.problems || [] };
};

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
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [files, setFiles] = useState<PluginFiles>({ available: false, onDisk: [], notBuilt: [], problems: [] });
  /** The plugin whose uninstall dialog is open, or null. */
  const [uninstalling, setUninstalling] = useState<PluginRow | null>(null);
  const [pendingInstall] = useState(readPendingInstallResult);
  const [uploadOpen, setUploadOpen] = useState(pendingInstall !== null);
  /** Bumped after an upload so the disk listing (and its "restart to load" notice) is re-read. */
  const [reloadKey, setReloadKey] = useState(0);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return plugins.filter((plugin) =>
      (statusFilter === 'all' || (statusFilter === 'active') === Boolean(plugin.active))
      && (!term || [plugin.name, plugin.plugin_id, plugin.description, plugin.author, plugin.version]
        .filter(Boolean).join(' ').toLowerCase().includes(term)));
  }, [plugins, search, statusFilter]);
  const visibleIds = useMemo(() => visible.map((plugin) => plugin.plugin_id), [visible]);
  const selection = useBulkSelection(visibleIds);
  const activeCount = plugins.filter((plugin) => plugin.active).length;

  useEffect(() => rwp.subscribe(() => refresh((value) => value + 1)), []);

  useEffect(() => {
    let mounted = true;
    const loadPlugins = async () => {
      const supabase = getSupabaseClient();
      const registeredPlugins = rwp.getPlugins();
      const [{ data: sessionData }, { data: existingRows, error: existingError }, { data: activeRow, error: activeError }] = await Promise.all([
        supabase.auth.getSession(),
        supabase.from('plugins').select('plugin_id,active').eq('source', 'bundled'),
        supabase.from('options').select('option_value').eq('option_name', activationOption).maybeSingle(),
      ]);
      if (existingError) throw existingError;
      if (activeError) throw activeError;
      const diskFiles = await fetchPluginFiles(sessionData.session?.access_token);
      // Like WordPress, a plugin is installed while its folder exists. The running build can still
      // contain a folder deleted since it was built (npm start), so the disk listing decides.
      const visiblePlugins = diskFiles.available
        ? registeredPlugins.filter((plugin) => diskFiles.onDisk.includes(plugin.id))
        : registeredPlugins;
      registeredPlugins
        .filter((plugin) => plugin.active && !visiblePlugins.includes(plugin))
        .forEach((plugin) => rwp.deactivatePlugin(plugin.id));
      const registeredIds = visiblePlugins.map((plugin) => plugin.id);
      const pluginFiles: PluginFiles = {
        ...diskFiles,
        notBuilt: diskFiles.plugins.filter((plugin) => !registeredPlugins.some((registered) => registered.id === plugin.id)),
      };
      // No option yet means every bundled plugin is active (App.tsx); otherwise new plugins start inactive.
      const storedActiveIds = activeRow ? readOptionIds(activeRow.option_value) : null;
      const existingById = new Map((existingRows || []).map((row) => [row.plugin_id, row]));
      const metadata = visiblePlugins.map((plugin) => ({
        plugin_id: plugin.id,
        name: plugin.name,
        version: plugin.version,
        author: plugin.author || null,
        description: plugin.description || '',
        folder: `plugins/${diskFiles.plugins.find((item) => item.id === plugin.id)?.folder || plugin.id}`,
        source: 'bundled',
      }));
      const newRows = metadata
        .filter((plugin) => !existingById.has(plugin.plugin_id))
        .map((plugin) => ({ ...plugin, active: storedActiveIds === null || storedActiveIds.includes(plugin.plugin_id) }));
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
      const { data: rows, error: rowsError } = await supabase.from('plugins').select('*').order('name');
      if (rowsError) throw rowsError;
      const ids = storedActiveIds ?? registeredIds;
      const currentIds = ids.filter((id) => registeredIds.includes(id));
      if (storedActiveIds && currentIds.length !== ids.length) await updateOption(activationOption, currentIds);
      const dbRows = ((rows || []) as PluginRow[]).filter((row) => row.source !== 'bundled' || registeredIds.includes(row.plugin_id));
      const registeredById = new Map(registeredPlugins.map((plugin) => [plugin.id, plugin]));
      const mergedRows = dbRows.map((row) => ({
        ...row,
        ...(registeredById.get(row.plugin_id) || {}),
        id: row.plugin_id,
        active: row.active,
      }));
      return { ids: currentIds, registeredPlugins: visiblePlugins, mergedRows, pluginFiles };
    };
    loadPlugins().then(({ ids, registeredPlugins, mergedRows, pluginFiles }) => {
        if (!mounted) return;
        setFiles(pluginFiles);
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
  }, [reloadKey]);

  const describe = (list: PluginRow[]) => (list.length === 1 ? list[0].name : `${list.length} plugins`);

  /** Activates or deactivates several plugins with one write to the table and one to the option. */
  const setActive = async (targets: PluginRow[], nextActive: boolean) => {
    const changing = targets.filter((plugin) => plugin.active !== nextActive);
    if (!changing.length) {
      setFeedback(`${describe(targets)} ${targets.length === 1 ? 'is' : 'are'} already ${nextActive ? 'active' : 'inactive'}.`);
      return;
    }
    const ids = changing.map((plugin) => plugin.plugin_id);
    setSavingId(changing.length === 1 ? ids[0] : 'bulk');
    setError('');
    setFeedback('');
    const nextIds = nextActive
      ? [...new Set([...activeIds, ...ids])]
      : activeIds.filter((id) => !ids.includes(id));
    const notes: string[] = [];
    try {
      // Plugin tables are created on activation, not at install time, so a site that never
      // enables the shop never gets its twenty tables. schema.sql is re-runnable by contract, so
      // activating an already-provisioned plugin is a no-op rather than an error.
      if (nextActive) {
        for (const plugin of changing) {
          try {
            const result = await installPluginSchema(plugin.plugin_id);
            if (result.created?.length) {
              notes.push(`${plugin.name}: created ${result.created.join(', ')}.`);
            }
            if (result.stillMissing?.length) {
              // The SQL ran but did not produce what the manifest promised: worth saying out loud
              // rather than letting the plugin fail later with a "relation does not exist".
              notes.push(`${plugin.name}: schema.sql ran but ${result.stillMissing.join(', ')} ${result.stillMissing.length === 1 ? 'is' : 'are'} still missing.`);
            }
          } catch (schemaError: unknown) {
            if (!isEndpointUnavailable(schemaError)) throw schemaError;
            // Static host: there is no endpoint to run DDL. Activation still works, and the
            // plugin's own screens already explain which migration to run by hand.
            notes.push(`${plugin.name}: its database tables were not checked, because ${schemaError.message}`);
          }
        }
      }
      const supabase = getSupabaseClient();
      const { data, error: updateError } = await supabase
        .from('plugins')
        .update({ active: nextActive, updated_at: new Date().toISOString() })
        .in('plugin_id', ids)
        .select('plugin_id');
      if (updateError) throw updateError;
      if ((data || []).length < ids.length) {
        throw new Error(`The database updated ${(data || []).length} of ${ids.length} plugin rows: row level security skipped the rest. Managing plugins needs the activate_plugins capability.`);
      }
      const saved = await updateOption(activationOption, nextIds);
      if (!saved) throw new Error('Plugin activation state could not be saved.');
      ids.forEach((id) => (nextActive ? rwp.activatePlugin(id) : rwp.deactivatePlugin(id)));
      setActiveIds(nextIds);
      setPlugins((current) => current.map((item) => ids.includes(item.plugin_id) ? { ...item, active: nextActive } : item));
      setFeedback([`${describe(changing)} ${nextActive ? 'activated' : 'deactivated'}.`, ...notes].join(' '));
      selection.clear();
    } catch (toggleError: unknown) {
      setError(toggleError instanceof Error ? toggleError.message : describeDbError(toggleError));
    } finally {
      setSavingId('');
    }
  };

  const deletePlugins = async (targets: PluginRow[]) => {
    if (!targets.length) return;
    setError('');
    setFeedback('');
    if (!files.available) {
      setError(`Plugin files cannot be deleted here: ${files.reason}`);
      return;
    }
    const active = targets.filter((plugin) => plugin.active);
    if (active.length) {
      setError(`Deactivate ${describe(active)} before deleting ${active.length === 1 ? 'it' : 'them'}.`);
      return;
    }
    const question = targets.length === 1
      ? `Delete "${targets[0].name}"? This permanently removes the plugins/${targets[0].plugin_id} folder from the server.`
      : `Delete ${targets.length} plugins? This permanently removes their folders from plugins/ on the server.`;
    if (!window.confirm(question)) return;
    setDeletingId(targets.length === 1 ? targets[0].plugin_id : 'bulk');
    const deletedIds: string[] = [];
    const failures: string[] = [];
    try {
      const supabase = getSupabaseClient();
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error('Your session has expired. Sign in again.');
      for (const plugin of targets) {
        const response = await fetch('/api/plugin-files/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ id: plugin.plugin_id }),
        });
        const body = await response.json().catch(() => ({})) as { error?: string };
        if (!response.ok) {
          failures.push(body.error || `Deleting ${plugin.name} failed: HTTP ${response.status}.`);
          continue;
        }
        deletedIds.push(plugin.plugin_id);
      }
      if (deletedIds.length) {
        const { error: deleteError } = await supabase.from('plugins').delete().in('plugin_id', deletedIds);
        if (deleteError) failures.push(`The folders were deleted, but their rows in the plugins table were not: ${describeDbError(deleteError)}`);
        setPlugins((current) => current.filter((item) => !deletedIds.includes(item.plugin_id)));
        setFiles((current) => ({ ...current, onDisk: current.onDisk.filter((id) => !deletedIds.includes(id)) }));
        const deleted = targets.filter((plugin) => deletedIds.includes(plugin.plugin_id));
        setFeedback(`${describe(deleted)} ${deleted.length === 1 ? 'was' : 'were'} deleted.`);
        selection.clear();
      }
      if (failures.length) setError(failures.join(' '));
    } catch (deleteError: unknown) {
      setError(deleteError instanceof Error ? deleteError.message : describeDbError(deleteError));
    } finally {
      setDeletingId('');
    }
  };

  const onBulk = (action: string, ids: string[]) => {
    const targets = plugins.filter((plugin) => ids.includes(plugin.plugin_id));
    if (action === 'activate') void setActive(targets, true);
    if (action === 'deactivate') void setActive(targets, false);
    if (action === 'delete') void deletePlugins(targets);
  };

  const reloadPlugins = () => {
    window.location.reload();
  };

  if (loading) return <div className={styles.status} role="status">Loading pluginsâ€¦</div>;

  return (
    <section className={styles.wrapper} aria-labelledby="plugins-heading">
      <div className={styles.heading}>
        <div>
          <h2 id="plugins-heading">Plugins</h2>
          <p>Extend React-WP with typed actions, filters, admin pages, widgets, and shortcodes.</p>
          <div className={styles.headingActions}>
            <button type="button" className={styles.upload} onClick={() => setUploadOpen(true)}>Upload Plugin</button>
            <button type="button" className={styles.refresh} onClick={reloadPlugins}>Refresh plugins</button>
          </div>
        </div>
      </div>
      {uploadOpen && (
        <PluginUploadModal
          initialResult={pendingInstall}
          onClose={() => setUploadOpen(false)}
          onInstalled={(installed) => {
            setError('');
            setFeedback(`${installed.plugin.name} ${installed.plugin.version} was uploaded. It appears in this list as inactive once the site has been rebuilt.`);
            setReloadKey((value) => value + 1);
          }}
        />
      )}
      {uninstalling && (
        <PluginUninstallModal
          plugin={uninstalling}
          onDeactivate={() => setActive([uninstalling], false)}
          onClose={() => setUninstalling(null)}
          onFinished={(summary) => {
            setUninstalling(null);
            setError('');
            setFeedback(summary);
            // The folder and possibly its tables are gone; re-read both listings rather than
            // patching state that no longer matches the server.
            setReloadKey((value) => value + 1);
          }}
        />
      )}
      {error && <div className={styles.error} role="alert">{error}</div>}
      {feedback && <div className={styles.feedback} role="status">{feedback}</div>}
      <div className={styles.notice}>
        A plugin is installed while its folder exists in <code>plugins/</code>. Activation is stored in Supabase and shared by every administrator, and it is what creates the plugin&apos;s database tables. <strong>Uninstall</strong> removes the folder and asks what should happen to those tables.
      </div>
      {!files.available && files.reason && (
        <div className={styles.notice} role="status">Plugin folders could not be checked, so Delete is unavailable: {files.reason}</div>
      )}
      {files.notBuilt.length > 0 && (
        <div className={styles.notice} role="status">
          Found {files.notBuilt.map((plugin) => `${plugin.name} (plugins/${plugin.folder})`).join(', ')} on disk, but the running site was built without {files.notBuilt.length === 1 ? 'it' : 'them'}. Restart the server with <code>npm start</code> (which rebuilds) and {files.notBuilt.length === 1 ? 'it' : 'they'} will appear here as inactive. Under <code>npm run dev</code>, reload this page.
        </div>
      )}
      {files.problems.length > 0 && (
        <div className={styles.error} role="alert">{files.problems.join(' ')}</div>
      )}
      {plugins.length === 0 ? (
        <div className={styles.empty}>
          <strong>No plugins registered</strong>
          <span>Built-in and bundled plugins will appear here when they register through the RWP API.</span>
        </div>
      ) : (
        <div className={styles.list}>
          <div className={styles.filters}>
            <div className={styles.filterTabs} role="tablist" aria-label="Filter plugins">
              {([['all', `All (${plugins.length})`], ['active', `Active (${activeCount})`], ['inactive', `Inactive (${plugins.length - activeCount})`]] as const).map(([id, label]) => (
                <button key={id} type="button" role="tab" aria-selected={statusFilter === id}
                  className={statusFilter === id ? styles.filterActive : styles.filter}
                  onClick={() => setStatusFilter(id)}>{label}</button>
              ))}
            </div>
            <input type="search" className={styles.search} value={search} onChange={(event) => setSearch(event.target.value)}
              placeholder="Search pluginsâ€¦" aria-label="Search plugins" />
          </div>
          <BulkBar selection={selection} total={visible.length} noun="plugins"
            busy={savingId === 'bulk' || deletingId === 'bulk' ? 'working' : ''}
            actions={[
              { id: 'activate', label: 'Activate', tone: 'primary', hidden: statusFilter === 'active' },
              { id: 'deactivate', label: 'Deactivate', hidden: statusFilter === 'inactive' },
              // Folders only. Anything touching plugin data goes through the per-plugin
              // Uninstall dialog, which is where the backup and wipe choices live.
              { id: 'delete', label: 'Delete files', tone: 'danger' },
            ]}
            onAction={onBulk} />
          {visible.length === 0 && <div className={styles.empty}><strong>No plugins match</strong><span>Try another search or filter.</span></div>}
          {visible.length > 0 && <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr><th className={styles.checkCell}><SelectAllCheckbox selection={selection} total={visible.length} /></th><th>Plugin</th><th>Description</th><th>Version</th><th>Author</th><th>Status</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {visible.map((plugin) => (
                  <tr key={plugin.plugin_id} className={selection.isSelected(plugin.plugin_id) ? styles.rowSelected : undefined}>
                    <td className={styles.checkCell}><RowCheckbox selection={selection} id={plugin.plugin_id} label={plugin.name} /></td>
                    <td><strong>{plugin.name}</strong><small>{plugin.plugin_id}</small></td>
                    <td>{plugin.description || 'No description provided.'}</td>
                    <td>{plugin.version}</td>
                    <td>{plugin.author || 'â€”'}</td>
                    <td><span className={plugin.active ? styles.active : styles.inactive}>{plugin.active ? 'Active' : 'Inactive'}</span></td>
                    <td>
                      <button
                        type="button"
                        className={plugin.active ? styles.deactivate : styles.activate}
                        disabled={savingId === plugin.plugin_id || deletingId === plugin.plugin_id}
                        onClick={() => void setActive([plugin], !plugin.active)}
                      >
                        {savingId === plugin.plugin_id ? 'Savingâ€¦' : plugin.active ? 'Deactivate' : 'Activate'}
                      </button>
                      <button
                        type="button"
                        className={styles.delete}
                        disabled={savingId === plugin.plugin_id || deletingId === plugin.plugin_id}
                        onClick={() => { setError(''); setFeedback(''); setUninstalling(plugin); }}
                      >
                        Uninstall
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>}
        </div>
      )}
    </section>
  );
}
