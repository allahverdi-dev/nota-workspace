/**
 * Local search over notes, folders and tags.
 *
 * Matching is done with case- and accent-folded substring scans rather than a
 * RegExp built from user input: a query like `c++ (` would either throw or
 * quietly become a different pattern. Highlighting builds real text and
 * <mark> nodes, so a match inside note content can never inject markup.
 */

import { LIMITS } from './config.js';
import { foldCase, normalizeSpace } from './utils.js';
import { isActive, noteText } from './notes.js';

/**
 * @typedef {object} Range
 * @property {number} start
 * @property {number} end
 */

/** Split a query into the terms that must all be present. */
function tokenize(query) {
  return normalizeSpace(query)
    .split(' ')
    .map(foldCase)
    .filter(Boolean)
    .slice(0, 8);
}

/**
 * All occurrences of `token` in `haystack` (already folded).
 * @returns {Range[]}
 */
function findRanges(haystack, token) {
  const ranges = [];
  let from = 0;

  while (ranges.length < 40) {
    const index = haystack.indexOf(token, from);
    if (index === -1) break;
    ranges.push({ start: index, end: index + token.length });
    from = index + token.length;
  }

  return ranges;
}

/** Merge overlapping ranges so nested <mark> elements never occur. */
function mergeRanges(ranges) {
  if (ranges.length < 2) return ranges;

  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged = [sorted[0]];

  for (const range of sorted.slice(1)) {
    const last = merged.at(-1);
    if (range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push(range);
  }

  return merged;
}

/**
 * Folding can change string length for some inputs, so ranges are only
 * reliable when the folded text lines up with the original. When it does
 * not, we skip highlighting rather than mark the wrong characters.
 */
function foldedPair(text) {
  const folded = foldCase(text);
  return { folded, aligned: folded.length === text.length };
}

/**
 * @param {object} state
 * @param {string} query
 * @param {{ limit?: number, scope?: 'active' | 'all' }} [options]
 */
export function searchWorkspace(state, query, { limit = 40, scope = 'active' } = {}) {
  const tokens = tokenize(query);
  const empty = { query, tokens, notes: [], folders: [], tags: [], total: 0 };
  if (tokens.length === 0) return empty;

  const notes = [];

  for (const note of state.notes) {
    if (scope === 'active' && !isActive(note)) continue;
    if (scope === 'all' && note.isDeleted) continue;

    const hit = matchNote(note, tokens);
    if (hit) notes.push(hit);
  }

  notes.sort((a, b) => b.score - a.score || b.note.updatedAt - a.note.updatedAt);

  const folders = state.folders
    .filter((folder) => tokens.every((token) => foldCase(folder.name).includes(token)))
    .slice(0, 6);

  const tagNames = new Set(state.notes.flatMap((note) => (isActive(note) ? note.tags : [])));
  const tags = [...tagNames]
    .filter((tag) => tokens.every((token) => tag.includes(token)))
    .sort()
    .slice(0, 8);

  return {
    query,
    tokens,
    notes: notes.slice(0, limit),
    folders,
    tags,
    total: notes.length + folders.length + tags.length,
  };
}

function matchNote(note, tokens) {
  const title = note.title;
  const body = noteText(note);
  const tagLine = note.tags.join(' ');

  const titleFold = foldedPair(title);
  const bodyFold = foldedPair(body);

  let score = 0;
  const titleRanges = [];
  const bodyRanges = [];

  for (const token of tokens) {
    const inTitle = findRanges(titleFold.folded, token);
    const inBody = findRanges(bodyFold.folded, token);
    const inTags = tagLine.includes(token);

    if (inTitle.length === 0 && inBody.length === 0 && !inTags) return null;

    // Title hits are the strongest signal, then tags, then body frequency.
    if (inTitle.length) score += 12 + (titleFold.folded.startsWith(token) ? 6 : 0);
    if (inTags) score += 5;
    score += Math.min(inBody.length, 4);

    titleRanges.push(...inTitle);
    bodyRanges.push(...inBody);
  }

  const context = buildContext(body, bodyFold, mergeRanges(bodyRanges));

  return {
    note,
    score,
    titleRanges: titleFold.aligned ? mergeRanges(titleRanges) : [],
    context,
  };
}

/**
 * A window of body text around the first match, so results show why they
 * matched instead of always starting at the top of the note.
 */
function buildContext(body, bodyFold, ranges) {
  if (!body) return { text: '', ranges: [] };

  const radius = LIMITS.searchContextRadius;
  const first = ranges[0];

  if (!first || !bodyFold.aligned) {
    return { text: body.slice(0, radius * 3), ranges: [] };
  }

  let start = Math.max(0, first.start - radius);
  // Snap to a word boundary so the excerpt does not start mid-word.
  if (start > 0) {
    const space = body.indexOf(' ', start);
    if (space !== -1 && space < first.start) start = space + 1;
  }

  const end = Math.min(body.length, first.end + radius * 2);
  const slice = body.slice(start, end);
  const prefix = start > 0 ? '… ' : '';
  const offset = start - prefix.length;

  const shifted = ranges
    .filter((range) => range.start >= start && range.end <= end)
    .map((range) => ({ start: range.start - offset, end: range.end - offset }));

  return {
    text: `${prefix}${slice}${end < body.length ? ' …' : ''}`,
    ranges: shifted,
  };
}

/**
 * Render `text` into `container` with `ranges` wrapped in <mark>.
 * Everything is created as text nodes — no markup is ever parsed here.
 *
 * @param {HTMLElement} container
 * @param {string} text
 * @param {Range[]} ranges
 */
export function highlightInto(container, text, ranges) {
  container.textContent = '';

  if (!ranges || ranges.length === 0) {
    container.textContent = text;
    return container;
  }

  const fragment = document.createDocumentFragment();
  let cursor = 0;

  for (const { start, end } of ranges) {
    if (start < cursor || start > text.length) continue;
    if (start > cursor) fragment.append(document.createTextNode(text.slice(cursor, start)));

    const mark = document.createElement('mark');
    mark.textContent = text.slice(start, end);
    fragment.append(mark);
    cursor = end;
  }

  if (cursor < text.length) fragment.append(document.createTextNode(text.slice(cursor)));

  container.append(fragment);
  return container;
}

/**
 * Quick note lookup for the command palette, which searches titles first
 * and falls back to body text.
 */
export function quickFindNotes(state, query, limit = 6) {
  const tokens = tokenize(query);
  if (!tokens.length) {
    return state.notes
      .filter(isActive)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit);
  }

  return searchWorkspace(state, query, { limit }).notes.map((hit) => hit.note);
}

