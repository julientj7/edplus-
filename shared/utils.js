'use strict';
/**
 * shared/utils.js
 * ---------------
 * Utilitaires purs, sans accès au DOM ni à l'API navigateur : ils sont utilisés
 * aussi bien par le content script que par le popup, et surtout par
 * `scripts/self-check.mjs` qui les vérifie hors navigateur.
 *
 * Le cœur du fichier est l'analyse des notes françaises telles qu'École Directe
 * les écrit dans le DOM : « 15,5/20 », « 12 /10 », « 18 », « Absent »,
 * « Non significative », « 7,5/20 (hors moyenne) ».
 */
(() => {
  const EDP = globalThis.EDP;
  const { GRADE_STATUS } = EDP;

  /**
   * Convertit un texte en nombre à la française (« 1 234,56 » -> 1234.56).
   * Renvoie null si aucune valeur numérique n'est exploitable.
   */
  function parseNumber(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const cleaned = String(value)
      .replace(/\u00a0/g, ' ')   // espaces insécables des milliers
      .replace(/\s/g, '')
      .replace(',', '.')
      .replace(/[^0-9.\-]/g, '');
    if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
    const parsed = Number.parseFloat(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }

  /**
   * Analyse un libellé de note et renvoie sa valeur, son barème et son statut.
   * C'est LA fonction qui décide si une note est utilisable dans un calcul.
   *
   * @param {string} text   texte brut, ex. « 15,5/20 », « Non significative »
   * @param {number} defaultScale barème supposé quand le texte ne le précise pas
   * @returns {{ value: number|null, outOf: number, status: string, raw: string }}
   */
  function parseGradeText(text, defaultScale = 20) {
    const raw = String(text === null || text === undefined ? '' : text).trim();

    // Notation absente, non rendue, ou colonne vide (tiret, pointillés…).
    if (raw === '' || /^[-–—.]+$/.test(raw)) {
      return { value: null, outOf: defaultScale, status: GRADE_STATUS.ABSENT, raw };
    }
    if (/\babsent\b|\babs\.?\b|\bnon\s*not[ée]\b/i.test(raw)) {
      return { value: null, outOf: defaultScale, status: GRADE_STATUS.ABSENT, raw };
    }
    // « Non significative » : affichée par le site mais exclue de la moyenne.
    if (/non\s*significatif|non\s*significative|\bN\.?\s*S\.?\b/i.test(raw)) {
      return { value: null, outOf: defaultScale, status: GRADE_STATUS.NON_SIGNIFICANT, raw };
    }
    // « hors moyenne », « ne compte pas » : note éliminée du calcul.
    const notCounted = /hors\s*moyenne|ne\s*compte\s*pas|non\s*compt[ée]/i.test(raw);

    // Barème explicite : on prend le dernier « /nombre » de la chaîne, ce qui
    // gère aussi « 8/10 sur 20 points ». Sinon, barème par défaut.
    let outOf = defaultScale;
    const scaleMatch = raw.match(/\/\s*(\d+(?:[.,]\d+)?)/g);
    if (scaleMatch && scaleMatch.length) {
      const last = parseNumber(scaleMatch[scaleMatch.length - 1]);
      if (last !== null && last > 0) outOf = last;
    }

    // Valeur : le premier nombre de la chaîne (avant le « / », s'il existe).
    const beforeScale = raw.split('/')[0];
    const value = parseNumber(beforeScale);

    if (value === null) {
      return { value: null, outOf, status: GRADE_STATUS.ABSENT, raw };
    }
    return {
      value,
      outOf,
      status: notCounted ? GRADE_STATUS.NOT_COUNTED : GRADE_STATUS.COUNTED,
      raw
    };
  }

  /** Ramène une note à /20 en conservant les autres barèmes (10, 40…). */
  function toOutOf20(value, outOf) {
    if (value === null || !Number.isFinite(value) || !outOf) return null;
    return (value / outOf) * 20;
  }

  /** Arrondi à 2 décimales, sans les erreurs binaires du type 12.344999999. */
  function round2(value) {
    if (value === null || value === undefined || !Number.isFinite(value)) return null;
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  /** Formatage français : « 12,34 ». */
  function formatFr(value, digits = 2) {
    if (value === null || value === undefined || !Number.isFinite(value)) return '—';
    return value.toLocaleString('fr-FR', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }

  /** Signe explicite pour les écarts : « +0,35 » / « -0,20 ». */
  function formatDelta(value, digits = 2) {
    if (value === null || value === undefined || !Number.isFinite(value)) return '—';
    const sign = value > 0 ? '+' : value < 0 ? '−' : '±';
    return `${sign}${formatFr(Math.abs(value), digits)}`;
  }

  /** Décale un appel de fonction : indispensable sur MutationObserver. */
  function debounce(fn, delay = 200) {
    let timer = null;
    return function debounced(...args) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fn.apply(this, args);
      }, delay);
    };
  }

  /** Analyse une date « jj/mm/aaaa » (format des devoirs et des notes). */
  function parseDateFr(text) {
    if (!text) return null;
    const match = String(text).match(/(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})/);
    if (!match) return null;
    const day = Number(match[1]);
    const month = Number(match[2]) - 1;
    const rawYear = Number(match[3]);
    const year = rawYear < 100 ? 2000 + rawYear : rawYear;
    const date = new Date(year, month, day);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  /** Date sans heure, pour comparer des échéances. */
  function startOfDay(date = new Date()) {
    const copy = new Date(date);
    copy.setHours(0, 0, 0, 0);
    return copy;
  }

  /** Nombre de jours entiers entre deux dates (négatif = passé). */
  function daysUntil(date, from = new Date()) {
    if (!date) return null;
    const ms = startOfDay(date).getTime() - startOfDay(from).getTime();
    return Math.round(ms / 86_400_000);
  }

  /**
   * Empreinte stable et courte d'une chaîne. Sert à repérer les notes déjà vues
   * (pastille « nouvelle note ») sans stocker la note elle-même.
   */
  function fingerprint(str) {
    let hash = 0x811c9dc5;
    const text = String(str);
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(36);
  }

  /** Normalise un nom de matière pour les comparaisons et les surcharges. */
  function normalizeLabel(label) {
    return String(label || '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  EDP.utils = {
    parseNumber,
    parseGradeText,
    toOutOf20,
    round2,
    formatFr,
    formatDelta,
    debounce,
    parseDateFr,
    startOfDay,
    daysUntil,
    fingerprint,
    normalizeLabel
  };
})();
