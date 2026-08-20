/**
 * Shared feedback and overlay primitives: toasts, dialogs, popup menus,
 * the polite live region, and the focus trap they all share.
 *
 * Overlays are stacked. Escape closes the topmost one, Tab is trapped inside
 * it, and focus returns to whatever opened it.
 */

import { TIMING } from './config.js';
import { t } from './i18n.js';
import { el, icon, qsa } from './utils.js';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',');

/** @type {{ element: HTMLElement, close: (result?: unknown) => void, restoreTo: Element | null }[]} */
const overlayStack = [];

let liveRegion = null;
let toastRegion = null;

/* ------------------------------------------------------------------
   Bootstrap
   ------------------------------------------------------------------ */

export function initUI() {
  liveRegion = document.getElementById('live-region');
  toastRegion = document.getElementById('toast-region');

  document.addEventListener('keydown', handleOverlayKeydown, true);
}

/** Announce a message to assistive technology without moving focus. */
export function announce(message, { assertive = false } = {}) {
  if (!liveRegion || !message) return;
  liveRegion.setAttribute('aria-live', assertive ? 'assertive' : 'polite');
  // Clearing first makes repeated identical messages announce again. A task
  // (not a frame) separates the two writes, because a background tab still
  // runs timers but stops painting.
  liveRegion.textContent = '';
  setTimeout(() => {
    liveRegion.textContent = message;
  }, 0);
}

/* ------------------------------------------------------------------
   Focus handling
   ------------------------------------------------------------------ */

function focusableWithin(container) {
  return qsa(FOCUSABLE, container).filter(
    (node) => node.offsetParent !== null || node === document.activeElement,
  );
}

function handleOverlayKeydown(event) {
  const top = overlayStack.at(-1);
  if (!top) return;

  if (event.key === 'Escape') {
    event.stopPropagation();
    event.preventDefault();
    top.close(undefined);
    return;
  }

  if (event.key !== 'Tab') return;

  const focusable = focusableWithin(top.element);
  if (focusable.length === 0) {
    event.preventDefault();
    return;
  }

  const first = focusable[0];
  const last = focusable.at(-1);
  const active = document.activeElement;

  if (event.shiftKey && (active === first || !top.element.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

/**
 * Mount an overlay element, trap focus in it, and resolve when it closes.
 *
 * @param {(close: (result?: unknown) => void) => HTMLElement} render
 * @param {{ initialFocus?: (root: HTMLElement) => HTMLElement | null }} [options]
 * @returns {Promise<unknown>}
 */
export function openOverlay(render, { initialFocus } = {}) {
  return new Promise((resolve) => {
    const restoreTo = document.activeElement;
    let settled = false;

    const close = (result) => {
      if (settled) return;
      settled = true;

      const index = overlayStack.findIndex((entry) => entry.element === element);
      if (index >= 0) overlayStack.splice(index, 1);

      element.remove();
      if (restoreTo instanceof HTMLElement && document.contains(restoreTo)) {
        restoreTo.focus({ preventScroll: true });
      }
      resolve(result);
    };

    const element = render(close);
    document.body.append(element);
    overlayStack.push({ element, close, restoreTo });

    // The overlay is in the document already, so focus can move now. Waiting
    // for a frame would leave a keyboard user stranded outside the dialog if
    // the tab happens not to be painting.
    const target = initialFocus?.(element) ?? focusableWithin(element)[0] ?? element;
    target.focus({ preventScroll: true });
  });
}

export function closeAllOverlays() {
  while (overlayStack.length) {
    overlayStack.at(-1).close(undefined);
  }
}

export function hasOpenOverlay() {
  return overlayStack.length > 0;
}

/* ------------------------------------------------------------------
   Dialogs
   ------------------------------------------------------------------ */

let dialogSeq = 0;

function buildDialog(close, { title, body, actions, extra }) {
  const id = `dialog-${++dialogSeq}`;
  const panel = el(
    'div',
    {
      class: 'dialog__panel',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': `${id}-title`,
      'aria-describedby': body ? `${id}-body` : null,
    },
    [
      el('h2', { class: 'dialog__title', id: `${id}-title`, text: title }),
      body ? el('p', { class: 'dialog__body', id: `${id}-body`, text: body }) : null,
      extra ?? null,
      el('div', { class: 'dialog__actions' }, actions),
    ],
  );

  return el('div', { class: 'dialog' }, [
    el('div', { class: 'dialog__backdrop', onClick: () => close(undefined) }),
    panel,
  ]);
}

/**
 * Destructive confirmation. Resolves true only on explicit confirm.
 *
 * @param {{ title: string, body?: string, confirmLabel?: string,
 *   cancelLabel?: string, danger?: boolean }} options
 * @returns {Promise<boolean>}
 */
export async function confirmDialog({
  title,
  body,
  confirmLabel = t('common.confirm'),
  cancelLabel = t('common.cancel'),
  danger = false,
}) {
  const result = await openOverlay(
    (close) =>
      buildDialog(close, {
        title,
        body,
        actions: [
          el('button', {
            type: 'button',
            class: 'btn btn--outline',
            text: cancelLabel,
            onClick: () => close(false),
          }),
          el('button', {
            type: 'button',
            class: `btn ${danger ? 'btn--danger-solid' : 'btn--primary'}`,
            text: confirmLabel,
            onClick: () => close(true),
          }),
        ],
      }),
    // Focus lands on Cancel: a destructive action should never be one
    // stray Enter away.
    { initialFocus: (root) => root.querySelector('.btn--outline') },
  );

  return result === true;
}

/**
 * Single-field prompt with synchronous validation.
 *
 * @param {{ title: string, label: string, value?: string, placeholder?: string,
 *   confirmLabel?: string, maxLength?: number,
 *   validate?: (value: string) => string | null }} options
 * @returns {Promise<string | null>}
 */
export function promptDialog({
  title,
  label,
  value = '',
  placeholder = '',
  confirmLabel = t('common.save'),
  maxLength = 200,
  validate,
}) {
  return openOverlay(
    (close) => {
      const inputId = `prompt-${++dialogSeq}`;
      const errorId = `${inputId}-error`;

      const input = el('input', {
        class: 'input',
        id: inputId,
        type: 'text',
        value,
        placeholder,
        maxlength: String(maxLength),
        autocomplete: 'off',
        spellcheck: 'false',
      });

      const error = el('p', { class: 'field__error', id: errorId, role: 'alert', hidden: true });

      const submit = () => {
        const entered = input.value.trim();
        const message = validate?.(entered) ?? null;
        if (message) {
          error.textContent = message;
          error.hidden = false;
          input.setAttribute('aria-invalid', 'true');
          input.setAttribute('aria-describedby', errorId);
          input.focus();
          return;
        }
        close(entered);
      };

      input.addEventListener('input', () => {
        error.hidden = true;
        input.removeAttribute('aria-invalid');
      });
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          submit();
        }
      });

      const field = el('div', { class: 'field' }, [
        el('label', { class: 'field__label', for: inputId, text: label }),
        input,
        error,
      ]);

      return buildDialog(close, {
        title,
        extra: field,
        actions: [
          el('button', {
            type: 'button',
            class: 'btn btn--outline',
            text: t('common.cancel'),
            onClick: () => close(null),
          }),
          el('button', {
            type: 'button',
            class: 'btn btn--primary',
            text: confirmLabel,
            onClick: submit,
          }),
        ],
      });
    },
    { initialFocus: (root) => root.querySelector('input') },
  ).then((result) => (typeof result === 'string' ? result : null));
}

/* ------------------------------------------------------------------
   Popup menus
   ------------------------------------------------------------------ */

/**
 * @typedef {object} MenuItem
 * @property {string} label
 * @property {string} [icon]
 * @property {boolean} [checked]
 * @property {boolean} [danger]
 * @property {boolean} [separator]
 * @property {() => void} [onSelect]
 */

/**
 * Anchored menu with roving keyboard focus.
 * @param {HTMLElement} anchor
 * @param {MenuItem[]} items
 */
export function openMenu(anchor, items) {
  anchor.setAttribute('aria-expanded', 'true');

  return openOverlay(
    (close) => {
      const groups = [];
      let currentGroup = [];

      for (const item of items) {
        if (item.separator) {
          if (currentGroup.length) groups.push(currentGroup);
          currentGroup = [];
          continue;
        }
        currentGroup.push(
          el(
            'button',
            {
              type: 'button',
              class: `menu__item${item.danger ? ' menu__item--danger' : ''}`,
              role: item.checked === undefined ? 'menuitem' : 'menuitemradio',
              'aria-checked': item.checked === undefined ? null : String(item.checked),
              onClick: () => {
                close(undefined);
                item.onSelect?.();
              },
            },
            [
              item.icon ? icon(item.icon) : null,
              el('span', { class: 'menu__label', text: item.label }),
              item.checked ? icon('check', { size: 'sm' }) : null,
            ],
          ),
        );
      }
      if (currentGroup.length) groups.push(currentGroup);

      const menu = el(
        'div',
        { class: 'menu', role: 'menu' },
        groups.map((group) => el('div', { class: 'menu__group' }, group)),
      );

      menu.addEventListener('keydown', (event) => {
        const options = qsa('.menu__item', menu);
        const index = options.indexOf(document.activeElement);
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          options[(index + 1) % options.length]?.focus();
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          options[(index - 1 + options.length) % options.length]?.focus();
        } else if (event.key === 'Home') {
          event.preventDefault();
          options[0]?.focus();
        } else if (event.key === 'End') {
          event.preventDefault();
          options.at(-1)?.focus();
        }
      });

      const root = el('div', {}, [
        el('div', {
          class: 'dialog__backdrop',
          style: { position: 'fixed', inset: '0', background: 'transparent' },
          onClick: () => close(undefined),
        }),
        menu,
      ]);

      // Measured after `openOverlay` appends the root, on the next task.
      setTimeout(() => positionMenu(menu, anchor), 0);
      return root;
    },
    { initialFocus: (root) => root.querySelector('.menu__item') },
  ).finally(() => anchor.setAttribute('aria-expanded', 'false'));
}

function positionMenu(menu, anchor) {
  const rect = anchor.getBoundingClientRect();
  const { width, height } = menu.getBoundingClientRect();
  const margin = 8;

  let left = rect.left;
  if (left + width > window.innerWidth - margin) left = rect.right - width;
  left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));

  let top = rect.bottom + 4;
  if (top + height > window.innerHeight - margin) top = rect.top - height - 4;
  top = Math.max(margin, top);

  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
}

/* ------------------------------------------------------------------
   Toasts
   ------------------------------------------------------------------ */

const TOAST_ICONS = { info: 'info', success: 'check-circle', error: 'alert' };

/**
 * Transient feedback. Reserved for things the user cannot see for
 * themselves, or that they may want to undo.
 *
 * @param {string} message
 * @param {{ variant?: 'info'|'success'|'error', action?: { label: string,
 *   onSelect: () => void }, duration?: number }} [options]
 */
export function toast(message, { variant = 'info', action, duration } = {}) {
  if (!toastRegion) return;

  const life = duration ?? (action ? TIMING.toastDuration + 2000 : TIMING.toastDuration);
  let timer = null;

  const node = el('div', { class: `toast toast--${variant}` }, [
    icon(TOAST_ICONS[variant] ?? 'info', { className: 'toast__icon' }),
    el('span', { class: 'toast__message', text: message }),
    action
      ? el('button', {
          type: 'button',
          class: 'toast__action',
          text: action.label,
          onClick: () => {
            dismiss();
            action.onSelect();
          },
        })
      : null,
    el(
      'button',
      {
        type: 'button',
        class: 'icon-btn',
        'aria-label': t('common.dismiss'),
        onClick: () => dismiss(),
      },
      [icon('close', { size: 'sm' })],
    ),
  ]);

  function dismiss() {
    if (timer) clearTimeout(timer);
    node.classList.add('toast--leaving');
    node.addEventListener('animationend', () => node.remove(), { once: true });
    // Belt and braces: reduced-motion users get no animationend event.
    setTimeout(() => node.remove(), 400);
  }

  // Hovering or focusing a toast pauses its countdown.
  node.addEventListener('pointerenter', () => timer && clearTimeout(timer));
  node.addEventListener('pointerleave', () => {
    timer = setTimeout(dismiss, 1500);
  });

  toastRegion.append(node);
  announce(message);
  timer = setTimeout(dismiss, life);

  return dismiss;
}
