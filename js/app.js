/**
 * Application entry point.
 *
 * Everything below is wiring: bring up storage, hydrate the store, connect
 * the views to state changes, and own the handful of behaviours that span
 * modules — routing, keyboard shortcuts, persistence and theming.
 */

import { APP, TIMING, VIEWS } from './config.js';
import { setLanguage, t } from './i18n.js';
import { store, touches } from './store.js';
import {
  clearStorage,
  createInitialState,
  initStorage,
  loadState,
  markOnboarded,
  mirrorTheme,
  readOnboarded,
  saveState,
} from './storage.js';
import { initRouter, navigate, syncHash } from './router.js';
import { debounce, el, hasModKey, isTypingContext, modKeyLabel, qs } from './utils.js';
import { announce, closeAllOverlays, confirmDialog, hasOpenOverlay, initUI, openMenu, toast } from './ui.js';
import {
  createNote,
  destroyNote,
  duplicateNote,
  emptyTrash,
  getNote,
  moveNoteToFolder,
  restoreNote,
  toggleArchived,
  toggleFavorite,
  togglePinned,
  trashNote,
} from './notes.js';
import { folderOptions } from './folders.js';
import { syncTagIndex } from './tags.js';
import { initSidebar, renderSidebar } from './views/sidebar.js';
import { focusSearchInput, initNoteList, renderNoteList } from './views/note-list.js';
import { initSettings, renderSettings } from './views/settings.js';
import { showOnboarding } from './views/onboarding.js';
import { flushEditor, focusTitle, initEditor, renderEditor, renderSaveStatus } from './editor.js';
import { initCommands, openPalette, setNoteOpener } from './commands.js';
import { applyBackup, describeImportFailure, exportBackup, readBackupFile } from './import-export.js';

const dom = {};
let persistenceReady = false;

/* ------------------------------------------------------------------
   Boot
   ------------------------------------------------------------------ */

async function boot() {
  cacheDom();
  initUI();

  const driver = await initStorage();
  const { state: stored, corrupted } = await loadState();

  store.hydrate(stored ?? createInitialState({ seed: false }));

  // Onboarding is owed to anyone who has not completed it and has nothing to
  // lose — including someone who closed the tab midway through it last time.
  const firstRun = !readOnboarded() && !corrupted && (stored?.notes.length ?? 0) === 0;

  store.setUI({ storageDriver: driver, saveState: 'idle', ready: true });
  applyPreferences(store.getState());

  wireViews();
  wireGlobalEvents();
  registerCommands();

  initRouter(handleRoute);
  renderAll(store.getState());
  store.subscribe(handleStateChange);

  persistenceReady = true;

  if (corrupted) {
    toast(t('error.load'), { variant: 'error', duration: 9000 });
  }
  if (driver === 'memory') {
    toast(t('error.storage'), { variant: 'error', duration: 9000 });
  }

  if (firstRun && !corrupted) {
    await runOnboarding();
  }

  dom.app.dataset.booted = 'true';
}

function cacheDom() {
  dom.app = qs('#app');
  dom.sidebar = qs('#sidebar');
  dom.scrim = qs('#sidebar-scrim');
  dom.detail = qs('#detail-pane');
  dom.editor = qs('#editor');
  dom.settings = qs('#settings-view');
  dom.detailEmpty = qs('#detail-empty');
  dom.paneBack = qs('#pane-back');
  dom.settingsBack = qs('#settings-back');
}

/* ------------------------------------------------------------------
   First run
   ------------------------------------------------------------------ */

async function runOnboarding() {
  const choice = await showOnboarding();
  markOnboarded();

  if (choice === 'import') {
    goTo({ view: VIEWS.settings });
    qs('#import-file-input')?.click();
    return;
  }

  // Seed a small, realistic workspace so the first screen is not blank.
  const seeded = createInitialState({ seed: true });
  store.hydrate(seeded);
  syncTagIndex();

  const first = seeded.notes[0];
  if (first) goTo({ view: VIEWS.all, noteId: first.id });
  toast(t('onboarding.seeded'));
}

/* ------------------------------------------------------------------
   View wiring
   ------------------------------------------------------------------ */

function wireViews() {
  initSidebar({
    onNavigate: (route) => {
      goTo(route);
      closeSidebar();
    },
    onNewNote: handleNewNote,
    onOpenSearch: () => {
      openSearchView();
      closeSidebar();
    },
    onOpenSettings: () => {
      goTo({ view: VIEWS.settings });
      closeSidebar();
    },
    onToggleTheme: cycleTheme,
    onCloseSidebar: closeSidebar,
  });

  initNoteList({
    onSelectNote: openNote,
    onNewNote: handleNewNote,
    onNavigate: (route) => goTo(route),
    onSearchInput: handleSearchInput,
    onEmptyTrash: handleEmptyTrash,
    onOpenSidebar: openSidebar,
  });

  initEditor({
    onOpenFolder: (folderId) => goTo({ view: VIEWS.folder, folderId }),
    onNoteAction: handleNoteAction,
  });

  initSettings({
    onExport: handleExport,
    onImportFile: handleImportFile,
    onClearData: handleClearData,
  });

  setNoteOpener(openNote);

  dom.scrim.addEventListener('click', closeSidebar);
  for (const button of [dom.paneBack, dom.settingsBack]) {
    button?.addEventListener('click', showListPane);
  }
}

/* ------------------------------------------------------------------
   Rendering
   ------------------------------------------------------------------ */

function renderAll(state) {
  applyPreferences(state);
  renderSidebar(state);
  renderNoteList(state);
  renderDetail(state);
  renderSaveStatus(state);
}

function handleStateChange(state, changed) {
  if (touches(changed, ['preferences'])) applyPreferences(state);

  if (touches(changed, ['notes', 'folders', 'preferences', 'ui.activeView', 'ui.selectedFolderId'])) {
    renderSidebar(state);
  }

  if (
    touches(changed, [
      'notes',
      'folders',
      'preferences',
      'ui.activeView',
      'ui.selectedFolderId',
      'ui.selectedTag',
      'ui.selectedNoteId',
      'ui.searchQuery',
    ])
  ) {
    renderNoteList(state);
  }

  if (touches(changed, ['notes', 'folders', 'preferences', 'ui.activeView', 'ui.selectedNoteId'])) {
    renderDetail(state);
  }

  if (touches(changed, ['ui.saveState', 'preferences'])) renderSaveStatus(state);

  if (touches(changed, ['ui.sidebarOpen', 'ui.mobilePane'])) applyShellState(state);

  if (touches(changed, ['notes'])) syncTagIndex();

  if (touches(changed, ['notes', 'folders', 'tags', 'preferences'])) schedulePersist();

  if (touches(changed, ['ui.activeView', 'ui.selectedNoteId', 'ui.selectedFolderId', 'ui.selectedTag', 'ui.searchQuery'])) {
    syncHash(routeFromState(state));
  }
}

function renderDetail(state) {
  const isSettings = state.ui.activeView === VIEWS.settings;
  const note = getNote(state, state.ui.selectedNoteId);

  dom.settings.hidden = !isSettings;
  dom.editor.hidden = isSettings || !note;
  dom.detailEmpty.hidden = isSettings || Boolean(note);

  if (isSettings) {
    renderSettings(state);
    return;
  }

  if (note) {
    renderEditor(state);
  } else {
    renderEmptyDetail();
  }
}

let emptyDetailRendered = false;

function renderEmptyDetail() {
  if (emptyDetailRendered) return;
  emptyDetailRendered = true;

  dom.detailEmpty.replaceChildren(
    el('p', { class: 'empty-state__title', text: t('empty.detail.title') }),
    el('p', { class: 'empty-state__body', text: t('empty.detail.body') }),
    el('button', {
      type: 'button',
      class: 'btn btn--primary',
      text: t('nav.newNote'),
      onClick: handleNewNote,
    }),
    el('p', { class: 'empty-state__hint' }, [
      el('kbd', { text: modKeyLabel }),
      el('kbd', { text: 'N' }),
      el('span', { text: t('empty.detail.hint') }),
    ]),
  );
}

/* ------------------------------------------------------------------
   Preferences → document
   ------------------------------------------------------------------ */

let appliedLanguage = null;
let mediaQuery = null;

function applyPreferences(state) {
  const { preferences } = state;
  const root = document.documentElement;

  resolveTheme(preferences.theme);
  mirrorTheme(preferences.theme);

  root.dataset.editorSize = preferences.editorFontSize;
  root.dataset.editorLeading = preferences.lineHeight;

  if (preferences.language !== appliedLanguage) {
    setLanguage(preferences.language);
    appliedLanguage = preferences.language;
    if (persistenceReady) {
      // Labels are built during render, so a language switch needs a full pass.
      queueMicrotask(() => {
        emptyDetailRendered = false;
        renderAll(store.getState());
      });
    }
  }
}

function resolveTheme(preference) {
  if (!mediaQuery && window.matchMedia) {
    mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    mediaQuery.addEventListener('change', () => {
      if (store.getState().preferences.theme === 'system') {
        resolveTheme('system');
      }
    });
  }

  const resolved =
    preference === 'system' ? (mediaQuery?.matches ? 'dark' : 'light') : preference;
  document.documentElement.dataset.theme = resolved;
}

function cycleTheme() {
  const order = ['system', 'light', 'dark'];
  const current = store.getState().preferences.theme;
  const next = order[(order.indexOf(current) + 1) % order.length];

  store.setPreferences({ theme: next });
  announce(t(`settings.theme${next[0].toUpperCase()}${next.slice(1)}`));
}

/* ------------------------------------------------------------------
   Shell (sidebar + mobile panes)
   ------------------------------------------------------------------ */

function applyShellState(state) {
  dom.app.dataset.sidebar = state.ui.sidebarOpen ? 'open' : 'closed';
  dom.app.dataset.pane = state.ui.mobilePane;
  dom.scrim.hidden = !state.ui.sidebarOpen;
}

function openSidebar() {
  store.setUI({ sidebarOpen: true });
  store.flush();
  dom.sidebar.querySelector('button')?.focus();
}

function closeSidebar() {
  if (!store.getState().ui.sidebarOpen) return;
  store.setUI({ sidebarOpen: false });
}

function showListPane() {
  store.setUI({ mobilePane: 'list' });
}

function showDetailPane() {
  store.setUI({ mobilePane: 'detail' });
}

/* ------------------------------------------------------------------
   Routing
   ------------------------------------------------------------------ */

function routeFromState(state) {
  const { activeView, selectedFolderId, selectedTag, selectedNoteId, searchQuery } = state.ui;
  return {
    view: activeView,
    folderId: selectedFolderId,
    tag: selectedTag,
    query: searchQuery,
    noteId: selectedNoteId,
  };
}

/** Router → state. */
function handleRoute(route) {
  flushEditor();

  const state = store.getState();
  const noteExists = route.noteId ? Boolean(getNote(state, route.noteId)) : false;

  store.setUI({
    activeView: route.view,
    selectedFolderId: route.folderId,
    selectedTag: route.tag,
    searchQuery: route.view === VIEWS.search ? route.query : '',
    selectedNoteId: noteExists ? route.noteId : null,
    mobilePane: noteExists || route.view === VIEWS.settings ? 'detail' : 'list',
  });

  if (route.noteId && !noteExists && state.ui.ready) {
    toast(t('note.missing'), { variant: 'error' });
  }
}

/** State → router, for user-initiated navigation. */
function goTo(partial) {
  const state = store.getState();
  const base = routeFromState(state);
  navigate({ ...base, noteId: null, query: '', ...partial });
}

/** Switch to search and put the caret in the field, in one synchronous step. */
function openSearchView() {
  goTo({ view: VIEWS.search });
  store.flush();
  focusSearchInput();
}

function openNote(noteId) {
  flushEditor();
  const state = store.getState();
  goTo({
    view: state.ui.activeView === VIEWS.settings ? VIEWS.all : state.ui.activeView,
    folderId: state.ui.selectedFolderId,
    tag: state.ui.selectedTag,
    query: state.ui.searchQuery,
    noteId,
  });
  showDetailPane();
}

/* ------------------------------------------------------------------
   Note actions
   ------------------------------------------------------------------ */

function handleNewNote() {
  flushEditor();
  const note = createNote();
  goTo({ noteId: note.id });
  showDetailPane();
  // Renders synchronously so the caret can land in the title straight away.
  store.flush();
  focusTitle();
  announce(t('note.created'));
}

/**
 * @param {string} action
 * @param {string} noteId
 * @param {HTMLElement} [anchor] for menu actions
 */
function handleNoteAction(action, noteId, anchor) {
  switch (action) {
    case 'trash':
      handleTrash(noteId);
      break;
    case 'restore':
      restoreNote(noteId);
      toast(t('note.restored'), { variant: 'success' });
      break;
    case 'destroy':
      void handleDestroy(noteId);
      break;
    case 'menu':
      openNoteMenu(anchor, noteId);
      break;
    default:
      break;
  }
}

function handleTrash(noteId) {
  const note = getNote(store.getState(), noteId);
  if (!note) return;

  flushEditor();
  trashNote(noteId);
  store.setUI({ selectedNoteId: null, mobilePane: 'list' });

  toast(t('note.trashed'), {
    action: {
      label: t('common.undo'),
      onSelect: () => {
        restoreNote(noteId);
        openNote(noteId);
      },
    },
  });
}

async function handleDestroy(noteId) {
  const note = getNote(store.getState(), noteId);
  if (!note) return;

  const confirmed = await confirmDialog({
    title: t('note.delete.title'),
    body: t('note.delete.body', { title: note.title || t('list.untitled') }),
    confirmLabel: t('note.delete.confirm'),
    danger: true,
  });
  if (!confirmed) return;

  destroyNote(noteId);
  toast(t('note.deletedForever'), { variant: 'success' });
}

async function handleEmptyTrash() {
  const count = store.getState().notes.filter((note) => note.isDeleted).length;
  if (count === 0) return;

  const confirmed = await confirmDialog({
    title: t('note.emptyTrash.title'),
    body: t('note.emptyTrash.body', { count }),
    confirmLabel: t('note.emptyTrash.confirm'),
    danger: true,
  });
  if (!confirmed) return;

  emptyTrash();
  toast(t('note.trashEmptied'), { variant: 'success' });
}

function openNoteMenu(anchor, noteId) {
  const state = store.getState();
  const note = getNote(state, noteId);
  if (!note || !anchor) return;

  const items = [];

  if (!note.isDeleted) {
    items.push(
      {
        label: note.isFavorite ? t('editor.unfavorite') : t('editor.favorite'),
        icon: 'star',
        onSelect: () => toggleFavorite(noteId),
      },
      {
        label: note.isPinned ? t('editor.unpin') : t('editor.pin'),
        icon: 'pin',
        onSelect: () => togglePinned(noteId),
      },
      {
        label: note.isArchived ? t('editor.unarchive') : t('editor.archive'),
        icon: 'archive',
        onSelect: () => toggleArchived(noteId),
      },
      { separator: true },
      {
        label: t('editor.duplicate'),
        icon: 'copy',
        onSelect: () => {
          const copy = duplicateNote(noteId);
          if (copy) {
            openNote(copy.id);
            toast(t('note.duplicated'), { variant: 'success' });
          }
        },
      },
      { separator: true },
    );

    for (const folder of folderOptions(state, t('nav.unfiled'))) {
      items.push({
        label: folder.name,
        icon: folder.id ? 'folder' : 'folder-open',
        checked: note.folderId === folder.id,
        onSelect: () => {
          moveNoteToFolder(noteId, folder.id);
          toast(t('folder.moved', { name: folder.name }), { variant: 'success' });
        },
      });
    }

    items.push({ separator: true }, {
      label: t('editor.delete'),
      icon: 'trash',
      danger: true,
      onSelect: () => handleTrash(noteId),
    });
  } else {
    items.push(
      { label: t('editor.restore'), icon: 'restore', onSelect: () => handleNoteAction('restore', noteId) },
      {
        label: t('editor.deleteForever'),
        icon: 'trash',
        danger: true,
        onSelect: () => void handleDestroy(noteId),
      },
    );
  }

  void openMenu(anchor, items);
}

/* ------------------------------------------------------------------
   Search
   ------------------------------------------------------------------ */

const applySearchQuery = debounce((value) => {
  store.setUI({ searchQuery: value });
}, TIMING.searchDelay);

function handleSearchInput(value) {
  if (store.getState().ui.activeView !== VIEWS.search) {
    goTo({ view: VIEWS.search, query: value });
    return;
  }
  applySearchQuery(value);
}

/* ------------------------------------------------------------------
   Data
   ------------------------------------------------------------------ */

function handleExport() {
  flushEditor();
  const ok = exportBackup(store.getState());
  toast(ok ? t('data.exported') : t('data.exportFailed'), {
    variant: ok ? 'success' : 'error',
  });
}

async function handleImportFile(file) {
  const result = await readBackupFile(file);

  if (!result.ok) {
    toast(describeImportFailure(result.reason), { variant: 'error' });
    return;
  }

  const confirmed = await confirmDialog({
    title: t('data.importTitle'),
    body: t('data.importBody', { notes: result.noteCount, folders: result.folderCount }),
    confirmLabel: t('data.importConfirm'),
    danger: true,
  });
  if (!confirmed) return;

  applyBackup(result.state);
  markOnboarded();
  goTo({ view: VIEWS.all });
  toast(t('data.imported', { count: result.noteCount }), { variant: 'success' });
}

async function handleClearData() {
  const confirmed = await confirmDialog({
    title: t('data.clearTitle'),
    body: t('data.clearBody'),
    confirmLabel: t('data.clearConfirm'),
    danger: true,
  });
  if (!confirmed) return;

  persistenceReady = false;
  await clearStorage();

  store.hydrate(createInitialState({ seed: false }));
  store.setUI({ selectedNoteId: null, selectedFolderId: null, searchQuery: '' });
  persistenceReady = true;

  goTo({ view: VIEWS.all });
  toast(t('data.cleared'), { variant: 'success' });
}

/* ------------------------------------------------------------------
   Persistence
   ------------------------------------------------------------------ */

const schedulePersist = debounce(async () => {
  if (!persistenceReady) return;

  try {
    await saveState(store.getState());
    store.setUI({ saveState: 'saved' });
  } catch (error) {
    console.error('Persist failed', error);
    store.setUI({ saveState: 'error' });
    toast(t('error.storage'), { variant: 'error' });
  }
}, TIMING.persistDelay);

/* ------------------------------------------------------------------
   Commands + shortcuts
   ------------------------------------------------------------------ */

function registerCommands() {
  initCommands(() => {
    const state = store.getState();

    return [
      {
        id: 'new-note',
        group: 'Actions',
        icon: 'plus',
        title: t('palette.newNote'),
        keys: KEY_HINTS.newNote,
        run: handleNewNote,
      },
      {
        id: 'search',
        group: 'Actions',
        icon: 'search',
        title: t('palette.searchNotes'),
        keys: KEY_HINTS.search,
        run: openSearchView,
      },
      {
        id: 'export',
        group: 'Actions',
        icon: 'download',
        title: t('palette.exportData'),
        run: handleExport,
      },
      ...(state.notes.some((note) => note.isDeleted)
        ? [{
            id: 'empty-trash',
            group: 'Actions',
            icon: 'trash',
            title: t('palette.emptyTrash'),
            run: () => void handleEmptyTrash(),
          }]
        : []),

      ...[
        [VIEWS.all, 'nav.allNotes', 'note'],
        [VIEWS.favorites, 'nav.favorites', 'star'],
        [VIEWS.pinned, 'nav.pinned', 'pin'],
        [VIEWS.archive, 'nav.archive', 'archive'],
        [VIEWS.trash, 'nav.trash', 'trash'],
      ].map(([view, key, iconName]) => ({
        id: `go-${view}`,
        group: 'Navigate',
        icon: iconName,
        title: t(key),
        run: () => goTo({ view }),
      })),

      {
        id: 'toggle-theme',
        group: 'Preferences',
        icon: 'moon',
        title: t('palette.toggleTheme'),
        subtitle: t(`settings.theme${capitalize(state.preferences.theme)}`),
        run: cycleTheme,
      },
      {
        id: 'settings',
        group: 'Preferences',
        icon: 'settings',
        title: t('palette.openSettings'),
        run: () => goTo({ view: VIEWS.settings }),
      },
    ];
  });
}

function capitalize(value) {
  return `${value[0].toUpperCase()}${value.slice(1)}`;
}

const KEY_HINTS = {
  newNote: [modKeyLabel, 'N'],
  search: ['/'],
};

const endResize = debounce(() => {
  delete document.documentElement.dataset.resizing;
}, 200);

function wireGlobalEvents() {
  document.addEventListener('keydown', handleGlobalKeydown);

  window.addEventListener('resize', () => {
    document.documentElement.dataset.resizing = 'true';
    endResize();
  });

  // A pending autosave must not be lost to a refresh or a closing tab.
  window.addEventListener('beforeunload', flushEditor);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushEditor();
  });

  qs('#skip-link')?.addEventListener('click', () => {
    setTimeout(() => qs('#editor-content')?.focus(), 0);
  });
}

function handleGlobalKeydown(event) {
  if (hasModKey(event) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    void openPalette();
    return;
  }

  if (hasModKey(event) && event.key.toLowerCase() === 'n' && !event.shiftKey) {
    event.preventDefault();
    handleNewNote();
    return;
  }

  if (hasModKey(event) && event.key.toLowerCase() === 's') {
    // The browser's "save page" is never what someone wants in a notes app.
    event.preventDefault();
    flushEditor();
    announce(t('editor.saved'));
    return;
  }

  if (event.key === 'Escape' && !hasOpenOverlay()) {
    if (store.getState().ui.sidebarOpen) {
      event.preventDefault();
      closeSidebar();
    }
    return;
  }

  if (event.key === '/' && !isTypingContext(event.target) && !hasOpenOverlay()) {
    event.preventDefault();
    openSearchView();
  }
}

/* ------------------------------------------------------------------
   Start
   ------------------------------------------------------------------ */

boot().catch((error) => {
  console.error(`${APP.name} failed to start`, error);
  closeAllOverlays();

  const shell = qs('#app');
  if (shell) {
    shell.replaceChildren(
      el('div', { class: 'empty-state empty-state--fill' }, [
        el('p', { class: 'empty-state__title', text: t('error.generic') }),
        el('p', { class: 'empty-state__body', text: String(error?.message ?? error) }),
        el('button', {
          type: 'button',
          class: 'btn btn--primary',
          text: 'Reload',
          onClick: () => window.location.reload(),
        }),
      ]),
    );
  }
});
