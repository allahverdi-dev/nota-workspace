/**
 * The middle column: whichever set of notes the active view describes,
 * plus the header controls that scope and sort it.
 */

import { SORT_OPTIONS, VIEWS } from '../config.js';
import { getLocale, t } from '../i18n.js';
import { store } from '../store.js';
import { el, formatDate, icon, qs, replaceChildren, toDateTimeAttr, truncate } from '../utils.js';
import { filterNotesForView, noteExcerpt, sortNotes } from '../notes.js';
import { getFolder } from '../folders.js';
import { highlightInto, searchWorkspace } from '../search.js';
import { openMenu } from '../ui.js';
import { DRAG_MIME } from './sidebar.js';

const dom = {};
let hooks = {};

/**
 * @param {{ onSelectNote: (id: string) => void, onNewNote: () => void,
 *   onNavigate: (route: object) => void, onSearchInput: (value: string) => void,
 *   onEmptyTrash: () => void, onOpenSidebar: () => void }} callbacks
 */
export function initNoteList(callbacks) {
  hooks = callbacks;

  dom.head = qs('#list-head');
  dom.searchBar = qs('#list-search');
  dom.searchInput = qs('#list-search-input');
  dom.searchClear = qs('#list-search-clear');
  dom.scroll = qs('#list-scroll');
  dom.meta = qs('#list-meta');
  dom.results = qs('#note-list');
  dom.empty = qs('#list-empty');

  // One listener for every row, whatever the current view renders.
  dom.results.addEventListener('click', (event) => {
    const card = event.target.closest('[data-note-id]');
    if (card) hooks.onSelectNote(card.dataset.noteId);
  });

  dom.results.addEventListener('keydown', handleListKeydown);
  dom.results.addEventListener('dragstart', handleDragStart);
  dom.results.addEventListener('dragend', (event) => {
    event.target.closest('.note-card')?.classList.remove('note-card--dragging');
  });

  dom.searchInput.addEventListener('input', (event) => hooks.onSearchInput(event.target.value));
  dom.searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && dom.searchInput.value) {
      event.stopPropagation();
      clearSearch();
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      dom.results.querySelector('.note-card')?.focus();
    }
  });
  dom.searchClear.addEventListener('click', clearSearch);
}

function clearSearch() {
  dom.searchInput.value = '';
  hooks.onSearchInput('');
  dom.searchInput.focus();
}

export function focusSearchInput() {
  dom.searchInput.focus();
  dom.searchInput.select();
}

/* ------------------------------------------------------------------
   Render
   ------------------------------------------------------------------ */

export function renderNoteList(state) {
  const { activeView } = state.ui;
  const isSearch = activeView === VIEWS.search;

  renderHeader(state);

  dom.searchBar.hidden = !isSearch;
  if (isSearch && dom.searchInput.value !== state.ui.searchQuery) {
    dom.searchInput.value = state.ui.searchQuery;
  }

  if (isSearch) renderSearchResults(state);
  else renderViewNotes(state);
}

function renderHeader(state) {
  const { activeView } = state.ui;
  const isTrash = activeView === VIEWS.trash;

  const controls = [
    el(
      'button',
      {
        type: 'button',
        class: 'icon-btn nav-toggle',
        'aria-label': t('nav.openSidebar'),
        onClick: () => hooks.onOpenSidebar(),
      },
      [icon('menu')],
    ),
    el('h1', { class: 'list-pane__title', text: viewTitle(state) }),
  ];

  if (!isTrash) {
    controls.push(
      el(
        'button',
        {
          type: 'button',
          class: 'icon-btn',
          'aria-label': t('list.view'),
          title: t('list.view'),
          'aria-haspopup': 'menu',
          'aria-expanded': 'false',
          onClick: (event) => openViewMenu(event.currentTarget, state),
        },
        [icon(state.preferences.noteView === 'grid' ? 'grid' : 'rows')],
      ),
      el(
        'button',
        {
          type: 'button',
          class: 'icon-btn',
          'aria-label': t('list.sort'),
          title: t('list.sort'),
          'aria-haspopup': 'menu',
          'aria-expanded': 'false',
          onClick: (event) => openSortMenu(event.currentTarget, state),
        },
        [icon('sort')],
      ),
      el(
        'button',
        {
          type: 'button',
          class: 'icon-btn',
          'aria-label': t('nav.newNote'),
          title: t('nav.newNote'),
          onClick: () => hooks.onNewNote(),
        },
        [icon('plus')],
      ),
    );
  } else {
    controls.push(
      el('button', {
        type: 'button',
        class: 'btn btn--danger',
        text: t('note.emptyTrash.action'),
        disabled: !state.notes.some((note) => note.isDeleted),
        onClick: () => hooks.onEmptyTrash(),
      }),
    );
  }

  dom.head.replaceChildren(...controls);
}

function viewTitle(state) {
  switch (state.ui.activeView) {
    case VIEWS.favorites:
      return t('nav.favorites');
    case VIEWS.pinned:
      return t('nav.pinned');
    case VIEWS.archive:
      return t('nav.archive');
    case VIEWS.trash:
      return t('nav.trash');
    case VIEWS.search:
      return t('nav.search');
    case VIEWS.tag:
      return `#${state.ui.selectedTag ?? ''}`;
    case VIEWS.folder:
      return getFolder(state, state.ui.selectedFolderId)?.name ?? t('nav.unfiled');
    default:
      return t('nav.allNotes');
  }
}

function openSortMenu(anchor, state) {
  void openMenu(
    anchor,
    SORT_OPTIONS.map((option) => ({
      label: t(`sort.${option}`),
      checked: state.preferences.sort === option,
      onSelect: () => store.setPreferences({ sort: option }),
    })),
  );
}

function openViewMenu(anchor, state) {
  void openMenu(anchor, [
    {
      label: t('list.viewList'),
      icon: 'rows',
      checked: state.preferences.noteView === 'list',
      onSelect: () => store.setPreferences({ noteView: 'list' }),
    },
    {
      label: t('list.viewGrid'),
      icon: 'grid',
      checked: state.preferences.noteView === 'grid',
      onSelect: () => store.setPreferences({ noteView: 'grid' }),
    },
  ]);
}

/* ------------------------------------------------------------------
   Standard views
   ------------------------------------------------------------------ */

function renderViewNotes(state) {
  const { activeView } = state.ui;
  const notes = filterNotesForView(state);

  if (notes.length === 0) {
    showEmpty(emptyStateFor(activeView));
    dom.results.replaceChildren();
    dom.meta.textContent = '';
    return;
  }

  dom.empty.hidden = true;
  dom.meta.textContent = t('list.count', { count: notes.length });

  const sorted = sortNotes(notes, state.preferences.sort, {
    locale: getLocale(),
    groupPinned: activeView !== VIEWS.trash && activeView !== VIEWS.pinned,
  });

  const pinned = sorted.filter((note) => note.isPinned);
  const rest = sorted.filter((note) => !note.isPinned);
  const grouped = activeView !== VIEWS.trash && activeView !== VIEWS.pinned && pinned.length > 0;

  const sections = grouped
    ? [
        sectionHeading(t('list.pinnedSection')),
        buildList(state, pinned),
        rest.length ? sectionHeading(t('list.otherSection')) : null,
        rest.length ? buildList(state, rest) : null,
      ]
    : [buildList(state, sorted)];

  replaceChildren(dom.results, sections);
}

function sectionHeading(text) {
  return el('h2', { class: 'note-list__section', text });
}

function buildList(state, notes) {
  const list = el('ol', {
    class: `note-list${state.preferences.noteView === 'grid' ? ' note-list--grid' : ''}`,
  });

  const fragment = document.createDocumentFragment();
  for (const note of notes) {
    fragment.append(el('li', {}, [noteCard(state, note)]));
  }
  list.append(fragment);
  return list;
}

/* ------------------------------------------------------------------
   Search view
   ------------------------------------------------------------------ */

function renderSearchResults(state) {
  const query = state.ui.searchQuery.trim();
  dom.searchClear.hidden = query.length === 0;

  if (!query) {
    dom.meta.textContent = '';
    dom.results.replaceChildren();
    showEmpty({
      iconName: 'search',
      title: t('empty.searchIdle.title'),
      body: t('empty.searchIdle.body'),
    });
    return;
  }

  const results = searchWorkspace(state, query, { scope: 'all' });

  if (results.total === 0) {
    dom.meta.textContent = '';
    dom.results.replaceChildren();
    showEmpty({
      iconName: 'search',
      title: t('empty.search.title'),
      body: t('empty.search.body', { query: truncate(query, 40) }),
    });
    return;
  }

  dom.empty.hidden = true;
  dom.meta.textContent = t('search.results', { count: results.total });

  const sections = [];

  if (results.notes.length) {
    sections.push(sectionHeading(t('search.groupNotes')));
    const list = el('ol', { class: 'note-list' });
    for (const hit of results.notes) {
      list.append(el('li', {}, [noteCard(state, hit.note, hit)]));
    }
    sections.push(list);
  }

  if (results.folders.length) {
    sections.push(sectionHeading(t('search.groupFolders')));
    sections.push(
      el(
        'ol',
        { class: 'note-list' },
        results.folders.map((folder) =>
          el('li', {}, [
            el(
              'button',
              {
                type: 'button',
                class: 'note-card u-row',
                onClick: () => hooks.onNavigate({ view: VIEWS.folder, folderId: folder.id }),
              },
              [icon('folder'), el('span', { class: 'note-card__title', text: folder.name })],
            ),
          ]),
        ),
      ),
    );
  }

  if (results.tags.length) {
    sections.push(sectionHeading(t('search.groupTags')));
    sections.push(
      el(
        'ol',
        { class: 'note-list' },
        results.tags.map((tag) =>
          el('li', {}, [
            el(
              'button',
              {
                type: 'button',
                class: 'note-card u-row',
                onClick: () => hooks.onNavigate({ view: VIEWS.tag, tag }),
              },
              [icon('tag'), el('span', { class: 'note-card__title', text: `#${tag}` })],
            ),
          ]),
        ),
      ),
    );
  }

  replaceChildren(dom.results, sections);
}

/* ------------------------------------------------------------------
   Note card
   ------------------------------------------------------------------ */

/**
 * @param {object} state
 * @param {object} note
 * @param {{ titleRanges?: object[], context?: { text: string, ranges: object[] } }} [hit]
 *   search metadata used to highlight the matching parts
 */
function noteCard(state, note, hit) {
  const selected = state.ui.selectedNoteId === note.id;
  const dateOptions = { format: state.preferences.dateFormat, locale: getLocale() };
  const stamp = note.isDeleted ? note.deletedAt ?? note.updatedAt : note.updatedAt;

  const title = el('span', { class: 'note-card__title' });
  const titleText = note.title || t('list.untitled');
  if (hit?.titleRanges?.length) highlightInto(title, titleText, hit.titleRanges);
  else title.textContent = titleText;
  if (!note.title) title.classList.add('u-subtle');

  const excerpt = el('p', { class: 'note-card__excerpt' });
  if (hit?.context) highlightInto(excerpt, hit.context.text, hit.context.ranges);
  else excerpt.textContent = noteExcerpt(note) || t('list.noExcerpt');

  const flags = [];
  if (note.isPinned) flags.push(icon('pin', { className: 'note-card__flag--pin', filled: true }));
  if (note.isFavorite) flags.push(icon('star', { className: 'note-card__flag--fav', filled: true }));

  const footItems = [];
  if (flags.length) footItems.push(el('span', { class: 'note-card__flags' }, flags));
  for (const tag of note.tags.slice(0, 3)) {
    footItems.push(el('span', { class: 'tag', text: `#${tag}` }));
  }
  if (note.tags.length > 3) {
    footItems.push(el('span', { class: 'tag', text: `+${note.tags.length - 3}` }));
  }

  return el(
    'button',
    {
      type: 'button',
      class: 'note-card',
      draggable: !note.isDeleted,
      dataset: { noteId: note.id },
      'aria-current': selected ? 'true' : null,
    },
    [
      el('span', { class: 'note-card__top' }, [
        title,
        el('time', {
          class: 'note-card__time',
          datetime: toDateTimeAttr(stamp),
          text: formatDate(stamp, dateOptions),
        }),
      ]),
      excerpt,
      footItems.length ? el('span', { class: 'note-card__foot' }, footItems) : null,
    ],
  );
}

/* ------------------------------------------------------------------
   Interaction
   ------------------------------------------------------------------ */

function handleListKeydown(event) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;

  const cards = [...dom.results.querySelectorAll('.note-card')];
  const index = cards.indexOf(document.activeElement);
  if (index === -1) return;

  event.preventDefault();
  const next = event.key === 'ArrowDown' ? index + 1 : index - 1;

  if (next < 0) {
    dom.searchBar.hidden ? cards[0].focus() : dom.searchInput.focus();
    return;
  }
  cards[Math.min(next, cards.length - 1)].focus();
}

function handleDragStart(event) {
  const card = event.target.closest('[data-note-id]');
  if (!card || !event.dataTransfer) return;

  event.dataTransfer.setData(DRAG_MIME, card.dataset.noteId);
  event.dataTransfer.effectAllowed = 'move';
  card.classList.add('note-card--dragging');
}

/* ------------------------------------------------------------------
   Empty states
   ------------------------------------------------------------------ */

const EMPTY_STATES = {
  [VIEWS.all]: { iconName: 'note', key: 'allNotes', action: true },
  [VIEWS.favorites]: { iconName: 'star', key: 'favorites' },
  [VIEWS.pinned]: { iconName: 'pin', key: 'pinned' },
  [VIEWS.archive]: { iconName: 'archive', key: 'archive' },
  [VIEWS.trash]: { iconName: 'trash', key: 'trash' },
  [VIEWS.folder]: { iconName: 'folder-open', key: 'folder', action: true },
  [VIEWS.tag]: { iconName: 'tag', key: 'folder', action: true },
};

function emptyStateFor(view) {
  const config = EMPTY_STATES[view] ?? EMPTY_STATES[VIEWS.all];
  return {
    iconName: config.iconName,
    title: t(`empty.${config.key}.title`),
    body: t(`empty.${config.key}.body`),
    action: config.action,
  };
}

function showEmpty({ iconName, title, body, action }) {
  dom.empty.hidden = false;
  dom.empty.replaceChildren(
    el('div', { class: 'empty-state__icon' }, [icon(iconName, { size: 'lg' })]),
    el('p', { class: 'empty-state__title', text: title }),
    el('p', { class: 'empty-state__body', text: body }),
    action
      ? el('button', {
          type: 'button',
          class: 'btn btn--primary',
          text: t('nav.newNote'),
          onClick: () => hooks.onNewNote(),
        })
      : null,
  );
}
