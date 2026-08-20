/**
 * Persistence layer.
 *
 * The whole workspace is one JSON-shaped record. It is written to IndexedDB
 * when available, falling back to localStorage and finally to an in-memory
 * object so the app still runs (unsaved) in a locked-down browser or private
 * window where both are blocked.
 *
 * Everything read back in is re-validated by `normalizeState` before it
 * reaches the store: storage is treated as untrusted input, because a user,
 * an extension or a corrupt write can put anything there.
 */

import { DEFAULT_FOLDERS, DEFAULT_PREFERENCES, LIMITS, SCHEMA_VERSION, SEED_NOTES, STORAGE, THEMES, NOTE_VIEWS, EDITOR_SIZES, EDITOR_LEADINGS, DATE_FORMATS, SORT_OPTIONS } from './config.js';
import { sanitizeHtml } from './sanitize.js';
import { foldCase, normalizeSpace, truncate, uid, unique } from './utils.js';

/** @typedef {'idb' | 'local' | 'memory'} StorageDriver */

let driver = /** @type {StorageDriver} */ ('memory');
let db = null;
let memoryRecord = null;

/* ------------------------------------------------------------------
   IndexedDB plumbing
   ------------------------------------------------------------------ */

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window) || !window.indexedDB) {
      reject(new Error('IndexedDB unavailable'));
      return;
    }

    let request;
    try {
      request = indexedDB.open(STORAGE.dbName, STORAGE.dbVersion);
    } catch (error) {
      reject(error);
      return;
    }

    // Some privacy modes leave the request permanently pending.
    const timeout = setTimeout(() => reject(new Error('IndexedDB open timed out')), 4000);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORAGE.storeName)) {
        database.createObjectStore(STORAGE.storeName);
      }
    };
    request.onsuccess = () => {
      clearTimeout(timeout);
      resolve(request.result);
    };
    request.onerror = () => {
      clearTimeout(timeout);
      reject(request.error ?? new Error('IndexedDB open failed'));
    };
    request.onblocked = () => {
      clearTimeout(timeout);
      reject(new Error('IndexedDB blocked by another tab'));
    };
  });
}

function idbRequest(mode, work) {
  return new Promise((resolve, reject) => {
    let tx;
    try {
      tx = db.transaction(STORAGE.storeName, mode);
    } catch (error) {
      reject(error);
      return;
    }
    const store = tx.objectStore(STORAGE.storeName);
    let result;
    try {
      const request = work(store);
      if (request) request.onsuccess = () => { result = request.result; };
    } catch (error) {
      reject(error);
      return;
    }
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

/* ------------------------------------------------------------------
   localStorage plumbing
   ------------------------------------------------------------------ */

function localStorageWorks() {
  try {
    const probe = '__nota_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------
   Public API
   ------------------------------------------------------------------ */

/**
 * Pick the best available driver. Never throws.
 * @returns {Promise<StorageDriver>}
 */
export async function initStorage() {
  try {
    db = await openDatabase();
    driver = 'idb';
    return driver;
  } catch {
    db = null;
  }

  driver = localStorageWorks() ? 'local' : 'memory';
  return driver;
}

/**
 * Read the persisted workspace.
 * @returns {Promise<{ state: object | null, corrupted: boolean }>}
 */
export async function loadState() {
  let raw = null;

  try {
    if (driver === 'idb' && db) {
      raw = await idbRequest('readonly', (store) => store.get(STORAGE.recordKey));
    } else if (driver === 'local') {
      const text = localStorage.getItem(STORAGE.fallbackKey);
      raw = text ? JSON.parse(text) : null;
    } else {
      raw = memoryRecord;
    }
  } catch {
    // A parse failure or a broken transaction both mean "unreadable".
    return { state: null, corrupted: true };
  }

  if (raw === null || raw === undefined) return { state: null, corrupted: false };

  try {
    return { state: normalizeState(raw), corrupted: false };
  } catch {
    return { state: null, corrupted: true };
  }
}

/**
 * Persist the workspace. Rejects if the write fails so callers can surface
 * a save error rather than silently losing data.
 * @param {object} state
 */
export async function saveState(state) {
  const record = serializeState(state);

  if (driver === 'idb' && db) {
    await idbRequest('readwrite', (store) => store.put(record, STORAGE.recordKey));
    return;
  }

  if (driver === 'local') {
    // Throws QuotaExceededError when full — intentionally propagated.
    localStorage.setItem(STORAGE.fallbackKey, JSON.stringify(record));
    return;
  }

  memoryRecord = record;
}

/** Remove everything this app has stored on the device. */
export async function clearStorage() {
  memoryRecord = null;

  if (driver === 'idb' && db) {
    try {
      await idbRequest('readwrite', (store) => store.delete(STORAGE.recordKey));
    } catch {
      /* falls through to the mirrors below */
    }
  }

  try {
    localStorage.removeItem(STORAGE.fallbackKey);
    localStorage.removeItem(STORAGE.themeKey);
    localStorage.removeItem(STORAGE.onboardedKey);
  } catch {
    /* storage disabled; nothing to clear */
  }
}

/**
 * Theme is mirrored to localStorage so the inline script in index.html can
 * paint the correct colours before any module loads.
 */
export function mirrorTheme(theme) {
  try {
    localStorage.setItem(STORAGE.themeKey, theme);
  } catch {
    /* non-fatal */
  }
}

export function readOnboarded() {
  try {
    return localStorage.getItem(STORAGE.onboardedKey) === '1';
  } catch {
    return false;
  }
}

export function markOnboarded() {
  try {
    localStorage.setItem(STORAGE.onboardedKey, '1');
  } catch {
    /* non-fatal: onboarding simply shows again next session */
  }
}

/* ------------------------------------------------------------------
   Shape: serialise, validate, migrate
   ------------------------------------------------------------------ */

/** Strip transient UI state; only durable data is written. */
export function serializeState(state) {
  return {
    schemaVersion: SCHEMA_VERSION,
    savedAt: Date.now(),
    notes: state.notes,
    folders: state.folders,
    tags: state.tags,
    preferences: state.preferences,
  };
}

/**
 * Coerce an arbitrary record into a valid workspace. Unknown fields are
 * dropped, malformed entries are skipped, and anything missing gets a
 * sensible default. Throws only if the input is not an object at all.
 *
 * @param {unknown} raw
 * @returns {{ schemaVersion: number, notes: object[], folders: object[], tags: object[], preferences: object }}
 */
export function normalizeState(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError('Workspace record must be an object');
  }

  const migrated = migrate(raw);

  const folders = normalizeFolders(migrated.folders);
  const folderIds = new Set(folders.map((folder) => folder.id));
  const notes = normalizeNotes(migrated.notes, folderIds);
  const tags = normalizeTags(migrated.tags, notes);

  return {
    schemaVersion: SCHEMA_VERSION,
    notes,
    folders,
    tags,
    preferences: normalizePreferences(migrated.preferences),
  };
}

/**
 * Forward-migrate older records. Version 1 is the first public schema, so
 * this currently only guards against records from a future build.
 */
function migrate(raw) {
  const version = Number(raw.schemaVersion);
  if (!Number.isFinite(version) || version < 1) {
    return { ...raw, schemaVersion: SCHEMA_VERSION };
  }
  if (version > SCHEMA_VERSION) {
    // Newer file: keep only the fields this build understands.
    return {
      schemaVersion: SCHEMA_VERSION,
      notes: raw.notes,
      folders: raw.folders,
      tags: raw.tags,
      preferences: raw.preferences,
    };
  }
  return raw;
}

function normalizeFolders(input) {
  if (!Array.isArray(input)) return DEFAULT_FOLDERS.map((folder) => ({ ...folder }));

  const seen = new Set();
  const folders = [];

  input.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') return;
    const id = typeof entry.id === 'string' && entry.id ? entry.id : uid('fld');
    if (seen.has(id)) return;

    const name = truncate(normalizeSpace(entry.name), LIMITS.folderNameMaxLength);
    if (!name) return;

    seen.add(id);
    folders.push({
      id,
      name,
      order: Number.isFinite(entry.order) ? Number(entry.order) : index,
      isDefault: entry.isDefault === true,
    });
  });

  return folders.sort((a, b) => a.order - b.order);
}

function normalizeNotes(input, folderIds) {
  if (!Array.isArray(input)) return [];

  const seen = new Set();
  const notes = [];
  const now = Date.now();

  for (const entry of input) {
    if (!entry || typeof entry !== 'object') continue;

    const id = typeof entry.id === 'string' && entry.id ? entry.id : uid('note');
    if (seen.has(id)) continue;
    seen.add(id);

    const createdAt = toTimestamp(entry.createdAt, now);
    const updatedAt = toTimestamp(entry.updatedAt, createdAt);
    const isDeleted = entry.isDeleted === true;

    notes.push({
      id,
      title: truncate(normalizeSpace(entry.title), LIMITS.titleMaxLength),
      content: sanitizeHtml(typeof entry.content === 'string' ? entry.content : ''),
      folderId: folderIds.has(entry.folderId) ? entry.folderId : null,
      tags: normalizeTagList(entry.tags),
      createdAt,
      updatedAt,
      isFavorite: entry.isFavorite === true,
      isPinned: entry.isPinned === true,
      isArchived: entry.isArchived === true,
      isDeleted,
      deletedAt: isDeleted ? toTimestamp(entry.deletedAt, updatedAt) : null,
    });
  }

  return notes;
}

/** Tag records are derived data; the notes are the source of truth. */
function normalizeTags(input, notes) {
  const used = new Map();
  for (const note of notes) {
    for (const tag of note.tags) {
      used.set(tag, (used.get(tag) ?? 0) + 1);
    }
  }

  const tags = [];
  const seen = new Set();

  if (Array.isArray(input)) {
    for (const entry of input) {
      const name = typeof entry === 'string' ? entry : entry?.name;
      const normalized = normalizeTagName(name);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      tags.push({ id: normalized, name: normalized });
    }
  }

  for (const tag of used.keys()) {
    if (seen.has(tag)) continue;
    seen.add(tag);
    tags.push({ id: tag, name: tag });
  }

  return tags;
}

export function normalizeTagName(value) {
  const folded = foldCase(normalizeSpace(value)).replace(/[^\p{L}\p{N}_-]+/gu, '-');
  return truncate(folded.replace(/^-+|-+$/g, ''), LIMITS.tagMaxLength);
}

function normalizeTagList(value) {
  if (!Array.isArray(value)) return [];
  return unique(value.map(normalizeTagName).filter(Boolean)).slice(0, 12);
}

function toTimestamp(value, fallback) {
  const numeric = typeof value === 'string' ? Date.parse(value) : Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function pick(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

export function normalizePreferences(input) {
  const source = input && typeof input === 'object' ? input : {};
  return {
    theme: pick(source.theme, THEMES, DEFAULT_PREFERENCES.theme),
    language: pick(source.language, ['en', 'az'], DEFAULT_PREFERENCES.language),
    noteView: pick(source.noteView, NOTE_VIEWS, DEFAULT_PREFERENCES.noteView),
    sort: pick(source.sort, SORT_OPTIONS, DEFAULT_PREFERENCES.sort),
    dateFormat: pick(source.dateFormat, DATE_FORMATS, DEFAULT_PREFERENCES.dateFormat),
    editorFontSize: pick(source.editorFontSize, EDITOR_SIZES, DEFAULT_PREFERENCES.editorFontSize),
    lineHeight: pick(source.lineHeight, EDITOR_LEADINGS, DEFAULT_PREFERENCES.lineHeight),
    spellcheck: source.spellcheck !== false,
  };
}

/* ------------------------------------------------------------------
   First run
   ------------------------------------------------------------------ */

/**
 * Build a fresh workspace.
 * @param {{ seed?: boolean }} [options]
 */
export function createInitialState({ seed = false } = {}) {
  const folders = DEFAULT_FOLDERS.map((folder) => ({ ...folder }));
  const notes = seed ? buildSeedNotes() : [];

  return normalizeState({
    schemaVersion: SCHEMA_VERSION,
    folders,
    notes,
    tags: [],
    preferences: { ...DEFAULT_PREFERENCES },
  });
}

function buildSeedNotes() {
  const now = Date.now();
  return SEED_NOTES.map((seed) => {
    const updatedAt = now - seed.ageMinutes * 60_000;
    return {
      id: uid('note'),
      title: seed.title,
      content: seed.content,
      folderId: seed.folderId,
      tags: seed.tags,
      createdAt: updatedAt - 36 * 60 * 60_000,
      updatedAt,
      isFavorite: seed.isFavorite === true,
      isPinned: seed.isPinned === true,
      isArchived: false,
      isDeleted: false,
      deletedAt: null,
    };
  });
}

/** Guard used by import: refuse absurdly large files before parsing. */
export function isImportSizeAcceptable(bytes) {
  return Number.isFinite(bytes) && bytes > 0 && bytes <= LIMITS.maxImportBytes;
}
