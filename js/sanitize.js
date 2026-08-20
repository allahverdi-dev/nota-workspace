/**
 * The single place in the app where untrusted HTML is turned into DOM.
 *
 * Note bodies are rich text, so they cannot be stored as plain strings — but
 * they arrive from three untrusted sources: what the user pastes into the
 * editor, what `contenteditable` itself produces, and what an imported backup
 * file claims. Everything from those sources passes through `sanitizeHtml`,
 * which rebuilds a fresh tree containing only allow-listed elements and
 * attributes. Nothing else in the codebase assigns to `innerHTML`.
 */

/** Elements kept as-is. */
const ALLOWED_TAGS = new Set([
  'P', 'BR', 'HR',
  'H2', 'H3',
  'UL', 'OL', 'LI',
  'BLOCKQUOTE',
  'STRONG', 'EM', 'U', 'S', 'CODE',
  'A',
  'INPUT',
]);

/** Elements rewritten to their canonical equivalent. */
const TAG_ALIASES = new Map([
  ['B', 'STRONG'],
  ['I', 'EM'],
  ['STRIKE', 'S'],
  ['DEL', 'S'],
  ['H1', 'H2'],
  ['H4', 'H3'],
  ['H5', 'H3'],
  ['H6', 'H3'],
  ['PRE', 'P'],
]);

/**
 * Elements dropped while keeping their children — the wrappers
 * `contenteditable` and pasted documents love to produce.
 */
const UNWRAP_TAGS = new Set([
  'DIV', 'SPAN', 'FONT', 'SECTION', 'ARTICLE', 'MAIN', 'BODY', 'HTML',
  'HEADER', 'FOOTER', 'NAV', 'ASIDE', 'FIGURE', 'FIGCAPTION', 'CENTER',
  'SMALL', 'ABBR', 'CITE', 'Q', 'SUB', 'SUP', 'LABEL', 'TIME', 'MARK',
]);

/** Elements dropped along with everything inside them. */
const DROP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'TITLE',
  'NOSCRIPT', 'TEMPLATE', 'SVG', 'MATH', 'FORM', 'BUTTON', 'SELECT',
  'TEXTAREA', 'AUDIO', 'VIDEO', 'CANVAS', 'IMG', 'BASE', 'PORTAL',
]);

const ALLOWED_ATTRS = {
  A: new Set(['href']),
  UL: new Set(['data-checklist']),
  LI: new Set(['data-checked']),
  INPUT: new Set(['type', 'checked']),
};

const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

/**
 * Resolve a user-supplied link, rejecting anything that is not a plain
 * navigable URL. `javascript:`, `data:` and `blob:` are refused outright.
 *
 * @returns {string | null} the normalised href, or null if unsafe
 */
export function safeUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;

  // Control characters are the classic way to smuggle a scheme past a naive
  // protocol check, so strip everything at or below U+0020 before parsing.
  const cleaned = [...raw].filter((ch) => ch.codePointAt(0) > 0x20).join('');
  if (!cleaned) return null;

  let url;
  try {
    url = new URL(cleaned, document.baseURI);
  } catch {
    return null;
  }

  if (!SAFE_PROTOCOLS.has(url.protocol)) return null;
  return url.href;
}

/**
 * Add a protocol to bare input like `example.com` so the link works,
 * then validate it. Used by the editor's link prompt.
 */
export function normalizeLinkInput(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('//')
    ? raw
    : `https://${raw}`;
  return safeUrl(candidate);
}

/**
 * Rebuild `html` as a DocumentFragment containing only allow-listed nodes.
 * Parsing happens in an inert document, so nothing loads or executes.
 *
 * @param {string} html
 * @returns {DocumentFragment}
 */
export function sanitizeToFragment(html) {
  const fragment = document.createDocumentFragment();
  const source = String(html ?? '');
  if (!source.trim()) return fragment;

  let parsed;
  try {
    parsed = new DOMParser().parseFromString(source, 'text/html');
  } catch {
    fragment.append(document.createTextNode(source));
    return fragment;
  }

  for (const child of [...parsed.body.childNodes]) {
    appendClean(fragment, child, 0);
  }
  return fragment;
}

/**
 * Sanitised HTML string, suitable for persisting.
 * @param {string} html
 * @returns {string}
 */
export function sanitizeHtml(html) {
  const holder = document.createElement('div');
  holder.append(sanitizeToFragment(html));
  return holder.innerHTML;
}

/** Replace an element's contents with sanitised markup. */
export function setSanitizedHtml(target, html) {
  target.replaceChildren(sanitizeToFragment(html));
}

/**
 * Recursion guard. Word and Google Docs happily paste markup nested dozens of
 * wrappers deep, so the limit is generous — and past it we flatten to text
 * rather than dropping content the user can see in their clipboard.
 */
const MAX_DEPTH = 60;

function appendClean(parent, node, depth) {
  if (depth > MAX_DEPTH) {
    const text = node.textContent;
    if (text) parent.append(document.createTextNode(text));
    return;
  }

  if (node.nodeType === Node.TEXT_NODE) {
    if (node.nodeValue) parent.append(document.createTextNode(node.nodeValue));
    return;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return; // comments, PIs, doctype

  const tag = node.tagName.toUpperCase();
  if (DROP_TAGS.has(tag)) return;

  if (UNWRAP_TAGS.has(tag)) {
    for (const child of node.childNodes) appendClean(parent, child, depth + 1);
    return;
  }

  const finalTag = TAG_ALIASES.get(tag) ?? tag;
  if (!ALLOWED_TAGS.has(finalTag)) {
    for (const child of node.childNodes) appendClean(parent, child, depth + 1);
    return;
  }

  if (finalTag === 'INPUT') {
    const checkbox = buildCheckbox(node);
    if (checkbox) parent.append(checkbox);
    return;
  }

  const clean = document.createElement(finalTag);
  copyAllowedAttributes(node, clean, finalTag);

  for (const child of node.childNodes) appendClean(clean, child, depth + 1);

  // Drop containers that ended up with nothing inside. A blank line the user
  // actually typed is `<p><br></p>`, so it has a child and survives; a truly
  // empty `<p>` is an artefact of re-parsing invalid nesting.
  if (!clean.hasChildNodes() && !VOID_TAGS.has(finalTag)) return;

  parent.append(clean);
}

const VOID_TAGS = new Set(['BR', 'HR', 'INPUT']);

function copyAllowedAttributes(source, target, tag) {
  const allowed = ALLOWED_ATTRS[tag];
  if (!allowed) return;

  for (const name of allowed) {
    if (!source.hasAttribute(name)) continue;
    const value = source.getAttribute(name);

    if (tag === 'A' && name === 'href') {
      const href = safeUrl(value);
      if (!href) continue;
      target.setAttribute('href', href);
      // Untrusted destinations never get a handle on our window.
      target.setAttribute('rel', 'noopener noreferrer nofollow');
      target.setAttribute('target', '_blank');
      continue;
    }

    if (tag === 'LI' && name === 'data-checked') {
      target.setAttribute('data-checked', value === 'true' ? 'true' : 'false');
      continue;
    }

    if (tag === 'UL' && name === 'data-checklist') {
      target.setAttribute('data-checklist', 'true');
      continue;
    }

    target.setAttribute(name, value);
  }
}

/** Checkboxes survive only in their checklist form. */
function buildCheckbox(source) {
  if ((source.getAttribute('type') ?? '').toLowerCase() !== 'checkbox') return null;
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.contentEditable = 'false';
  if (source.hasAttribute('checked') || source.checked) {
    input.setAttribute('checked', 'checked');
    input.checked = true;
  }
  return input;
}

/**
 * Plain-text projection of note HTML, used for excerpts, search and word
 * counts. Block boundaries become spaces so words do not run together.
 *
 * @param {string} html
 * @returns {string}
 */
export function htmlToText(html) {
  const holder = document.createElement('div');
  holder.append(sanitizeToFragment(html));

  for (const block of holder.querySelectorAll('p, li, h2, h3, blockquote, br, hr')) {
    block.after(document.createTextNode(' '));
  }
  for (const box of holder.querySelectorAll('input')) {
    box.remove();
  }

  return (holder.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** @returns {number} words in the given note HTML */
export function countWords(html) {
  const text = htmlToText(html);
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}
