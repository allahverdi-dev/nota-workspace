/**
 * First-run screen. Shown once, then never again unless local data is
 * cleared. It exists to answer one question — where do my notes live? —
 * before the user has typed anything they could lose.
 */

import { t } from '../i18n.js';
import { el, icon } from '../utils.js';
import { openOverlay } from '../ui.js';

/**
 * @returns {Promise<'start' | 'import'>} what the user chose
 */
export function showOnboarding() {
  return openOverlay(
    (close) =>
      el('div', { class: 'onboarding', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'onboarding-title' }, [
        el('div', { class: 'onboarding__panel' }, [
          brandMark(),
          el('h1', { class: 'onboarding__title', id: 'onboarding-title', text: t('onboarding.title') }),
          el('p', { class: 'onboarding__lede', text: t('onboarding.lede') }),

          el('div', { class: 'onboarding__points' }, [
            point('device', 'onboarding.point1'),
            point('user-off', 'onboarding.point2'),
            point('download', 'onboarding.point3'),
          ]),

          el('div', { class: 'onboarding__actions' }, [
            el('button', {
              type: 'button',
              class: 'btn btn--primary btn--lg',
              text: t('onboarding.start'),
              onClick: () => close('start'),
            }),
            el('button', {
              type: 'button',
              class: 'btn btn--outline btn--lg',
              text: t('onboarding.import'),
              onClick: () => close('import'),
            }),
          ]),

          el('p', { class: 'onboarding__note', text: t('onboarding.note') }),
        ]),
      ]),
    { initialFocus: (root) => root.querySelector('.btn--primary') },
  ).then((result) => (result === 'import' ? 'import' : 'start'));
}

function point(iconName, key) {
  return el('div', { class: 'onboarding__point' }, [
    icon(iconName),
    el('div', {}, [
      el('strong', { text: t(`${key}.title`) }),
      el('span', { text: t(`${key}.body`) }),
    ]),
  ]);
}

/** The wordmark, drawn rather than loaded, so it inherits the theme. */
function brandMark() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'onboarding__mark');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');

  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', '#i-brand');
  svg.append(use);
  return svg;
}
