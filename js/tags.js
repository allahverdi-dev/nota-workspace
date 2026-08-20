/**
 * Tags are derived from the notes that use them rather than being managed
 * as first-class records. A tag exists exactly as long as a note carries it,
 * so there is no orphan cleanup and no second source of truth to reconcile.
 */

import { store } from './store.js';
import { compareText } from './utils.js';
import { isActive } from './notes.js';
import { normalizeTagName } from './storage.js';

export { normalizeTagName };

/**
 * @param {object} state
 * @param {{ includeInactive?: boolean }} [options]
 * @returns {{ name: string, count: number }[]} sorted by frequency, then name
 */
export function listTags(state, { includeInactive = false } = {}) {
  const counts = new Map();

  for (const note of state.notes) {
    if (!includeInactive && !isActive(note)) continue;
    for (const tag of note.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || compareText(a.name, b.name, state.preferences.language));
}

/**
 * Keep the persisted `tags` list in step with what the notes actually use.
 * Called after mutations so an export never carries stale entries.
 */
export function syncTagIndex() {
  const state = store.getState();
  const used = new Set();

  for (const note of state.notes) {
    for (const tag of note.tags) used.add(tag);
  }

  const current = new Set(state.tags.map((tag) => tag.id));
  const sameSize = current.size === used.size;
  if (sameSize && [...used].every((tag) => current.has(tag))) return;

  const tags = [...used].sort().map((name) => ({ id: name, name }));
  store.set({ tags }, ['tags']);
}
