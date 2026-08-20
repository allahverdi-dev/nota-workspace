/**
 * Settings view. Every control writes straight to preferences; there is no
 * save button because there is nothing to submit to.
 */

import { APP, DATE_FORMATS, EDITOR_LEADINGS, EDITOR_SIZES, NOTE_VIEWS, THEMES } from '../config.js';
import { LANGUAGES, t } from '../i18n.js';
import { store } from '../store.js';
import { el, icon, qs } from '../utils.js';

const dom = {};
let hooks = {};

/**
 * @param {{ onExport: () => void, onImportFile: (file: File) => void,
 *   onClearData: () => void }} callbacks
 */
export function initSettings(callbacks) {
  hooks = callbacks;
  dom.root = qs('#settings-view');
  dom.body = qs('#settings-body');
  dom.fileInput = qs('#import-file-input');

  dom.fileInput.addEventListener('change', () => {
    const [file] = dom.fileInput.files ?? [];
    if (file) hooks.onImportFile(file);
    // Reset so choosing the same file twice still fires.
    dom.fileInput.value = '';
  });
}

export function renderSettings(state) {
  const { preferences, ui } = state;

  dom.body.replaceChildren(
    el('h1', { class: 'settings__title', text: t('settings.title') }),
    el('p', { class: 'settings__privacy' }, [icon('shield'), el('span', { text: t('app.privacy') })]),

    section({
      title: t('settings.general'),
      description: t('settings.generalDesc'),
      rows: [
        selectRow({
          label: t('settings.language'),
          description: t('settings.languageDesc'),
          value: preferences.language,
          options: LANGUAGES.map(({ code, label }) => ({ value: code, label })),
          onChange: (language) => store.setPreferences({ language }),
        }),
        selectRow({
          label: t('settings.defaultView'),
          description: t('settings.defaultViewDesc'),
          value: preferences.noteView,
          options: NOTE_VIEWS.map((value) => ({
            value,
            label: value === 'grid' ? t('list.viewGrid') : t('list.viewList'),
          })),
          onChange: (noteView) => store.setPreferences({ noteView }),
        }),
        selectRow({
          label: t('settings.dateFormat'),
          description: t('settings.dateFormatDesc'),
          value: preferences.dateFormat,
          options: DATE_FORMATS.map((value) => ({
            value,
            label: t(`settings.date${value === 'iso' ? 'ISO' : value === 'long' ? 'Long' : 'Relative'}`),
          })),
          onChange: (dateFormat) => store.setPreferences({ dateFormat }),
        }),
      ],
    }),

    appearanceSection(preferences),
    editorSection(preferences),
    dataSection(state),

    el('p', {
      class: 'settings__about',
      text: `${t('settings.about', { version: APP.version })} · ${t('settings.storageLabel')}: ${storageLabel(ui.storageDriver)}`,
    }),
  );
}

function storageLabel(driver) {
  if (driver === 'idb') return t('settings.storageIDB');
  if (driver === 'local') return t('settings.storageLocal');
  return t('settings.storageMemory');
}

/* ------------------------------------------------------------------
   Sections
   ------------------------------------------------------------------ */

function section({ title, description, rows, extra }) {
  return el('section', { class: 'settings-section' }, [
    el('h2', { class: 'settings-section__title', text: title }),
    description ? el('p', { class: 'settings-section__desc', text: description }) : null,
    ...rows,
    extra ?? null,
  ]);
}

function appearanceSection(preferences) {
  const previews = {
    system: 'split',
    light: 'light',
    dark: 'dark',
  };

  const options = THEMES.map((theme) =>
    el(
      'button',
      {
        type: 'button',
        class: 'theme-option',
        role: 'radio',
        'aria-checked': String(preferences.theme === theme),
        onClick: () => store.setPreferences({ theme }),
      },
      [
        el('span', { class: 'theme-option__preview', dataset: { preview: previews[theme] } }, [
          swatch(true),
          swatch(false),
        ]),
        el('span', {
          class: 'theme-option__label',
          text: t(`settings.theme${theme[0].toUpperCase()}${theme.slice(1)}`),
        }),
      ],
    ),
  );

  return el('section', { class: 'settings-section' }, [
    el('h2', { class: 'settings-section__title', text: t('settings.appearance') }),
    el('p', { class: 'settings-section__desc', text: t('settings.appearanceDesc') }),
    el('div', {
      class: 'theme-picker',
      role: 'radiogroup',
      'aria-label': t('settings.theme'),
    }, options),
  ]);
}

function swatch(isRail) {
  return el('span', { class: `theme-swatch${isRail ? ' theme-swatch--rail' : ''}` }, [
    el('span', { class: 'theme-swatch__line theme-swatch__line--accent' }),
    el('span', { class: 'theme-swatch__line' }),
    el('span', { class: 'theme-swatch__line theme-swatch__line--short' }),
  ]);
}

function editorSection(preferences) {
  return section({
    title: t('settings.editor'),
    description: t('settings.editorDesc'),
    rows: [
      selectRow({
        label: t('settings.fontSize'),
        description: t('settings.fontSizeDesc'),
        value: preferences.editorFontSize,
        options: EDITOR_SIZES.map((value) => ({
          value,
          label: t(`settings.size${value[0].toUpperCase()}${value.slice(1)}`),
        })),
        onChange: (editorFontSize) => store.setPreferences({ editorFontSize }),
      }),
      selectRow({
        label: t('settings.lineHeight'),
        description: t('settings.lineHeightDesc'),
        value: preferences.lineHeight,
        options: EDITOR_LEADINGS.map((value) => ({
          value,
          label: t(`settings.leading${value[0].toUpperCase()}${value.slice(1)}`),
        })),
        onChange: (lineHeight) => store.setPreferences({ lineHeight }),
      }),
      switchRow({
        label: t('settings.spellcheck'),
        description: t('settings.spellcheckDesc'),
        checked: preferences.spellcheck,
        onChange: (spellcheck) => store.setPreferences({ spellcheck }),
      }),
    ],
    extra: el('p', { class: 'editor-preview', text: t('settings.preview') }),
  });
}

function dataSection(state) {
  const trashed = state.notes.filter((note) => note.isDeleted).length;
  const total = state.notes.length;

  return section({
    title: t('settings.data'),
    description: t('settings.dataDesc'),
    rows: [
      actionRow({
        label: t('settings.export'),
        description: `${t('settings.exportDesc')} (${total} · ${trashed} ⌫)`,
        button: el('button', {
          type: 'button',
          class: 'btn btn--outline',
          text: t('settings.exportAction'),
          onClick: () => hooks.onExport(),
        }),
      }),
      actionRow({
        label: t('settings.import'),
        description: t('settings.importDesc'),
        button: el('button', {
          type: 'button',
          class: 'btn btn--outline',
          text: t('settings.importAction'),
          onClick: () => dom.fileInput.click(),
        }),
      }),
    ],
    extra: el('div', { class: 'danger-zone' }, [
      el('div', { class: 'settings-row' }, [
        el('div', { class: 'settings-row__text' }, [
          el('p', { class: 'settings-row__label', text: t('settings.clear') }),
          el('p', { class: 'settings-row__desc', text: t('settings.clearDesc') }),
        ]),
        el('div', { class: 'settings-row__control' }, [
          el('button', {
            type: 'button',
            class: 'btn btn--danger-solid',
            text: t('settings.clearAction'),
            onClick: () => hooks.onClearData(),
          }),
        ]),
      ]),
    ]),
  });
}

/* ------------------------------------------------------------------
   Rows
   ------------------------------------------------------------------ */

let rowSeq = 0;

function rowShell(label, description, control, controlId) {
  return el('div', { class: 'settings-row' }, [
    el('div', { class: 'settings-row__text' }, [
      controlId
        ? el('label', { class: 'settings-row__label', for: controlId, text: label })
        : el('p', { class: 'settings-row__label', text: label }),
      description ? el('p', { class: 'settings-row__desc', text: description }) : null,
    ]),
    el('div', { class: 'settings-row__control' }, [control]),
  ]);
}

function selectRow({ label, description, value, options, onChange }) {
  const id = `setting-${++rowSeq}`;
  const select = el(
    'select',
    { class: 'select', id, onChange: (event) => onChange(event.target.value) },
    options.map((option) =>
      el('option', {
        value: option.value,
        selected: option.value === value,
        text: option.label,
      }),
    ),
  );
  select.value = value;
  return rowShell(label, description, select, id);
}

function switchRow({ label, description, checked, onChange }) {
  const id = `setting-${++rowSeq}`;
  const toggle = el('button', {
    type: 'button',
    class: 'switch',
    id,
    role: 'switch',
    'aria-checked': String(checked),
    'aria-label': label,
    onClick: () => onChange(!checked),
  });
  return rowShell(label, description, toggle);
}

function actionRow({ label, description, button }) {
  return rowShell(label, description, button);
}
