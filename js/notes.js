/**
 * Note domain: creation, mutation and the selectors every view reads from.
 * This module owns what a note *is*; it never touches the DOM.
 */

import { LIMITS, VIEWS } from './config.js';
import { htmlToText } from './sanitize.js';
import { store } from './store.js';
import { compareText, truncate, uid, unique } from './utils.js';
import { normalizeTagName } from './storage.js';

/**
 * @typedef {object} Note
 * @property {string} id
 * @property {string} title
 * @property {string} content sanitised HTML
 * @property {string | null} folderId
 * @property {string[]} tags
 * @property {number} createdAt
 * @property {number} updatedAt
 * @property {boolean} isFavorite
 * @property {boolean} isPinned
 * @property {boolean} isArchived
 * @property {boolean} isDeleted
 * @property {number | null} deletedAt
 */

/* ------------------------------------------------------------------
   Factory
   ------------------------------------------------------------------ */

/** @param {Partial<Note>} [overrides] @returns {Note} */
export function makeNote(overrides = {}) {
  const now = Date.now();
  return {
    id: uid('note'),
    title: '',
    content: '',
    folderId: null,
    tags: [],
    createdAt: now,
    updatedAt: now,
    isFavorite: false,
    isPinned: false,
    isArchived: false,
    isDeleted: false,
    deletedAt: null,
    ...overrides,
  };
}

/* ------------------------------------------------------------------
   Selectors
   ------------------------------------------------------------------ */

/** @returns {Note | null} */
export function getNote(state, id) {
  if (!id) return null;
  return state.notes.find((note) => note.id === id) ?? null;
}

/** The note currently open in the editor, if it still exists. */
export function getSelectedNote(state) {
  return getNote(state, state.ui.selectedNoteId);
}

/**
 * Plain-text projection of a note body, memoised per (id, updatedAt) so
 * scrolling a long list does not re-parse every note on every render.
 */
const textCache = new Map();

export function noteText(note) {
  const key = `${note.id}:${note.updatedAt}`;
  const cached = textCache.get(key);
  if (cached !== undefined) return cached;

  const text = htmlToText(note.content);
  if (textCache.size > 600) textCache.clear();
  textCache.set(key, text);
  return text;
}

export function noteExcerpt(note, length = LIMITS.excerptLength) {
  return truncate(noteText(note), length);
}

/** Notes belonging to a view, before sorting. */
export function filterNotesForView(state, view = state.ui.activeView) {
  const { notes, ui } = state;

  switch (view) {
    case VIEWS.trash:
      return notes.filter((note) => note.isDeleted);
    case VIEWS.archive:
      return notes.filter((note) => note.isArchived && !note.isDeleted);
    case VIEWS.favorites:
      return notes.filter((note) => note.isFavorite && isActive(note));
    case VIEWS.pinned:
      return notes.filter((note) => note.isPinned && isActive(note));
    case VIEWS.folder:
      return notes.filter((note) => isActive(note) && note.folderId === ui.selectedFolderId);
    case VIEWS.tag:
      return notes.filter((note) => isActive(note) && note.tags.includes(ui.selectedTag));
    case VIEWS.all:
    default:
      return notes.filter(isActive);
  }
}

/** Not archived and not in the trash. */
export function isActive(note) {
  return !note.isDeleted && !note.isArchived;
}

/**
 * Sort a list of notes. Pinned notes float to the top everywhere except
 * the trash, where deletion time is what the user is looking for.
 */
export function sortNotes(notes, sort, { locale = 'en', groupPinned = true } = {}) {
  const compare = COMPARATORS[sort] ?? COMPARATORS['updated-desc'];
  return [...notes].sort((a, b) => {
    if (groupPinned && a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
    return compare(a, b, locale);
  });
}

const COMPARATORS = {
  'updated-desc': (a, b) => b.updatedAt - a.updatedAt,
  'updated-asc': (a, b) => a.updatedAt - b.updatedAt,
  'created-desc': (a, b) => b.createdAt - a.createdAt,
  'title-asc': byTitle(1),
  'title-desc': byTitle(-1),
};

/**
 * Alphabetical comparison that keeps blank notes out of the way. A note with
 * no title and no text sorts as an empty string, which would otherwise park
 * it at the top of an A–Z list even though the list shows it as "Untitled" —
 * so empties always sink to the bottom, whichever direction is chosen.
 */
function byTitle(direction) {
  return (a, b, locale) => {
    const left = titleKey(a);
    const right = titleKey(b);
    if (!left !== !right) return left ? -1 : 1;
    return direction * compareText(left, right, locale) || b.updatedAt - a.updatedAt;
  };
}

function titleKey(note) {
  return note.title || noteText(note).slice(0, 60);
}

/** Counts shown next to the sidebar entries. */
export function getViewCounts(state) {
  let all = 0;
  let favorites = 0;
  let pinned = 0;
  let archive = 0;
  let trash = 0;
  const byFolder = new Map();

  for (const note of state.notes) {
    if (note.isDeleted) {
      trash += 1;
      continue;
    }
    if (note.isArchived) {
      archive += 1;
      continue;
    }
    all += 1;
    if (note.isFavorite) favorites += 1;
    if (note.isPinned) pinned += 1;
    const key = note.folderId ?? '__unfiled__';
    byFolder.set(key, (byFolder.get(key) ?? 0) + 1);
  }

  return { all, favorites, pinned, archive, trash, byFolder };
}

/* ------------------------------------------------------------------
   Mutations
   ------------------------------------------------------------------ */

/**
 * Apply a patch to one note and bump `updatedAt`.
 * @param {string} id
 * @param {Partial<Note> | ((note: Note) => Partial<Note>)} patch
 * @param {{ touch?: boolean }} [options] set `touch: false` for changes that
 *   should not count as an edit (restoring from trash, for instance)
 */
export function updateNote(id, patch, { touch = true } = {}) {
  const state = store.getState();
  let changed = false;

  const notes = state.notes.map((note) => {
    if (note.id !== id) return note;
    const delta = typeof patch === 'function' ? patch(note) : patch;
    if (!delta || Object.keys(delta).length === 0) return note;
    changed = true;
    return {
      ...note,
      ...delta,
      updatedAt: touch ? Date.now() : (delta.updatedAt ?? note.updatedAt),
    };
  });

  if (!changed) return null;
  store.set({ notes }, ['notes']);
  return getNote(store.getState(), id);
}

/**
 * Create a note and select it. New notes land in the folder the user is
 * currently looking at, which is almost always what they meant.
 *
 * @param {Partial<Note>} [seed]
 * @returns {Note}
 */
export function createNote(seed = {}) {
  const state = store.getState();
  const { activeView, selectedFolderId, selectedTag } = state.ui;

  const note = makeNote({
    folderId: activeView === VIEWS.folder ? selectedFolderId : null,
    tags: activeView === VIEWS.tag && selectedTag ? [selectedTag] : [],
    isFavorite: activeView === VIEWS.favorites,
    isPinned: activeView === VIEWS.pinned,
    ...seed,
  });

  store.set({ notes: [note, ...state.notes] }, ['notes']);
  return note;
}

/** @param {string} id @returns {Note | null} the copy */
export function duplicateNote(id) {
  const source = getNote(store.getState(), id);
  if (!source) return null;

  const copy = makeNote({
    title: source.title ? `${source.title} (copy)` : '',
    content: source.content,
    folderId: source.folderId,
    tags: [...source.tags],
  });

  const state = store.getState();
  const index = state.notes.findIndex((note) => note.id === id);
  const notes = [...state.notes];
  notes.splice(index + 1, 0, copy);
  store.set({ notes }, ['notes']);
  return copy;
}

export function togglePinned(id) {
  return updateNote(id, (note) => ({ isPinned: !note.isPinned }), { touch: false });
}

export function toggleFavorite(id) {
  return updateNote(id, (note) => ({ isFavorite: !note.isFavorite }), { touch: false });
}

export function toggleArchived(id) {
  return updateNote(id, (note) => ({ isArchived: !note.isArchived, isPinned: false }), {
    touch: false,
  });
}

/** Soft delete: the note stays recoverable until the trash is emptied. */
export function trashNote(id) {
  return updateNote(
    id,
    { isDeleted: true, deletedAt: Date.now(), isPinned: false },
    { touch: false },
  );
}

export function restoreNote(id) {
  return updateNote(id, { isDeleted: false, deletedAt: null }, { touch: false });
}

/** Irreversible. Callers must confirm first. */
export function destroyNote(id) {
  const state = store.getState();
  const notes = state.notes.filter((note) => note.id !== id);
  if (notes.length === state.notes.length) return false;

  store.set({ notes }, ['notes']);
  if (state.ui.selectedNoteId === id) {
    store.setUI({ selectedNoteId: null });
  }
  return true;
}

/** Irreversible. @returns {number} how many notes were removed */
export function emptyTrash() {
  const state = store.getState();
  const notes = state.notes.filter((note) => !note.isDeleted);
  const removed = state.notes.length - notes.length;
  if (!removed) return 0;

  const selected = getSelectedNote(state);
  store.set({ notes }, ['notes']);
  if (selected?.isDeleted) store.setUI({ selectedNoteId: null });
  return removed;
}

export function moveNoteToFolder(id, folderId) {
  return updateNote(id, { folderId: folderId ?? null }, { touch: false });
}

/* ------------------------------------------------------------------
   Tag assignment
   ------------------------------------------------------------------ */

/** @returns {string | null} the normalised tag that was added */
export function addTagToNote(id, rawTag) {
  const tag = normalizeTagName(rawTag);
  if (!tag) return null;

  const note = getNote(store.getState(), id);
  if (!note || note.tags.includes(tag)) return null;
  if (note.tags.length >= 12) return null;

  updateNote(id, { tags: unique([...note.tags, tag]) }, { touch: false });
  return tag;
}

export function removeTagFromNote(id, tag) {
  const note = getNote(store.getState(), id);
  if (!note || !note.tags.includes(tag)) return;
  updateNote(id, { tags: note.tags.filter((entry) => entry !== tag) }, { touch: false });
}
