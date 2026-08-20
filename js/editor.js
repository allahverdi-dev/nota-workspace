/**
 * The writing surface.
 *
 * The body is a `contenteditable` region constrained to a small block and
 * inline vocabulary (see sanitize.js). This module owns the note-shaped parts
 * — loading a note in, autosaving it, and the surrounding chrome; the
 * selection and DOM surgery behind the toolbar lives in editor-format.js.
 *
 * Autosave is debounced. A pending save is always flushed before the editor
 * switches notes, so typing and immediately clicking another note cannot
 * lose the last keystrokes.
 */

import { TIMING } from './config.js';
import { getLocale, t } from './i18n.js';
import { sanitizeHtml, setSanitizedHtml, countWords } from './sanitize.js';
import { store } from './store.js';
import { debounce, el, formatDate, hasModKey, icon, qs, qsa, toDateTimeAttr } from './utils.js';
import {
  addTagToNote,
  getNote,
  removeTagFromNote,
  toggleArchived,
  toggleFavorite,
  togglePinned,
  updateNote,
} from './notes.js';
import { getFolder } from './folders.js';
import { createFormatter, INLINE_SHORTCUTS } from './editor-format.js';

/** @type {Record<string, HTMLElement>} */
const dom = {};

let currentNoteId = null;
/** Last content written *into* the DOM, so external updates can be detected. */
let appliedContent = '';
let appliedTitle = '';
let readOnly = false;

/** Callbacks supplied by app.js so the editor stays free of routing logic. */
let hooks = { onOpenFolder: () => {}, onNoteAction: () => {} };

/** @type {ReturnType<typeof createFormatter> | null} */
let format = null;

/* ------------------------------------------------------------------
   Autosave
   ------------------------------------------------------------------ */

const commitDraft = () => {
  if (!currentNoteId || readOnly) return;

  const note = getNote(store.getState(), currentNoteId);
  if (!note) return;

  const title = dom.title.textContent.replace(/\s+/g, ' ').trim();
  const content = sanitizeHtml(dom.content.innerHTML);

  if (title === note.title && content === note.content) {
    store.setUI({ saveState: 'saved' });
    return;
  }

  appliedTitle = title;
  appliedContent = content;
  updateNote(currentNoteId, { title, content });
};

const scheduleSave = debounce(commitDraft, TIMING.autosaveDelay);

/** Write any pending edit immediately. */
export function flushEditor() {
  scheduleSave.flush();
}

function markDirty() {
  if (readOnly) return;
  store.setUI({ saveState: 'saving' });
  scheduleSave();
}

/* ------------------------------------------------------------------
   Setup
   ------------------------------------------------------------------ */

/**
 * @param {{ onOpenFolder: (id: string | null) => void,
 *   onNoteAction: (action: string, noteId: string) => void }} callbacks
 */
export function initEditor(callbacks) {
  hooks = { ...hooks, ...callbacks };

  dom.root = qs('#editor');
  dom.banner = qs('#editor-banner');
  dom.breadcrumbs = qs('#editor-breadcrumbs');
  dom.status = qs('#save-status');
  dom.statusText = qs('#save-status-text');
  dom.actions = qs('#editor-actions');
  dom.toolbar = qs('#editor-toolbar');
  dom.title = qs('#editor-title');
  dom.meta = qs('#editor-meta');
  dom.tags = qs('#editor-tags');
  dom.content = qs('#editor-content');

  format = createFormatter(dom.content, markDirty);

  // execCommand defaults differ per engine; pin them to what we sanitise for.
  try {
    document.execCommand('defaultParagraphSeparator', false, 'p');
    document.execCommand('styleWithCSS', false, 'false');
  } catch {
    /* unsupported: sanitisation still normalises the output */
  }

  bindTitle();
  bindContent();
  bindToolbar();
}

function bindTitle() {
  dom.title.addEventListener('input', markDirty);

  dom.title.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      focusContentStart();
    }
  });

  // Paste into the title is always plain text.
  dom.title.addEventListener('paste', (event) => {
    event.preventDefault();
    const text = event.clipboardData?.getData('text/plain') ?? '';
    document.execCommand('insertText', false, text.replace(/\s+/g, ' '));
  });
}

function bindContent() {
  dom.content.addEventListener('input', () => {
    markDirty();
    refreshToolbarState();
  });

  dom.content.addEventListener('paste', handlePaste);
  dom.content.addEventListener('keydown', handleContentKeydown);
  dom.content.addEventListener('change', handleCheckboxChange);
  dom.content.addEventListener('click', handleContentClick);

  document.addEventListener('selectionchange', () => {
    if (document.activeElement === dom.content) refreshToolbarState();
  });
}

function bindToolbar() {
  dom.toolbar.addEventListener('click', (event) => {
    const button = event.target.closest('[data-format]');
    if (!button) return;
    event.preventDefault();
    applyFormat(button.dataset.format);
  });

  // Keep the caret where it is when a toolbar button is pressed.
  dom.toolbar.addEventListener('mousedown', (event) => {
    if (event.target.closest('[data-format]')) event.preventDefault();
  });
}

/* ------------------------------------------------------------------
   Rendering
   ------------------------------------------------------------------ */

/**
 * Reflect the selected note. Called on every relevant state change; it only
 * rewrites the editable regions when their content genuinely differs, so the
 * caret survives unrelated updates such as toggling a favourite.
 */
export function renderEditor(state) {
  const note = getNote(state, state.ui.selectedNoteId);

  if (!note) {
    if (currentNoteId) flushEditor();
    currentNoteId = null;
    return;
  }

  const switching = note.id !== currentNoteId;
  if (switching) {
    flushEditor();
    currentNoteId = note.id;
  }

  readOnly = note.isDeleted;
  dom.root.classList.toggle('editor--readonly', readOnly);
  dom.title.contentEditable = String(!readOnly);
  dom.content.contentEditable = String(!readOnly);
  dom.content.spellcheck = state.preferences.spellcheck;
  dom.toolbar.hidden = readOnly;

  if (switching || note.title !== appliedTitle) {
    if (dom.title.textContent !== note.title) dom.title.textContent = note.title;
    appliedTitle = note.title;
  }

  if (switching || note.content !== appliedContent) {
    setSanitizedHtml(dom.content, note.content);
    format.ensureParagraph();
    appliedContent = note.content;
  }

  renderBanner(note);
  renderBreadcrumbs(state, note);
  renderActions(note);
  renderMeta(state, note);
  renderTags(state, note);
}

/** Live save indicator. */
export function renderSaveStatus(state) {
  const mapping = {
    saving: { text: t('editor.saving'), state: 'saving' },
    saved: { text: t('editor.saved'), state: 'saved' },
    error: { text: t('editor.saveFailed'), state: 'error' },
    idle: { text: t('editor.idle'), state: 'idle' },
  };
  const view = mapping[state.ui.saveState] ?? mapping.idle;

  dom.status.dataset.state = view.state;
  dom.statusText.textContent = view.text;
}

function renderBanner(note) {
  if (!note.isDeleted && !note.isArchived) {
    dom.banner.hidden = true;
    dom.banner.replaceChildren();
    return;
  }

  dom.banner.hidden = false;
  dom.banner.className = `editor__banner${note.isDeleted ? ' editor__banner--danger' : ''}`;
  dom.banner.replaceChildren(
    icon(note.isDeleted ? 'trash' : 'archive'),
    el('span', {
      class: 'editor__banner-text',
      text: note.isDeleted ? t('editor.trashedBanner') : t('editor.archivedBanner'),
    }),
    note.isDeleted
      ? el('button', {
          type: 'button',
          class: 'btn btn--outline',
          text: t('editor.restore'),
          onClick: () => hooks.onNoteAction('restore', note.id),
        })
      : el('button', {
          type: 'button',
          class: 'btn btn--outline',
          text: t('editor.unarchive'),
          onClick: () => toggleArchived(note.id),
        }),
  );
}

function renderBreadcrumbs(state, note) {
  const folder = getFolder(state, note.folderId);
  const folderName = folder?.name ?? t('nav.unfiled');

  dom.breadcrumbs.replaceChildren(
    el(
      'button',
      {
        type: 'button',
        class: 'breadcrumbs__item',
        onClick: () => hooks.onOpenFolder(note.folderId),
      },
      [icon('folder', { size: 'sm' }), el('span', { class: 'u-truncate', text: folderName })],
    ),
    el('span', { class: 'breadcrumbs__sep', 'aria-hidden': 'true', text: '/' }),
    el('span', {
      class: 'breadcrumbs__current',
      text: note.title || t('list.untitled'),
    }),
  );
}

function renderActions(note) {
  const buttons = [];

  if (!note.isDeleted) {
    buttons.push(
      actionButton({
        name: 'star',
        label: note.isFavorite ? t('editor.unfavorite') : t('editor.favorite'),
        pressed: note.isFavorite,
        filled: note.isFavorite,
        onSelect: () => toggleFavorite(note.id),
      }),
      actionButton({
        name: 'pin',
        label: note.isPinned ? t('editor.unpin') : t('editor.pin'),
        pressed: note.isPinned,
        filled: note.isPinned,
        onSelect: () => togglePinned(note.id),
      }),
      actionButton({
        name: note.isArchived ? 'archive-restore' : 'archive',
        label: note.isArchived ? t('editor.unarchive') : t('editor.archive'),
        onSelect: () => toggleArchived(note.id),
      }),
      actionButton({
        name: 'trash',
        label: t('editor.delete'),
        danger: true,
        onSelect: () => hooks.onNoteAction('trash', note.id),
      }),
    );
  } else {
    buttons.push(
      actionButton({
        name: 'restore',
        label: t('editor.restore'),
        onSelect: () => hooks.onNoteAction('restore', note.id),
      }),
      actionButton({
        name: 'trash',
        label: t('editor.deleteForever'),
        danger: true,
        onSelect: () => hooks.onNoteAction('destroy', note.id),
      }),
    );
  }

  buttons.push(
    el(
      'button',
      {
        type: 'button',
        class: 'icon-btn',
        id: 'editor-more',
        'aria-label': t('editor.moreActions'),
        'aria-haspopup': 'menu',
        'aria-expanded': 'false',
        onClick: (event) => hooks.onNoteAction('menu', note.id, event.currentTarget),
      },
      [icon('more')],
    ),
  );

  dom.actions.replaceChildren(...buttons);
}

function actionButton({ name, label, pressed, filled, danger, onSelect }) {
  return el(
    'button',
    {
      type: 'button',
      class: `icon-btn${danger ? ' icon-btn--danger' : ''}`,
      'aria-label': label,
      title: label,
      'aria-pressed': pressed === undefined ? null : String(pressed),
      onClick: onSelect,
    },
    [icon(name, { filled })],
  );
}

function renderMeta(state, note) {
  const options = { format: state.preferences.dateFormat, locale: getLocale() };
  const words = countWords(note.content);

  dom.meta.replaceChildren(
    el('span', { class: 'editor__meta-item' }, [
      icon('clock', { size: 'sm' }),
      el('time', {
        datetime: toDateTimeAttr(note.updatedAt),
        text: t('editor.updated', { date: formatDate(note.updatedAt, options) }),
      }),
    ]),
    el('span', { class: 'editor__meta-item' }, [
      icon('calendar', { size: 'sm' }),
      el('time', {
        datetime: toDateTimeAttr(note.createdAt),
        text: t('editor.created', { date: formatDate(note.createdAt, options) }),
      }),
    ]),
    el('span', {
      class: 'editor__meta-item',
      text: t('editor.words', { count: words }),
    }),
  );
}

function renderTags(state, note) {
  const chips = note.tags.map((tag) =>
    el('span', { class: 'tag' }, [
      el('span', { text: `#${tag}` }),
      readOnly
        ? null
        : el(
            'button',
            {
              type: 'button',
              class: 'tag__remove',
              'aria-label': t('editor.removeTag', { tag }),
              onClick: () => removeTagFromNote(note.id, tag),
            },
            [icon('close')],
          ),
    ]),
  );

  if (!readOnly) chips.push(buildTagAdder(note.id));
  dom.tags.replaceChildren(...chips);
}

function buildTagAdder(noteId) {
  const input = el('input', {
    class: 'tag-input',
    type: 'text',
    hidden: true,
    maxlength: '32',
    'aria-label': t('editor.addTag'),
    placeholder: t('editor.tagPlaceholder'),
    autocomplete: 'off',
    spellcheck: 'false',
  });

  const button = el(
    'button',
    {
      type: 'button',
      class: 'tag tag--interactive',
      onClick: () => {
        button.hidden = true;
        input.hidden = false;
        input.focus();
      },
    },
    [icon('plus', { size: 'sm' }), el('span', { text: t('editor.addTag') })],
  );

  const finish = (commit) => {
    if (commit) addTagToNote(noteId, input.value);
    input.value = '';
    input.hidden = true;
    button.hidden = false;
  };

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      finish(true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      finish(false);
    }
  });
  input.addEventListener('blur', () => finish(Boolean(input.value.trim())));

  return el('span', { class: 'u-row' }, [button, input]);
}

/* ------------------------------------------------------------------
   Focus helpers
   ------------------------------------------------------------------ */

export function focusTitle() {
  dom.title?.focus();
  format?.placeCaretAtEnd(dom.title);
}

function focusContentStart() {
  dom.content.focus();
  const first = dom.content.firstElementChild ?? dom.content;
  const range = document.createRange();
  range.selectNodeContents(first);
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

/* ------------------------------------------------------------------
   Input handling
   ------------------------------------------------------------------ */

function handlePaste(event) {
  if (readOnly) return;
  event.preventDefault();

  const clipboard = event.clipboardData;
  if (!clipboard) return;

  const html = clipboard.getData('text/html');
  if (html) {
    // Round-trip through the sanitiser before anything reaches the document.
    const clean = sanitizeHtml(html);
    if (clean) {
      document.execCommand('insertHTML', false, clean);
      markDirty();
      return;
    }
  }

  const text = clipboard.getData('text/plain');
  if (text) {
    document.execCommand('insertText', false, text);
    markDirty();
  }
}

function handleContentKeydown(event) {
  if (hasModKey(event)) {
    const shortcut = INLINE_SHORTCUTS[event.key.toLowerCase()];
    if (shortcut) {
      event.preventDefault();
      applyFormat(shortcut);
      return;
    }
  }

  if (event.key === 'Enter' && !event.shiftKey) {
    const item = format?.currentChecklistItem();
    if (item) {
      event.preventDefault();
      format.continueChecklist(item);
    }
  }

  if (event.key === 'Tab') {
    // Tab belongs to the page, not to the document: it is how a keyboard
    // user leaves the editor.
    return;
  }
}

function handleCheckboxChange(event) {
  const box = event.target;
  if (!(box instanceof HTMLInputElement) || box.type !== 'checkbox') return;
  if (format?.syncCheckbox(box)) markDirty();
}

function handleContentClick(event) {
  const link = event.target.closest('a[href]');
  if (!link) return;

  // In an editable region a plain click places the caret; Ctrl/Cmd opens.
  if (hasModKey(event)) {
    event.preventDefault();
    window.open(link.href, '_blank', 'noopener,noreferrer');
  }
}


/* ------------------------------------------------------------------
   Formatting

   The mechanics live in editor-format.js; this module only routes toolbar
   clicks and shortcuts into it and mirrors the result in the toolbar.
   ------------------------------------------------------------------ */

/** @param {string} command */
export function applyFormat(command) {
  if (readOnly || !format) return;
  if (format.apply(command)) refreshToolbarState();
}

/** Reflect the caret's context in the toolbar's pressed states. */
function refreshToolbarState() {
  if (!format || !dom.toolbar || dom.toolbar.hidden) return;

  const states = format.activeStates();
  for (const button of qsa('[data-format]', dom.toolbar)) {
    const state = states[button.dataset.format];
    if (state === undefined) continue;
    button.setAttribute('aria-pressed', String(Boolean(state)));
  }
}
