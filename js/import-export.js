/**
 * JSON backup: the only way data enters or leaves the app.
 *
 * Import is a full replace, confirmed by the user, because a merge needs a
 * conflict story (same id, different content, different clocks) that a
 * single-device product cannot answer honestly. Replace is unambiguous.
 */

import { APP, SCHEMA_VERSION } from './config.js';
import { t } from './i18n.js';
import { normalizeState, isImportSizeAcceptable } from './storage.js';
import { store } from './store.js';
import { toISODate } from './utils.js';

/** @returns {object} the backup payload */
export function buildBackup(state) {
  return {
    application: APP.name,
    appVersion: APP.version,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    notes: state.notes,
    folders: state.folders,
    tags: state.tags,
    preferences: state.preferences,
  };
}

export function backupFilename(date = new Date()) {
  return `nota-backup-${toISODate(date)}.json`;
}

/**
 * Serialise and hand the file to the browser.
 * @returns {boolean} whether the download started
 */
export function exportBackup(state) {
  let url = null;
  try {
    const json = JSON.stringify(buildBackup(state), null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    url = URL.createObjectURL(blob);

    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = backupFilename();
    anchor.rel = 'noopener';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    return true;
  } catch (error) {
    console.error('Export failed', error);
    return false;
  } finally {
    // Revoking immediately can cancel the download in some browsers.
    if (url) setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

/**
 * @typedef {object} ImportResult
 * @property {boolean} ok
 * @property {string} [reason]
 * @property {object} [state] validated workspace, ready to hydrate
 * @property {number} [noteCount]
 * @property {number} [folderCount]
 */

/**
 * Parse and validate a backup file without applying it, so the caller can
 * describe what is about to happen before asking for confirmation.
 *
 * @param {File} file
 * @returns {Promise<ImportResult>}
 */
export async function readBackupFile(file) {
  if (!file) return { ok: false, reason: 'missing' };
  if (!isImportSizeAcceptable(file.size)) return { ok: false, reason: 'size' };

  let text;
  try {
    text = await file.text();
  } catch {
    return { ok: false, reason: 'unreadable' };
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'json' };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'shape' };
  }

  // A backup must at least claim to carry notes; an arbitrary JSON object
  // that happens to parse is not one.
  if (!Array.isArray(parsed.notes) && !Array.isArray(parsed.folders)) {
    return { ok: false, reason: 'shape' };
  }

  let state;
  try {
    state = normalizeState(parsed);
  } catch {
    return { ok: false, reason: 'shape' };
  }

  return {
    ok: true,
    state,
    noteCount: state.notes.length,
    folderCount: state.folders.length,
  };
}

/**
 * Replace the workspace with a validated backup.
 * @param {object} state from `readBackupFile`
 */
export function applyBackup(state) {
  store.hydrate({
    schemaVersion: state.schemaVersion,
    notes: state.notes,
    folders: state.folders,
    tags: state.tags,
    preferences: state.preferences,
  });
  store.setUI({ selectedNoteId: null, selectedFolderId: null, searchQuery: '' });
}

/** Human-readable failure text for a rejected import. */
export function describeImportFailure(reason) {
  switch (reason) {
    case 'size':
      return `${t('data.importFailed')} (>20 MB)`;
    default:
      return t('data.importFailed');
  }
}
