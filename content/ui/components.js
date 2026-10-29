'use strict';
/**
 * content/ui/components.js
 * -----------------------
 * Petite bibliothèque de composants, construite uniquement avec
 * `document.createElement` et `textContent`.
 *
 * Règle de sécurité du projet : JAMAIS d'innerHTML avec une donnée venue du
 * site. Les libellés de devoirs, noms de matières et salles viennent de la page
 * de l'utilisateur — et même si le contenu est légitime, une injection par
 * innerHTML est exactement le genre de chose qui fait recaler une revue AMO.
 *
 * Toutes les classes sont préfixées `edp-` et stylées depuis le Shadow DOM
 * (`styles/components/panel.css`).
 */
(() => {
  const EDP = globalThis.EDP;
  const { formatFr, formatDelta } = EDP.utils;

  /** Création générique d'un élément. `children` accepte nœuds et chaînes. */
  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    Object.entries(props).forEach(([key, value]) => {
      if (value === null || value === undefined || value === false) return;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = String(value);
      else if (key === 'dataset') Object.assign(node.dataset, value);
      else if (key.startsWith('on') && typeof value === 'function') {
        node.addEventListener(key.slice(2).toLowerCase(), value);
      } else node.setAttribute(key, String(value));
    });
    (Array.isArray(children) ? children : [children]).forEach((child) => {
      if (child === null || child === undefined || child === false) return;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    });
    return node;
  }

  /** Carte : conteneur principal de chaque fonctionnalité. */
  function card({ title, hint = null, actions = [] } = {}) {
    const actionsRow = el('div', { class: 'edp-card__actions' }, actions);
    const body = el('div', { class: 'edp-card__body' });
    const header = el('div', { class: 'edp-card__header' }, [
      el('div', { class: 'edp-card__titles' }, [
        title ? el('h3', { class: 'edp-card__title', text: title }) : null,
        hint ? el('p', { class: 'edp-card__hint', text: hint }) : null
      ]),
      actions.length ? actionsRow : null
    ]);
    const root = el('section', { class: 'edp-card' }, [header, body]);
    return { root, body, actions: actionsRow };
  }

  /** Chiffre mis en avant (moyenne générale, écart…). */
  function stat({ label, value, hint = null, tone = 'neutral' } = {}) {
    return el('div', { class: `edp-stat edp-tone-${tone}` }, [
      el('span', { class: 'edp-stat__label', text: label }),
      el('strong', { class: 'edp-stat__value', text: value }),
      hint ? el('span', { class: 'edp-stat__hint', text: hint }) : null
    ]);
  }

  /** Ligne d'alignement horizontal. */
  function row(children, { class: className = 'edp-row' } = {}) {
    return el('div', { class: className }, children);
  }

  /** Pastille d'état. */
  function badge(text, tone = 'neutral') {
    return el('span', { class: `edp-badge edp-tone-${tone}`, text });
  }

  function button(label, onClick, { variant = 'default', title = null } = {}) {
    return el(
      'button',
      {
        class: `edp-button edp-button--${variant}`,
        type: 'button',
        title,
        onclick: onClick
      },
      [label]
    );
  }

  /** Ton d'un écart : vert au-dessus, rouge en dessous. */
  function toneForDelta(value) {
    if (!Number.isFinite(value)) return 'neutral';
    if (value > 0) return 'positive';
    if (value < 0) return 'negative';
    return 'neutral';
  }

  function delta(value, { digits = 2, label = null } = {}) {
    const tone = toneForDelta(value);
    return el('span', { class: `edp-delta edp-tone-${tone}`, text: `${label ? `${label} ` : ''}${formatDelta(value, digits)}` });
  }

  /** Tableau : `head` = libellés, `rows` = tableau de tableaux (nœuds acceptés). */
  function table({ head = [], rows = [], caption = null } = {}) {
    const thead = head.length
      ? el('thead', {}, [el('tr', {}, head.map((cell) => el('th', { text: cell })))])
      : null;
    const tbody = el(
      'tbody',
      {},
      rows.map((cells) =>
        el('tr', {}, cells.map((cell) => el('td', {}, [cell])))
      )
    );
    return el('table', { class: 'edp-table' }, [caption ? el('caption', { text: caption }) : null, thead, tbody]);
  }

  /** Libellé + champ, empilés verticalement. */
  function field({ label, control, hint = null } = {}) {
    return el('label', { class: 'edp-field' }, [
      el('span', { class: 'edp-field__label', text: label }),
      control,
      hint ? el('span', { class: 'edp-field__hint', text: hint }) : null
    ]);
  }

  function select({ label, options = [], value = null, onChange, hint = null } = {}) {
    const control = el(
      'select',
      { class: 'edp-input', onchange: (event) => onChange(event.target.value) },
      options.map((option) =>
        el('option', { value: option.value, selected: String(option.value) === String(value) }, [option.label])
      )
    );
    return field({ label, control, hint });
  }

  function numberInput({ label, value = '', min = null, max = null, step = '0.5', onInput, hint = null } = {}) {
    const control = el('input', {
      class: 'edp-input',
      type: 'number',
      inputmode: 'decimal',
      value: value === null || value === undefined ? '' : String(value),
      min,
      max,
      step,
      oninput: (event) => onInput(event.target.value)
    });
    return field({ label, control, hint });
  }

  /** Bloc repliable : sert à expliquer un calcul sans encombrer l'écran. */
  function details(summary, children) {
    return el('details', { class: 'edp-details' }, [
      el('summary', { class: 'edp-details__summary', text: summary }),
      el('div', { class: 'edp-details__body' }, children)
    ]);
  }

  function note(text, tone = 'neutral') {
    return el('p', { class: `edp-note edp-tone-${tone}`, text });
  }

  function muted(text) {
    return el('p', { class: 'edp-muted', text });
  }

  function list(items, { class: className = 'edp-list' } = {}) {
    return el('ul', { class: className }, (items || []).map((item) => el('li', {}, [item])));
  }

  /** Note affichée « 15,5/20 » (valeur brute + barème), format français. */
  function gradeLabel(grade) {
    if (!grade || grade.value === null) return '—';
    return `${formatFr(grade.value, Number.isInteger(grade.value) ? 0 : 1)}/${formatFr(grade.outOf, 0)}`;
  }

  EDP.ui = EDP.ui || {};
  Object.assign(EDP.ui, {
    el,
    card,
    stat,
    row,
    badge,
    button,
    delta,
    toneForDelta,
    table,
    field,
    select,
    numberInput,
    details,
    note,
    muted,
    list,
    gradeLabel
  });
})();
