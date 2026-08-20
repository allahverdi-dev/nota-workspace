/**
 * Framework-free helpers: DOM construction, timing, ids, dates, text.
 * Every function here is pure or DOM-local — no app state is touched.
 */

/* ------------------------------------------------------------------
   DOM
   ------------------------------------------------------------------ */

/** @type {(selector: string, scope?: ParentNode) => HTMLElement | null} */
export const qs = (selector, scope = document) => scope.querySelector(selector);

/** @type {(selector: string, scope?: ParentNode) => HTMLElement[]} */
export const qsa = (selector, scope = document) => [...scope.querySelectorAll(selector)];

/**
 * Create an element. Text is always assigned via textContent, so callers
 * cannot accidentally introduce markup from user data.
 *
 * @param {string} tag
 * @param {Record<string, unknown>} [props] - `class`, `text`, `dataset`, `aria*`,
 *   `on*` handlers, or any attribute name.
 * @param {(Node | string | null | false | undefined)[]} [children]
 */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;

    if (key === 'class') {
      node.className = value;
    } else if (key === 'text') {
      node.textContent = String(value);
    } else if (key === 'dataset') {
      Object.assign(node.dataset, value);
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(node.style, value);
    } else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) {
      node.setAttribute(key, '');
    } else {
      node.setAttribute(key, String(value));
    }
  }

  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }

  return node;
}

/**
 * Reference an icon from the inline sprite in index.html.
 * @param {string} name - sprite symbol id without the `i-` prefix
 */
export function icon(name, { size = '', className = '', filled = false } = {}) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', ['icon', size && `icon--${size}`, filled && 'icon--filled', className]
    .filter(Boolean)
    .join(' '));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

/** Replace all children in a single operation. */
export function replaceChildren(parent, nodes) {
  const fragment = document.createDocumentFragment();
  for (const node of nodes) {
    if (node) fragment.append(node);
  }
  parent.replaceChildren(fragment);
}

/* ------------------------------------------------------------------
   Timing
   ------------------------------------------------------------------ */

/**
 * Trailing-edge debounce with `flush` and `cancel`.
 * Used for autosave, persistence and search input.
 */
export function debounce(fn, delay) {
  let timer = null;
  let pendingArgs = null;

  const invoke = () => {
    const args = pendingArgs;
    timer = null;
    pendingArgs = null;
    if (args) fn(...args);
  };

  const debounced = (...args) => {
    pendingArgs = args;
    if (timer) clearTimeout(timer);
    timer = setTimeout(invoke, delay);
  };

  debounced.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    pendingArgs = null;
  };

  debounced.flush = () => {
    if (timer) {
      clearTimeout(timer);
      invoke();
    }
  };

  debounced.pending = () => timer !== null;

  return debounced;
}

/* ------------------------------------------------------------------
   Identity
   ------------------------------------------------------------------ */

/** Prefixed, sortable-ish, collision-resistant id. */
export function uid(prefix = 'id') {
  const random =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

/* ------------------------------------------------------------------
   Text
   ------------------------------------------------------------------ */

/** Collapse whitespace and trim. */
export function normalizeSpace(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function truncate(value, max) {
  const text = String(value ?? '');
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** Tag/search normalisation: lowercase, accent-insensitive where supported. */
export function foldCase(value) {
  const text = String(value ?? '').toLowerCase();
  try {
    return text.normalize('NFD').replace(/[̀-ͯ]/g, '');
  } catch {
    return text;
  }
}

/** Case-insensitive, locale-aware comparison for sorting names. */
export function compareText(a, b, locale = 'en') {
  return String(a ?? '').localeCompare(String(b ?? ''), locale, {
    sensitivity: 'base',
    numeric: true,
  });
}

/* ------------------------------------------------------------------
   Dates
   ------------------------------------------------------------------ */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Human-friendly timestamp.
 * @param {number} timestamp epoch ms
 * @param {{ format?: 'relative'|'iso'|'long', locale?: string, now?: number }} [options]
 */
export function formatDate(timestamp, options = {}) {
  const { format = 'relative', locale = 'en', now = Date.now() } = options;
  if (!Number.isFinite(timestamp)) return '';

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';

  if (format === 'iso') {
    return toISODate(date);
  }

  if (format === 'long') {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }

  const diff = now - timestamp;

  if (diff < MINUTE) return relativeUnit(locale, 0, 'minute', 'now');
  if (diff < HOUR) return relativeUnit(locale, -Math.floor(diff / MINUTE), 'minute');
  if (diff < DAY && isSameDay(date, new Date(now))) {
    return new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(date);
  }
  if (diff < 7 * DAY) return relativeUnit(locale, -Math.round(diff / DAY), 'day');

  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    year: sameYear ? undefined : 'numeric',
  }).format(date);
}

function relativeUnit(locale, value, unit, fallbackNow) {
  try {
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: fallbackNow ? 'auto' : 'always' });
    return rtf.format(value, unit);
  } catch {
    return fallbackNow ?? `${Math.abs(value)}${unit[0]}`;
  }
}

function isSameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Local-time YYYY-MM-DD, used for export filenames. */
export function toISODate(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Machine-readable timestamp for <time datetime>. */
export function toDateTimeAttr(timestamp) {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

/* ------------------------------------------------------------------
   Collections
   ------------------------------------------------------------------ */

export function unique(values) {
  return [...new Set(values)];
}

/* ------------------------------------------------------------------
   Platform
   ------------------------------------------------------------------ */

export const isApplePlatform = (() => {
  const platform = navigator.userAgentData?.platform ?? navigator.platform ?? '';
  return /mac|iphone|ipad|ipod/i.test(platform);
})();

/** `⌘` on Apple hardware, `Ctrl` elsewhere. */
export const modKeyLabel = isApplePlatform ? '⌘' : 'Ctrl';

/** True when the platform's primary modifier is held. */
export function hasModKey(event) {
  return isApplePlatform ? event.metaKey : event.ctrlKey;
}

/** True when focus is somewhere the user is typing. */
export function isTypingContext(target) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}
