/**
 * Hash router.
 *
 * The URL carries enough state to restore a session: which view is open,
 * which folder or tag scopes it, the active search, and the selected note.
 * That makes every screen linkable and the back button meaningful, without
 * a server or a build step.
 *
 *   #/all
 *   #/folder/fld-work?note=note-abc
 *   #/tag/javascript
 *   #/search?q=systems
 *   #/settings
 */

import { VIEWS } from './config.js';

/**
 * @typedef {object} Route
 * @property {string} view
 * @property {string | null} folderId
 * @property {string | null} tag
 * @property {string} query
 * @property {string | null} noteId
 */

const PARAMLESS_VIEWS = new Set([
  VIEWS.all,
  VIEWS.favorites,
  VIEWS.pinned,
  VIEWS.archive,
  VIEWS.trash,
  VIEWS.settings,
]);

/** @returns {Route} */
export function emptyRoute() {
  return { view: VIEWS.all, folderId: null, tag: null, query: '', noteId: null };
}

/**
 * @param {string} hash
 * @returns {Route}
 */
export function parseHash(hash) {
  const route = emptyRoute();
  const raw = String(hash ?? '').replace(/^#/, '');
  if (!raw || raw === '/') return route;

  const [pathPart, queryPart = ''] = raw.split('?');
  const params = new URLSearchParams(queryPart);
  const segments = pathPart.split('/').filter(Boolean).map(decodeURIComponent);

  const [head, param] = segments;

  if (PARAMLESS_VIEWS.has(head)) {
    route.view = head;
  } else if (head === VIEWS.folder && param) {
    route.view = VIEWS.folder;
    route.folderId = param;
  } else if (head === VIEWS.tag && param) {
    route.view = VIEWS.tag;
    route.tag = param;
  } else if (head === VIEWS.search) {
    route.view = VIEWS.search;
  }

  if (route.view === VIEWS.search) route.query = params.get('q') ?? '';
  route.noteId = params.get('note') || null;

  return route;
}

/**
 * @param {Partial<Route>} route
 * @returns {string} the `#/...` string
 */
export function buildHash(route) {
  const view = route.view ?? VIEWS.all;
  let path = `/${view}`;

  if (view === VIEWS.folder && route.folderId) {
    path += `/${encodeURIComponent(route.folderId)}`;
  } else if (view === VIEWS.tag && route.tag) {
    path += `/${encodeURIComponent(route.tag)}`;
  }

  const params = new URLSearchParams();
  if (view === VIEWS.search && route.query) params.set('q', route.query);
  if (route.noteId && view !== VIEWS.settings) params.set('note', route.noteId);

  const search = params.toString();
  return `#${path}${search ? `?${search}` : ''}`;
}

let onChange = null;
let lastHash = '';

/**
 * @param {(route: Route) => void} handler called on load and on every change
 */
export function initRouter(handler) {
  onChange = handler;

  window.addEventListener('hashchange', () => {
    if (window.location.hash === lastHash) return;
    lastHash = window.location.hash;
    onChange?.(parseHash(lastHash));
  });

  if (!window.location.hash) {
    // Seed a canonical hash so the first back press has somewhere to go.
    window.history.replaceState(null, '', buildHash(emptyRoute()));
  }

  lastHash = window.location.hash;
  onChange?.(parseHash(lastHash));
}

/**
 * Change the URL. Writes are skipped when the hash already matches, which
 * keeps state-driven updates from fighting the router.
 *
 * @param {Partial<Route>} route
 * @param {{ replace?: boolean, silent?: boolean }} [options]
 */
export function navigate(route, { replace = false, silent = false } = {}) {
  const hash = buildHash(route);
  if (hash === window.location.hash) return;

  lastHash = hash;
  if (replace) {
    window.history.replaceState(null, '', hash);
  } else {
    window.history.pushState(null, '', hash);
  }

  if (!silent) onChange?.(parseHash(hash));
}

/** Reflect current state in the URL without adding a history entry. */
export function syncHash(route) {
  navigate(route, { replace: true, silent: true });
}

