/**
 * Command palette.
 *
 * A single entry point to every action and view, plus a jump-to-note list.
 * Implemented as a combobox with an owned listbox so screen readers announce
 * the highlighted option as the user arrows through it.
 */

import { APP } from './config.js';
import { t } from './i18n.js';
import { store } from './store.js';
import { el, foldCase, icon } from './utils.js';
import { quickFindNotes } from './search.js';
import { noteExcerpt } from './notes.js';
import { openOverlay } from './ui.js';

/**
 * @typedef {object} Command
 * @property {string} id
 * @property {string} group
 * @property {string} title
 * @property {string} [subtitle]
 * @property {string} [icon]
 * @property {string[]} [keys]
 * @property {() => void} run
 */

/** @type {() => Command[]} */
let getCommands = () => [];
let isOpen = false;

/** @param {() => Command[]} factory */
export function initCommands(factory) {
  getCommands = factory;
}

export async function openPalette() {
  if (isOpen) return;
  isOpen = true;
  store.setUI({ commandPaletteOpen: true });

  try {
    await openOverlay(buildPalette, { initialFocus: (root) => root.querySelector('input') });
  } finally {
    isOpen = false;
    store.setUI({ commandPaletteOpen: false });
  }
}

function buildPalette(close) {
  let options = [];
  let activeIndex = 0;

  const input = el('input', {
    class: 'palette__input',
    type: 'text',
    role: 'combobox',
    id: 'palette-input',
    placeholder: t('palette.placeholder'),
    'aria-expanded': 'true',
    'aria-controls': 'palette-listbox',
    'aria-autocomplete': 'list',
    'aria-label': t('palette.placeholder'),
    autocomplete: 'off',
    spellcheck: 'false',
  });

  const results = el('div', {
    class: 'palette__results',
    id: 'palette-listbox',
    role: 'listbox',
    'aria-label': t('palette.placeholder'),
  });

  function run(index) {
    const option = options[index];
    if (!option) return;
    close(undefined);
    // Let the overlay unmount and restore focus before the action runs.
    queueMicrotask(() => option.run());
  }

  function setActive(index) {
    if (options.length === 0) return;
    activeIndex = (index + options.length) % options.length;

    for (const [i, option] of options.entries()) {
      option.element.setAttribute('aria-selected', String(i === activeIndex));
    }

    const active = options[activeIndex];
    input.setAttribute('aria-activedescendant', active.element.id);
    active.element.scrollIntoView({ block: 'nearest' });
  }

  function render() {
    const query = input.value.trim();
    const groups = collectGroups(query);

    options = [];
    results.replaceChildren();

    if (groups.length === 0) {
      results.append(el('p', { class: 'palette__empty', text: t('palette.empty') }));
      input.removeAttribute('aria-activedescendant');
      return;
    }

    const fragment = document.createDocumentFragment();

    for (const group of groups) {
      fragment.append(el('div', { class: 'palette__group-title', role: 'presentation', text: group.title }));

      for (const command of group.items) {
        const id = `palette-option-${options.length}`;
        const element = el(
          'div',
          {
            class: 'palette__option',
            id,
            role: 'option',
            'aria-selected': 'false',
            onClick: () => run(options.findIndex((entry) => entry.element === element)),
            onMousemove: () => setActive(options.findIndex((entry) => entry.element === element)),
          },
          [
            command.icon ? icon(command.icon) : null,
            el('span', { class: 'palette__option-text' }, [
              el('span', { class: 'palette__option-title', text: command.title }),
              command.subtitle
                ? el('span', { class: 'palette__option-sub', text: command.subtitle })
                : null,
            ]),
            command.keys?.length
              ? el(
                  'span',
                  { class: 'palette__keys' },
                  command.keys.map((key) => el('kbd', { text: key })),
                )
              : null,
          ],
        );

        options.push({ element, run: command.run });
        fragment.append(element);
      }
    }

    results.append(fragment);
    setActive(0);
  }

  input.addEventListener('input', render);

  input.addEventListener('keydown', (event) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActive(activeIndex + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActive(activeIndex - 1);
        break;
      case 'Home':
        event.preventDefault();
        setActive(0);
        break;
      case 'End':
        event.preventDefault();
        setActive(options.length - 1);
        break;
      case 'Enter':
        event.preventDefault();
        run(activeIndex);
        break;
      default:
        break;
    }
  });

  const panel = el('div', { class: 'palette__panel' }, [
    el('div', { class: 'palette__head' }, [icon('search', { size: 'lg' }), input, el('kbd', { text: 'Esc' })]),
    results,
    el('div', { class: 'palette__foot' }, [
      el('span', { class: 'palette__hint' }, [
        el('kbd', { text: '↑' }),
        el('kbd', { text: '↓' }),
        el('span', { text: t('palette.navigate') }),
      ]),
      el('span', { class: 'palette__hint' }, [
        el('kbd', { text: '↵' }),
        el('span', { text: t('palette.select') }),
      ]),
      el('span', { class: 'palette__version', text: `v${APP.version}` }),
    ]),
  ]);

  const root = el('div', { class: 'palette' }, [
    el('div', { class: 'palette__backdrop', onClick: () => close(undefined) }),
    panel,
  ]);

  render();
  return root;
}

/**
 * Filter the registry and append matching notes.
 * @returns {{ title: string, items: Command[] }[]}
 */
function collectGroups(query) {
  const needle = foldCase(query);
  const commands = getCommands().filter(
    (command) => !needle || foldCase(`${command.title} ${command.subtitle ?? ''}`).includes(needle),
  );

  const groups = [];
  for (const command of commands) {
    let group = groups.find((entry) => entry.key === command.group);
    if (!group) {
      group = { key: command.group, title: t(`palette.group${command.group}`), items: [] };
      groups.push(group);
    }
    group.items.push(command);
  }

  const notes = query ? quickFindNotes(store.getState(), query, 5) : [];
  if (notes.length) {
    groups.push({
      key: 'Notes',
      title: t('palette.groupNotes'),
      items: notes.map((note) => ({
        id: `note:${note.id}`,
        group: 'Notes',
        icon: 'note',
        title: note.title || t('list.untitled'),
        subtitle: noteExcerpt(note, 70),
        run: () => noteOpener?.(note.id),
      })),
    });
  }

  return groups;
}

/** Set by app.js so the palette can open a note without importing routing. */
let noteOpener = null;

/** @param {(id: string) => void} handler */
export function setNoteOpener(handler) {
  noteOpener = handler;
}
