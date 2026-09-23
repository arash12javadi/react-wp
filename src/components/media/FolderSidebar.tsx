import { useState, type DragEvent, type KeyboardEvent } from 'react';
import {
  DEFAULT_MEDIA_FOLDER, folderManagerMigration, isQuietMediaFolder, quietFolderIcons, quietFolderLabels,
} from '../../lib/mediaFolders';
import styles from './FolderSidebar.module.css';

/** Drag payload for media thumbnails dropped on a folder: a JSON array of media ids. */
export const MEDIA_DRAG_TYPE = 'application/x-rwp-media-ids';

export interface FolderNode {
  path: string;
  name: string;
  depth: number;
  /** Items directly in this folder. */
  count: number;
  /** Items in this folder and its subfolders. */
  total: number;
}

export type FolderDeleteChoice = { mode: 'move'; to: string } | { mode: 'delete-media' };

interface FolderSidebarProps {
  nodes: FolderNode[];
  allCount: number;
  active: string;
  onSelect: (path: string) => void;
  /** False until the folder manager migration has been run: folders can be browsed but not managed. */
  manageable: boolean;
  busy: boolean;
  folderListId: string;
  onCreate: (name: string) => Promise<boolean>;
  onRename: (path: string, name: string) => Promise<boolean>;
  onDelete: (path: string, choice: FolderDeleteChoice) => Promise<boolean>;
  onDropMedia: (path: string, ids: string[]) => void;
}

export default function FolderSidebar({
  nodes, allCount, active, onSelect, manageable, busy, folderListId, onCreate, onRename, onDelete, onDropMedia,
}: FolderSidebarProps) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteMode, setDeleteMode] = useState<'move' | 'delete-media'>('move');
  const [moveTo, setMoveTo] = useState(DEFAULT_MEDIA_FOLDER);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const startCreate = () => {
    setRenaming(null);
    setDeleting(null);
    // A new folder starts inside the one being browsed, which is the common case.
    setNewName(active !== 'all' ? `${active}/` : '');
    setCreating(true);
  };

  const submitCreate = async () => {
    if (!newName.trim()) return setCreating(false);
    if (await onCreate(newName)) setCreating(false);
  };

  const startRename = (path: string) => {
    setCreating(false);
    setDeleting(null);
    setRenaming(path);
    setRenameDraft(path);
  };

  const submitRename = async () => {
    if (!renaming) return;
    if (!renameDraft.trim() || renameDraft.trim() === renaming) return setRenaming(null);
    if (await onRename(renaming, renameDraft)) setRenaming(null);
  };

  const startDelete = (path: string) => {
    setCreating(false);
    setRenaming(null);
    setDeleting(path);
    setDeleteMode('move');
    setMoveTo(DEFAULT_MEDIA_FOLDER);
  };

  const submitDelete = async (node: FolderNode) => {
    const choice: FolderDeleteChoice = node.total === 0 || deleteMode === 'move'
      ? { mode: 'move', to: moveTo }
      : { mode: 'delete-media' };
    if (choice.mode === 'delete-media'
      && !window.confirm(`Permanently delete ${node.total} item(s) in “${node.path}”, including the files at Cloudinary/ImageKit? This cannot be undone.`)) return;
    if (await onDelete(node.path, choice)) setDeleting(null);
  };

  const keys = (submit: () => void, cancel: () => void) => (event: KeyboardEvent<HTMLInputElement>) => {
    // Enter must not submit an editor form the library may be open inside.
    if (event.key === 'Enter') { event.preventDefault(); submit(); }
    if (event.key === 'Escape') { event.preventDefault(); cancel(); }
  };

  const dropHandlers = (path: string) => ({
    onDragOver: (event: DragEvent) => {
      if (!event.dataTransfer.types.includes(MEDIA_DRAG_TYPE)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      setDropTarget(path);
    },
    onDragLeave: () => setDropTarget((current) => (current === path ? null : current)),
    onDrop: (event: DragEvent) => {
      setDropTarget(null);
      const raw = event.dataTransfer.getData(MEDIA_DRAG_TYPE);
      if (!raw) return;
      event.preventDefault();
      try {
        const ids = JSON.parse(raw) as unknown;
        if (Array.isArray(ids) && ids.every((id) => typeof id === 'string')) onDropMedia(path, ids);
      } catch {
        // Not our payload.
      }
    },
  });

  return (
    <nav className={styles.sidebar} aria-label="Media folders">
      <div className={styles.head}>
        <strong>Folders</strong>
        {manageable && (
          <button type="button" className={styles.newButton} onClick={startCreate} disabled={busy}>+ New</button>
        )}
      </div>

      {creating && (
        <div className={styles.inlineForm}>
          <input autoFocus list={folderListId} value={newName} onChange={(event) => setNewName(event.target.value)}
            onKeyDown={keys(() => void submitCreate(), () => setCreating(false))}
            placeholder="e.g. blog/2026" aria-label="New folder name" />
          <div className={styles.inlineActions}>
            <button type="button" className={styles.primary} disabled={busy} onClick={() => void submitCreate()}>Create</button>
            <button type="button" className={styles.ghost} onClick={() => setCreating(false)}>Cancel</button>
          </div>
        </div>
      )}

      <ul className={styles.list}>
        <li>
          <button type="button" className={active === 'all' ? styles.itemActive : styles.item} onClick={() => onSelect('all')}>
            <span className={styles.label}>🗂️ All media</span>
            <span className={styles.count}>{allCount}</span>
          </button>
        </li>
        {nodes.map((node) => (
          <li key={node.path}>
            {renaming === node.path ? (
              <div className={styles.inlineForm} style={{ marginLeft: node.depth * 12 }}>
                <input autoFocus value={renameDraft} onChange={(event) => setRenameDraft(event.target.value)}
                  onKeyDown={keys(() => void submitRename(), () => setRenaming(null))}
                  aria-label={`Rename folder ${node.path}`} />
                <span className={styles.hint}>Use “/” to move it, e.g. archive/{node.name}</span>
                <div className={styles.inlineActions}>
                  <button type="button" className={styles.primary} disabled={busy} onClick={() => void submitRename()}>Save</button>
                  <button type="button" className={styles.ghost} onClick={() => setRenaming(null)}>Cancel</button>
                </div>
              </div>
            ) : (
              <div className={`${styles.row} ${dropTarget === node.path ? styles.dropTarget : ''}`} {...dropHandlers(node.path)}>
                <button type="button" className={active === node.path ? styles.itemActive : styles.item}
                  style={{ paddingLeft: 8 + node.depth * 12 }} onClick={() => onSelect(node.path)}
                  title={isQuietMediaFolder(node.path) ? `${node.path} — kept out of “All media” so it does not bury the site's own images` : node.path}>
                  <span className={styles.label}>
                    {node.depth > 0 ? '└ ' : ''}{quietFolderIcons[node.path] || '📁'} {quietFolderLabels[node.path] || node.name}
                  </span>
                  <span className={styles.count} title={`${node.count} here, ${node.total} including subfolders`}>{node.total}</span>
                </button>
                {manageable && node.path !== DEFAULT_MEDIA_FOLDER && (
                  <span className={styles.rowActions}>
                    <button type="button" aria-label={`Rename ${node.path}`} title="Rename or move" disabled={busy} onClick={() => startRename(node.path)}>✎</button>
                    <button type="button" aria-label={`Delete ${node.path}`} title="Delete folder" disabled={busy} onClick={() => startDelete(node.path)}>🗑</button>
                  </span>
                )}
              </div>
            )}

            {deleting === node.path && (
              <div className={styles.deletePanel} role="group" aria-label={`Delete folder ${node.path}`}>
                {node.total === 0 ? (
                  <p>Delete the empty folder “{node.path}”{nodes.some((other) => other.path.startsWith(`${node.path}/`)) ? ' and its empty subfolders' : ''}?</p>
                ) : (
                  <>
                    <p>“{node.path}” holds {node.total} item(s){node.total !== node.count ? ' including subfolders' : ''}. What should happen to them?</p>
                    <label className={styles.choice}>
                      <input type="radio" checked={deleteMode === 'move'} onChange={() => setDeleteMode('move')} />
                      Move them to
                      <input list={folderListId} value={moveTo} onChange={(event) => setMoveTo(event.target.value)}
                        onFocus={() => setDeleteMode('move')} aria-label="Folder to move the media to" />
                    </label>
                    <label className={styles.choice}>
                      <input type="radio" checked={deleteMode === 'delete-media'} onChange={() => setDeleteMode('delete-media')} />
                      Delete them permanently (also at Cloudinary/ImageKit)
                    </label>
                  </>
                )}
                <div className={styles.inlineActions}>
                  <button type="button" className={styles.danger} disabled={busy} onClick={() => void submitDelete(node)}>
                    {busy ? 'Working…' : 'Delete folder'}
                  </button>
                  <button type="button" className={styles.ghost} onClick={() => setDeleting(null)}>Cancel</button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>

      {manageable ? (
        <p className={styles.hint}>Drag images onto a folder to move them.</p>
      ) : (
        <p className={styles.hint}>To create, rename and delete folders, run <code>{folderManagerMigration}</code> in the Supabase SQL Editor.</p>
      )}
    </nav>
  );
}
