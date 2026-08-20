/**
 * The single source of truth.
 *
 * State is replaced, never mutated in place, so a subscriber can compare
 * references cheaply. Updates are coalesced into one microtask, which means a
 * user action that touches several slices still produces a single render pass.
 *
 * Every update declares which slices it changed ('notes', 'folders', 'tags',
 * 'preferences', 'ui', plus dotted keys like 'ui.selectedNoteId'). Views
 * subscribe with the slices they care about and skip everything else.
 */

import { DEFAULT_PREFERENCES, VIEWS } from './config.js';

/** @returns {object} an empty workspace; replaced by `hydrate` at startup */
function blankState() {
  return {
    schemaVersion: 1,
    notes: [],
    folders: [],
    tags: [],
    preferences: { ...DEFAULT_PREFERENCES },
    ui: {
      activeView: VIEWS.all,
      selectedNoteId: null,
      selectedFolderId: null,
      selectedTag: null,
      searchQuery: '',
      commandPaletteOpen: false,
      sidebarOpen: false,
      mobilePane: 'list',
      saveState: 'idle',
      storageDriver: 'memory',
      ready: false,
    },
  };
}

function createStore() {
  let state = blankState();
  const listeners = new Set();
  const pending = new Set();
  let scheduled = false;
  let notifying = false;

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(flush);
  }

  function flush() {
    scheduled = false;
    if (!pending.size || notifying) return;

    const changed = new Set(pending);
    pending.clear();

    notifying = true;
    try {
      for (const listener of [...listeners]) {
        try {
          listener(state, changed);
        } catch (error) {
          // One broken view must not take the rest of the app down.
          console.error('Store subscriber failed', error);
        }
      }
    } finally {
      notifying = false;
    }

    // A subscriber may have queued more work.
    if (pending.size) schedule();
  }

  function mark(keys) {
    for (const key of keys) {
      pending.add(key);
      const dot = key.indexOf('.');
      if (dot > 0) pending.add(key.slice(0, dot));
    }
    schedule();
  }

  return {
    getState: () => state,

    /** Replace the whole workspace, e.g. on load or import. */
    hydrate(next) {
      state = { ...state, ...next, ui: { ...state.ui, ...(next.ui ?? {}) } };
      mark(['notes', 'folders', 'tags', 'preferences', 'ui']);
    },

    /**
     * Merge a patch into the root state.
     * @param {Record<string, unknown>} patch
     * @param {string[]} [changed] defaults to the patch keys
     */
    set(patch, changed) {
      state = { ...state, ...patch };
      mark(changed ?? Object.keys(patch));
    },

    /** Merge a patch into `ui`. */
    setUI(patch) {
      state = { ...state, ui: { ...state.ui, ...patch } };
      mark(Object.keys(patch).map((key) => `ui.${key}`));
    },

    /** Merge a patch into `preferences`. */
    setPreferences(patch) {
      state = { ...state, preferences: { ...state.preferences, ...patch } };
      mark(Object.keys(patch).map((key) => `preferences.${key}`));
    },

    /**
     * @param {(state: object, changed: Set<string>) => void} listener
     * @returns {() => void} unsubscribe
     */
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    /** Deliver pending notifications now, for callers that need the DOM. */
    flush,
  };
}

export const store = createStore();

/**
 * True when any of `keys` (or a slice they belong to) changed.
 * @param {Set<string>} changed
 * @param {string[]} keys
 */
export function touches(changed, keys) {
  return keys.some((key) => changed.has(key));
}
