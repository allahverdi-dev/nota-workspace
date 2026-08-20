/**
 * The formatting engine for the note body.
 *
 * `document.execCommand` is deprecated but remains the only rich-text
 * implementation every engine agrees on, and it is far more stable than a
 * hand-rolled Range/Selection model. Its output is inconsistent between
 * browsers, so everything it produces is normalised here and again by the
 * sanitiser on save — the stored format never depends on browser quirks.
 *
 * This module owns selection and DOM surgery inside one editable element.
 * It knows nothing about notes, state or persistence: the host passes in the
 * element and a callback to fire when the document changed.
 */

import { t } from './i18n.js';
import { normalizeLinkInput } from './sanitize.js';
import { qsa } from './utils.js';
import { promptDialog } from './ui.js';

/** Keyboard shortcuts handled inside the editable region. */
export const INLINE_SHORTCUTS = {
  b: 'bold',
  i: 'italic',
  k: 'link',
  e: 'code',
};

/**
 * @param {HTMLElement} root the contenteditable element
 * @param {() => void} onChange called after any command modifies the document
 */
export function createFormatter(root, onChange) {
  /* ---------------- selection helpers ---------------- */

  function selectionElement() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;

    let node = selection.getRangeAt(0).startContainer;
    if (node.nodeType === Node.TEXT_NODE) node = node.parentNode;
    return node instanceof HTMLElement && root.contains(node) ? node : null;
  }

  function applyRange(range) {
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  function placeCaretAtEnd(node) {
    if (!node) return;
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(false);
    applyRange(range);
  }

  function closestBlockTag() {
    return selectionElement()?.closest('h2, h3, blockquote, p, li')?.tagName ?? null;
  }

  /** contenteditable misbehaves when it is completely empty. */
  function ensureParagraph() {
    if (root.childNodes.length === 0) root.append(document.createElement('p'));
  }

  /* ---------------- blocks ---------------- */

  function toggleBlock(tag, { force = false } = {}) {
    const active = closestBlockTag();
    const target = !force && active === tag ? 'P' : tag;
    document.execCommand('formatBlock', false, target);
  }

  /* ---------------- checklists ---------------- */

  function decorateChecklistItem(item, checked = false) {
    if (item.querySelector('input[type="checkbox"]')) return;

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.contentEditable = 'false';
    box.checked = checked;
    if (checked) box.setAttribute('checked', 'checked');

    item.dataset.checked = String(checked);
    item.prepend(box);
  }

  function stripChecklist(list) {
    for (const item of qsa('li', list)) {
      item.querySelector('input[type="checkbox"]')?.remove();
      delete item.dataset.checked;
    }
    delete list.dataset.checklist;
  }

  /** Convert the current list into a checklist, or back to a plain list. */
  function toggleChecklist() {
    const list = selectionElement()?.closest('ul');

    if (list?.dataset.checklist) {
      stripChecklist(list);
      document.execCommand('insertUnorderedList');
      return;
    }

    if (!list) document.execCommand('insertUnorderedList');

    const target = selectionElement()?.closest('ul');
    if (!target) return;

    target.dataset.checklist = 'true';
    for (const item of qsa('li', target)) decorateChecklistItem(item);
  }

  function unmarkChecklist() {
    const list = selectionElement()?.closest('ul[data-checklist]');
    if (list) stripChecklist(list);
  }

  /** The checklist row containing the caret, if there is one. */
  function currentChecklistItem() {
    return selectionElement()?.closest('ul[data-checklist] > li') ?? null;
  }

  /**
   * Enter inside a checklist creates a fresh unchecked row rather than letting
   * the browser clone the current checkbox along with its checked state.
   * A second Enter on an empty row leaves the list.
   */
  function continueChecklist(item) {
    if (!item.textContent.trim()) {
      const list = item.parentElement;
      const paragraph = document.createElement('p');
      paragraph.append(document.createElement('br'));
      list.after(paragraph);
      item.remove();
      if (!list.children.length) list.remove();
      placeCaretAtEnd(paragraph);
      onChange();
      return;
    }

    const next = document.createElement('li');
    decorateChecklistItem(next);
    item.after(next);

    const range = document.createRange();
    range.setStart(next, next.childNodes.length);
    range.collapse(true);
    applyRange(range);
    onChange();
  }

  /** Reflect a checkbox click back into the markup that gets saved. */
  function syncCheckbox(box) {
    const item = box.closest('li');
    if (!item) return false;

    item.dataset.checked = String(box.checked);
    if (box.checked) box.setAttribute('checked', 'checked');
    else box.removeAttribute('checked');
    return true;
  }

  /* ---------------- inline ---------------- */

  function toggleInlineCode() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const existing = selectionElement()?.closest('code');
    if (existing) {
      const parent = existing.parentNode;
      while (existing.firstChild) parent.insertBefore(existing.firstChild, existing);
      existing.remove();
      return;
    }

    const range = selection.getRangeAt(0);
    if (range.collapsed) return;

    const code = document.createElement('code');
    try {
      range.surroundContents(code);
    } catch {
      // The selection crossed element boundaries; extract it instead.
      code.append(range.extractContents());
      range.insertNode(code);
    }

    const after = document.createRange();
    after.selectNodeContents(code);
    applyRange(after);
  }

  async function promptForLink() {
    const existing = selectionElement()?.closest('a[href]');

    const value = await promptDialog({
      title: t('link.title'),
      label: t('link.label'),
      placeholder: t('link.placeholder'),
      value: existing?.getAttribute('href') ?? '',
      confirmLabel: t('link.add'),
      maxLength: 2000,
      validate: (input) => (normalizeLinkInput(input) ? null : t('link.invalid')),
    });

    root.focus();
    if (value === null) return;

    const href = normalizeLinkInput(value);
    if (!href) return;

    if (existing) existing.setAttribute('href', href);
    else document.execCommand('createLink', false, href);

    normalize();
    onChange();
  }

  /* ---------------- normalisation ---------------- */

  /**
   * Repair whatever execCommand produced: checklist rows keep their boxes in
   * the leading position the layout expects, and links carry safe attributes.
   */
  function normalize() {
    for (const list of qsa('ul[data-checklist]', root)) {
      for (const item of qsa('li', list)) {
        const box = item.querySelector('input[type="checkbox"]');
        if (!box) {
          decorateChecklistItem(item);
        } else {
          if (item.firstChild !== box) item.prepend(box);
          item.dataset.checked = String(box.checked);
        }
      }
    }

    for (const link of qsa('a[href]', root)) {
      link.setAttribute('rel', 'noopener noreferrer nofollow');
      link.setAttribute('target', '_blank');
    }

    ensureParagraph();
  }

  /* ---------------- command dispatch ---------------- */

  /**
   * @param {string} command one of the `data-format` values in the toolbar
   * @returns {boolean} whether the caller should refresh toolbar state now
   *   (link resolves asynchronously and refreshes itself)
   */
  function apply(command) {
    root.focus();

    switch (command) {
      case 'bold':
      case 'italic':
        document.execCommand(command);
        break;
      case 'heading':
        toggleBlock('H2');
        break;
      case 'subheading':
        toggleBlock('H3');
        break;
      case 'quote':
        toggleBlock('BLOCKQUOTE');
        break;
      case 'bulletList':
        document.execCommand('insertUnorderedList');
        unmarkChecklist();
        break;
      case 'numberedList':
        document.execCommand('insertOrderedList');
        break;
      case 'checklist':
        toggleChecklist();
        break;
      case 'code':
        toggleInlineCode();
        break;
      case 'link':
        void promptForLink();
        return false;
      case 'clear':
        document.execCommand('removeFormat');
        toggleBlock('P', { force: true });
        break;
      default:
        return false;
    }

    normalize();
    onChange();
    return true;
  }

  /* ---------------- toolbar state ---------------- */

  function queryCommand(name) {
    try {
      return document.queryCommandState(name);
    } catch {
      return false;
    }
  }

  /** @returns {Record<string, boolean>} pressed state per toolbar command */
  function activeStates() {
    const block = closestBlockTag();
    const element = selectionElement();
    const inChecklist = Boolean(element?.closest('ul[data-checklist]'));
    const list = element?.closest('ul, ol');

    return {
      bold: queryCommand('bold'),
      italic: queryCommand('italic'),
      heading: block === 'H2',
      subheading: block === 'H3',
      quote: Boolean(element?.closest('blockquote')),
      bulletList: list?.tagName === 'UL' && !inChecklist,
      numberedList: list?.tagName === 'OL',
      checklist: inChecklist,
      code: Boolean(element?.closest('code')),
      link: Boolean(element?.closest('a[href]')),
    };
  }

  return {
    apply,
    activeStates,
    normalize,
    ensureParagraph,
    placeCaretAtEnd,
    currentChecklistItem,
    continueChecklist,
    syncCheckbox,
  };
}
