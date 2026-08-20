/**
 * Left navigation: library views, folders, and the app-level controls.
 * Rebuilt whenever notes, folders, preferences or the active view change.
 */

import { VIEWS } from '../config.js';
import { t } from '../i18n.js';
import { el, icon, modKeyLabel, qs } from '../utils.js';
import { getViewCounts, moveNoteToFolder } from '../notes.js';
import { countNotesInFolder, createFolder, deleteFolder, listFolders, renameFolder, validateFolderName } from '../folders.js';
import { confirmDialog, openMenu, promptDialog, toast } from '../ui.js';
import { store } from '../store.js';
import { listTags } from '../tags.js';

const dom = {};
let hooks = {};

/**
 * @param {{ onNavigate: (route: object) => void, onNewNote: () => void,
 *   onOpenSearch: () => void, onOpenSettings: () => void,
 *   onToggleTheme: () => void, onCloseSidebar: () => void }} callbacks
 */
export function initSidebar(callbacks) {
  hooks = callbacks;

  dom.body = qs('#sidebar-body');
  dom.newNote = qs('#new-note-button');
  dom.search = qs('#search-trigger');
  dom.searchKeys = qs('#search-trigger-keys');
  dom.settings = qs('#settings-button');
  dom.theme = qs('#theme-button');
  dom.close = qs('#sidebar-close');

  dom.newNote.addEventListener('click', () => hooks.onNewNote());
  dom.search.addEventListener('click', () => hooks.onOpenSearch());
  dom.settings.addEventListener('click', () => hooks.onOpenSettings());
  dom.theme.addEventListener('click', () => hooks.onToggleTheme());
  dom.close.addEventListener('click', () => hooks.onCloseSidebar());

  dom.searchKeys.replaceChildren(
    el('kbd', { text: modKeyLabel }),
    el('kbd', { text: 'K' }),
  );
}

/**
 * The theme control cycles system → light → dark. On a device whose system
 * preference already matches, two of those states paint identically, so the
 * button has to say which one it is in rather than showing a fixed icon.
 */
const THEME_ICONS = { system: 'monitor', light: 'sun', dark: 'moon' };

function renderThemeButton(theme) {
  const label = t('nav.themeCurrent', { mode: t(`settings.theme${theme[0].toUpperCase()}${theme.slice(1)}`) });
  dom.theme.replaceChildren(icon(THEME_ICONS[theme] ?? 'moon'));
  dom.theme.setAttribute('aria-label', label);
  dom.theme.title = label;
}

export function renderSidebar(state) {
  const counts = getViewCounts(state);
  const { activeView, selectedFolderId } = state.ui;

  dom.newNote.setAttribute('aria-label', t('nav.newNote'));
  dom.newNote.querySelector('span').textContent = t('nav.newNote');
  dom.search.querySelector('.search-trigger__label').textContent = t('nav.quickSearch');
  dom.settings.querySelector('.nav-item__label').textContent = t('nav.settings');
  renderThemeButton(state.preferences.theme);

  const library = [
    navEntry({
      view: VIEWS.all,
      label: t('nav.allNotes'),
      iconName: 'note',
      count: counts.all,
      active: activeView === VIEWS.all,
    }),
    navEntry({
      view: VIEWS.favorites,
      label: t('nav.favorites'),
      iconName: 'star',
      count: counts.favorites,
      active: activeView === VIEWS.favorites,
    }),
    navEntry({
      view: VIEWS.pinned,
      label: t('nav.pinned'),
      iconName: 'pin',
      count: counts.pinned,
      active: activeView === VIEWS.pinned,
    }),
    navEntry({
      view: VIEWS.archive,
      label: t('nav.archive'),
      iconName: 'archive',
      count: counts.archive,
      active: activeView === VIEWS.archive,
    }),
    navEntry({
      view: VIEWS.trash,
      label: t('nav.trash'),
      iconName: 'trash',
      count: counts.trash,
      active: activeView === VIEWS.trash,
    }),
  ];

  const folders = listFolders(state).map((folder) =>
    folderRow(state, folder, {
      active: activeView === VIEWS.folder && selectedFolderId === folder.id,
      count: counts.byFolder.get(folder.id) ?? 0,
    }),
  );

  const unfiledCount = counts.byFolder.get('__unfiled__') ?? 0;
  if (unfiledCount > 0) {
    folders.push(
      navEntry({
        view: VIEWS.folder,
        folderId: null,
        label: t('nav.unfiled'),
        iconName: 'folder-open',
        count: unfiledCount,
        active: activeView === VIEWS.folder && selectedFolderId === null,
      }),
    );
  }

  // Tags earn a place in the sidebar only once they exist; an empty group
  // would just be furniture.
  const tags = listTags(state).slice(0, 8);

  dom.body.replaceChildren(
    el('div', { class: 'nav-group' }, [
      el('h2', { class: 'nav-group__title', id: 'nav-library-title', text: t('nav.library') }),
      el('div', { role: 'list', 'aria-labelledby': 'nav-library-title' }, library),
    ]),
    el('div', { class: 'nav-group' }, [
      el('div', { class: 'nav-group__head' }, [
        el('h2', { class: 'nav-group__title', id: 'nav-folders-title', text: t('nav.folders') }),
        el(
          'button',
          {
            type: 'button',
            class: 'icon-btn',
            'aria-label': t('nav.newFolder'),
            title: t('nav.newFolder'),
            onClick: () => void addFolder(),
          },
          [icon('plus', { size: 'sm' })],
        ),
      ]),
      el('div', { role: 'list', 'aria-labelledby': 'nav-folders-title' }, folders),
    ]),
    tags.length
      ? el('div', { class: 'nav-group' }, [
          el('h2', { class: 'nav-group__title', id: 'nav-tags-title', text: t('nav.tags') }),
          el(
            'div',
            { role: 'list', 'aria-labelledby': 'nav-tags-title' },
            tags.map(({ name, count }) =>
              navEntry({
                view: VIEWS.tag,
                tag: name,
                label: `#${name}`,
                iconName: 'tag',
                count,
                active: activeView === VIEWS.tag && state.ui.selectedTag === name,
              }),
            ),
          ),
        ])
      : null,
  );
}

function navEntry({ view, folderId, tag, label, iconName, count, active }) {
  const button = el(
    'button',
    {
      type: 'button',
      class: 'nav-item',
      role: 'listitem',
      'aria-current': active ? 'page' : null,
      onClick: () => hooks.onNavigate({ view, folderId: folderId ?? null, tag: tag ?? null }),
    },
    [
      icon(iconName, { filled: active && (iconName === 'star' || iconName === 'pin') }),
      el('span', { class: 'nav-item__label', text: label }),
      count ? el('span', { class: 'nav-item__count', text: String(count) }) : null,
    ],
  );

  if (view === VIEWS.folder) enableFolderDrop(button, folderId ?? null);
  return button;
}

/** A folder row is a navigation button plus its own actions menu. */
function folderRow(state, folder, { active, count }) {
  const entry = navEntry({
    view: VIEWS.folder,
    folderId: folder.id,
    label: folder.name,
    iconName: active ? 'folder-open' : 'folder',
    count,
    active,
  });

  const menuButton = el(
    'button',
    {
      type: 'button',
      class: 'icon-btn folder-row__menu',
      'aria-label': t('folder.actions', { name: folder.name }),
      'aria-haspopup': 'menu',
      'aria-expanded': 'false',
      onClick: (event) => openFolderMenu(event.currentTarget, folder),
    },
    [icon('more', { size: 'sm' })],
  );

  return el('div', { class: 'folder-row', role: 'listitem' }, [entry, menuButton]);
}

function openFolderMenu(anchor, folder) {
  void openMenu(anchor, [
    {
      label: t('common.rename'),
      icon: 'pencil',
      onSelect: () => void renameFolderFlow(folder),
    },
    {
      label: t('common.delete'),
      icon: 'trash',
      danger: true,
      onSelect: () => void deleteFolderFlow(folder),
    },
  ]);
}

/* ------------------------------------------------------------------
   Folder flows
   ------------------------------------------------------------------ */

function nameValidator(ignoreId) {
  return (value) => {
    const result = validateFolderName(value, ignoreId);
    if (result === 'empty') return t('folder.nameRequired');
    if (result === 'duplicate') return t('folder.nameTaken');
    return null;
  };
}

export async function addFolder() {
  const name = await promptDialog({
    title: t('folder.create.title'),
    label: t('folder.create.label'),
    placeholder: t('folder.create.placeholder'),
    confirmLabel: t('common.create'),
    maxLength: 60,
    validate: nameValidator(),
  });
  if (!name) return null;

  const folder = createFolder(name);
  if (folder) {
    toast(t('folder.created', { name: folder.name }), { variant: 'success' });
    hooks.onNavigate({ view: VIEWS.folder, folderId: folder.id });
  }
  return folder;
}

async function renameFolderFlow(folder) {
  const name = await promptDialog({
    title: t('folder.rename.title'),
    label: t('folder.create.label'),
    value: folder.name,
    confirmLabel: t('common.rename'),
    maxLength: 60,
    validate: nameValidator(folder.id),
  });
  if (!name || name === folder.name) return;

  if (renameFolder(folder.id, name)) toast(t('folder.renamed'), { variant: 'success' });
}

async function deleteFolderFlow(folder) {
  const count = countNotesInFolder(store.getState(), folder.id);

  const confirmed = await confirmDialog({
    title: t('folder.delete.title', { name: folder.name }),
    body: count > 0 ? t('folder.delete.body', { count }) : t('folder.delete.bodyEmpty'),
    confirmLabel: t('common.delete'),
    danger: true,
  });
  if (!confirmed) return;

  deleteFolder(folder.id);
  toast(t('folder.deleted'), { variant: 'success' });
}

/* ------------------------------------------------------------------
   Drag and drop
   ------------------------------------------------------------------ */

export const DRAG_MIME = 'application/x-nota-note';

function enableFolderDrop(element, folderId) {
  element.addEventListener('dragover', (event) => {
    if (!event.dataTransfer?.types.includes(DRAG_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    element.classList.add('nav-item--drop-target');
  });

  element.addEventListener('dragleave', () => element.classList.remove('nav-item--drop-target'));

  element.addEventListener('drop', (event) => {
    element.classList.remove('nav-item--drop-target');
    const noteId = event.dataTransfer?.getData(DRAG_MIME);
    if (!noteId) return;

    event.preventDefault();
    moveNoteToFolder(noteId, folderId);
    toast(t('folder.moved', { name: element.querySelector('.nav-item__label').textContent }), {
      variant: 'success',
    });
  });
}
