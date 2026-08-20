/**
 * Folder domain. Folders are flat by design — nesting adds a tree UI and a
 * class of "where did my note go" bugs that this product does not need.
 */

import { LIMITS } from './config.js';
import { store } from './store.js';
import { compareText, foldCase, normalizeSpace, truncate, uid } from './utils.js';

/**
 * @typedef {object} Folder
 * @property {string} id
 * @property {string} name
 * @property {number} order
 * @property {boolean} isDefault
 */

/** @returns {Folder | null} */
export function getFolder(state, id) {
  if (!id) return null;
  return state.folders.find((folder) => folder.id === id) ?? null;
}


export function listFolders(state) {
  return [...state.folders].sort((a, b) => a.order - b.order);
}

/**
 * @param {string} name
 * @param {string} [ignoreId] the folder being renamed
 * @returns {'ok' | 'empty' | 'duplicate'}
 */
export function validateFolderName(name, ignoreId) {
  const clean = normalizeSpace(name);
  if (!clean) return 'empty';

  const exists = store
    .getState()
    .folders.some((folder) => folder.id !== ignoreId && foldCase(folder.name) === foldCase(clean));

  return exists ? 'duplicate' : 'ok';
}

/** @returns {Folder | null} */
export function createFolder(name) {
  if (validateFolderName(name) !== 'ok') return null;

  const state = store.getState();
  const folder = {
    id: uid('fld'),
    name: truncate(normalizeSpace(name), LIMITS.folderNameMaxLength),
    order: state.folders.reduce((max, entry) => Math.max(max, entry.order), -1) + 1,
    isDefault: false,
  };

  store.set({ folders: [...state.folders, folder] }, ['folders']);
  return folder;
}

export function renameFolder(id, name) {
  if (validateFolderName(name, id) !== 'ok') return false;

  const state = store.getState();
  const folders = state.folders.map((folder) =>
    folder.id === id
      ? { ...folder, name: truncate(normalizeSpace(name), LIMITS.folderNameMaxLength) }
      : folder,
  );

  store.set({ folders }, ['folders']);
  return true;
}

/**
 * Remove a folder. Its notes are never deleted — they fall back to Unfiled,
 * where the user can find them again.
 *
 * @returns {number} how many notes were moved
 */
export function deleteFolder(id) {
  const state = store.getState();
  if (!getFolder(state, id)) return 0;

  let moved = 0;
  const notes = state.notes.map((note) => {
    if (note.folderId !== id) return note;
    moved += 1;
    return { ...note, folderId: null };
  });

  store.set(
    { folders: state.folders.filter((folder) => folder.id !== id), notes },
    ['folders', 'notes'],
  );

  if (state.ui.selectedFolderId === id) {
    store.setUI({ selectedFolderId: null });
  }

  return moved;
}

export function countNotesInFolder(state, id) {
  return state.notes.filter(
    (note) => note.folderId === id && !note.isDeleted && !note.isArchived,
  ).length;
}

/** Folder options for a "move to" menu, Unfiled first. */
export function folderOptions(state, unfiledLabel) {
  const folders = [...state.folders].sort((a, b) => compareText(a.name, b.name, state.preferences.language));
  return [{ id: null, name: unfiledLabel }, ...folders];
}
