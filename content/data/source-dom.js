'use strict';
/**
 * content/data/source-dom.js
 * --------------------------
 * ⚠️  C'EST LE SEUL FICHIER À ADAPTER QUAND LE SITE CHANGE. ⚠️
 *
 * Il lit les données déjà affichées dans la page connectée de l'utilisateur :
 * aucune requête réseau, aucun identifiant, aucun jeton. C'est ce qui rend la
 * v1.0 simple et sûre — et fragile au moindre changement de balisage. D'où la
 * règle du projet : tout le couplage au site est concentré ici.
 *
 * Méthode, parce que le balisage réel d'École Directe n'est pas public :
 *   1. on ne cherche pas un sélecteur magique, on CHERCHE DES TABLEAUX DE NOTES
 *      (une ligne contenant « 15,5/20 » ou « Non significative ») ;
 *   2. on lit le tableau par ses EN-TÊTES (Date / Note / Coefficient / Moyenne
 *      de la classe) plutôt que par des positions fixes ;
 *   3. chaque ligne est analysée dans un try/catch : une ligne bizarre est
 *      ignorée avec un avertissement, elle ne fait jamais échouer le reste ;
 *   4. `debug()` imprime ce qui a été trouvé pour calibrer en 2 minutes.
 *
 * Voir le README, section « Calibrer la lecture du site ».
 */
(() => {
  const EDP = globalThis.EDP;
  const { GRADE_STATUS } = EDP;
  const { $, $$, text, cellTexts, attr, attrBag } = EDP.dom;
  const { parseGradeText, parseNumber, parseDateFr, round2, normalizeLabel } = EDP.utils;

  /** Sélecteurs candidats — c'est ici qu'on ajuste si un conteneur est manqué. */
  const SELECTORS = {
    notesContainers: ['#notes', '#divNotes', '[id*="note" i]', '[class*="note" i]', '.notes'],
    notesHeading: 'caption, legend, h1, h2, h3, h4, h5, [class*="matiere" i], [class*="subject" i]',
    periodLabel: '#periode, select[name*="periode" i], [class*="periode" i], [class*="trimestre" i]',
    timetableRoots: ['#emploiDuTemps', '#edt', '[id*="emploi" i]', '[class*="emploi" i]', '[class*="timetable" i]'],
    timetableRows: 'table tbody tr, table tr',
    homeworkRoots: ['#cahierDeTexte', '#cdt', '[id*="cahier" i]', '[class*="cahier" i]', '[class*="devoir" i]'],
    homeworkRows: 'table tbody tr, li, .devoir, [class*="devoir" i]'
  };

  /** Une note ressemble à « 12/20 », « 7,5 /10 », « Non significative », « Absent ». */
  const GRADE_TOKEN = /(\d{1,3}(?:[.,]\d+)?)\s*\/\s*(\d{1,3}(?:[.,]\d+)?)/;
  const NO_GRADE_TOKEN = /non\s*significat|absent|\babs\b|hors\s*moyenne/i;

  /** Valeurs d'en-tête reconnues (l'ordre compte : du plus spécifique au plus général). */
  const HEADER_RULES = [
    ['coefficient', /coef/],
    ['date', /date/],
    ['classAverage', /moy/],
    ['min', /\bmin/],
    ['max', /\bmax/],
    ['grade', /note|moyenne|moy\.|résultat|resultat|élève|eleve|obtenu/],
    ['label', /devoir|intitul|libell|contenu|évaluation|evaluation|nature|matière|matiere|appréciation/]
  ];

  /** Cache court : le routeur interroge les marqueurs à chaque mutation groupée. */
  let cache = { at: 0, tables: null };

  // ---------------------------------------------------------------------------
  // Détection des tableaux de notes
  // ---------------------------------------------------------------------------

  function isGradeCell(value) {
    const raw = normalizeLabel(value);
    if (!raw) return false;
    return GRADE_TOKEN.test(raw) || NO_GRADE_TOKEN.test(raw);
  }

  /** Une ligne de notes : au moins deux cellules et une cellule « note ». */
  function isGradeRow(cells) {
    if (!cells || cells.length < 2) return false;
    return cells.some(isGradeCell);
  }

  /** Ligne de synthèse (« Moyenne de la matière », « Total ») : à ignorer. */
  function isSummaryRow(cells) {
    if (!cells || !cells.length) return false;
    const joined = cells.join(' ').toLowerCase();
    if (!/moyenne|total|moy\./.test(joined)) return false;
    return !cells.some((cell) => parseDateFr(cell));
  }

  /** Tous les tableaux contenant au moins une ligne de notes. */
  function gradeTables() {
    if (cache.tables && Date.now() - cache.at < 1500) return cache.tables;
    const found = [];
    $$('table').forEach((table) => {
      try {
        const rows = $$('tr', table).filter((row) => {
          const cells = cellTexts(row);
          return isGradeRow(cells) && !isSummaryRow(cells);
        });
        if (rows.length) found.push({ table, rows });
      } catch (error) {
        /* tableau illisible : on passe au suivant */
      }
    });
    cache = { at: Date.now(), tables: found };
    return found;
  }

  /** En-têtes du tableau : ligne thead, sinon première ligne sans note. */
  function headerMap(table) {
    let cells = $$('thead tr:last-child th, thead tr:last-child td', table).map(text);
    if (!cells.length) {
      const firstRow = $('tr', table);
      if (firstRow) {
        const candidate = cellTexts(firstRow);
        if (!candidate.some(isGradeCell)) cells = candidate;
      }
    }
    const index = {};
    cells.forEach((value, position) => {
      const label = normalizeLabel(value).toLowerCase();
      if (!label) return;
      for (const [key, pattern] of HEADER_RULES) {
        // « Moyenne de la classe » ne doit pas être confondu avec « Moyenne ».
        if (key === 'classAverage' && !/classe|groupe/.test(label)) continue;
        if (key === 'grade' && /generale|générale|classe/.test(label)) continue;
        if (pattern.test(label)) {
          if (index[key] === undefined) index[key] = position;
          return;
        }
      }
    });
    return { cells, index };
  }

  /**
   * Matière du tableau : d'abord un titre interne (caption, legend, h*),
   * sinon le plus proche ancêtre qui ne contient QUE ce tableau.
   * On s'arrête avant d'atteindre le titre de la page.
   */
  function subjectForTable(table) {
    const inner = $(SELECTORS.notesHeading, table);
    const innerText = normalizeLabel(text(inner));
    if (innerText) return innerText;

    const explicit = normalizeLabel(attr(table, 'data-matiere') || attr(table, 'data-subject'));
    if (explicit) return explicit;

    let node = table.parentElement;
    let depth = 0;
    while (node && depth < 6) {
      if (node.tagName === 'BODY' || node.tagName === 'HTML') break;
      // Plus d'un tableau dans ce conteneur : on est déjà remonté trop haut.
      if ($$('table', node).length > 1) break;
      const heading = $(SELECTORS.notesHeading, node);
      const headingText = normalizeLabel(text(heading));
      if (headingText && !GRADE_TOKEN.test(headingText)) return headingText;
      node = node.parentElement;
      depth += 1;
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Analyse d'une ligne de notes
  // ---------------------------------------------------------------------------

  /** Choisit la cellule qui porte la note : en-tête d'abord, contenu ensuite. */
  function gradeCellIndex(cells, headers) {
    const hinted = headers.index.grade;
    if (hinted !== undefined && isGradeCell(cells[hinted])) return hinted;
    const found = cells.findIndex(isGradeCell);
    return found === -1 ? null : found;
  }

  function labelFromCells(cells, excludeIndexes) {
    let best = '';
    cells.forEach((value, position) => {
      if (excludeIndexes.includes(position)) return;
      const candidate = normalizeLabel(value);
      if (!candidate || GRADE_TOKEN.test(candidate)) return;
      if (candidate.length > best.length) best = candidate;
    });
    return best;
  }

  function coefficientFromCells(cells, headers) {
    const hinted = headers.index.coefficient;
    if (hinted !== undefined) {
      const value = parseNumber(cells[hinted]);
      if (value !== null && value > 0 && value <= 50) return value;
    }
    // Repli : un en-tête peut manquer, on cherche « coef 2 » dans la ligne.
    for (const cell of cells) {
      const match = normalizeLabel(cell).match(/coef\w*\s*:?\s*(\d+(?:[.,]\d+)?)/i);
      if (match) {
        const value = parseNumber(match[1]);
        if (value !== null && value > 0 && value <= 50) return value;
      }
    }
    return 1;
  }

  function numberAt(cells, index, defaultScale) {
    if (index === undefined || index === null) return null;
    const parsed = parseGradeText(cells[index], defaultScale);
    if (parsed.value === null) return null;
    return round2((parsed.value / parsed.outOf) * 20);
  }

  /**
   * Transforme une ligne en enregistrement brut exploitable par le modèle.
   * @returns {object|null} null si la ligne ne porte aucune note exploitable
   */
  function extractRow(row, headers, subject) {
    const cells = cellTexts(row);
    if (!isGradeRow(cells) || isSummaryRow(cells)) return null;

    const used = [];
    const gradeIndex = gradeCellIndex(cells, headers);
    if (gradeIndex === null) return null;
    used.push(gradeIndex);

    const gradeText = cells[gradeIndex];
    // Barème : celui des en-têtes (« Note /20 ») sert de repli.
    const headerScaleText = headers.cells.join(' / ');
    const headerScale = parseNumber((headerScaleText.match(/\/\s*(\d{1,3})/) || [])[1]) || 20;
    const parsed = parseGradeText(gradeText, headerScale);

    const dateIndex = headers.index.date;
    const date = dateIndex !== undefined ? parseDateFr(cells[dateIndex]) : parseDateFr(cells.join(' '));
    if (dateIndex !== undefined) used.push(dateIndex);

    const labelIndex = headers.index.label;
    if (labelIndex !== undefined && cells[labelIndex]) used.push(labelIndex);

    const label = labelFromCells(cells, used);

    let status = parsed.status;
    if (/hors\s*moyenne|ne\s*compte\s*pas/i.test(cells.join(' '))) {
      status = GRADE_STATUS.NOT_COUNTED;
    }

    return {
      subject: subject || 'Matière non identifiée',
      label: label || normalizeLabel(gradeText) || 'Évaluation',
      value: parsed.value,
      outOf: parsed.outOf,
      coefficient: coefficientFromCells(cells, headers),
      date,
      status,
      classAverage: numberAt(cells, headers.index.classAverage, headerScale),
      classMin: numberAt(cells, headers.index.min, headerScale),
      classMax: numberAt(cells, headers.index.max, headerScale),
      source: 'dom',
      rawText: cells.join(' | ').slice(0, 240)
    };
  }

  /** Période affichée (trimestre / semestre), si le site en montre une. */
  function detectPeriod() {
    const node = $(SELECTORS.periodLabel);
    if (!node) return null;
    const selected = node.tagName === 'SELECT' ? node.options[node.selectedIndex] : null;
    const value = normalizeLabel((selected && selected.textContent) || text(node));
    return value && value.length <= 40 ? value : null;
  }

  // ---------------------------------------------------------------------------
  // Emploi du temps et devoirs (mêmes principes, données plus légères)
  // ---------------------------------------------------------------------------

  /** « 08:30 - 09:25 », « 8h30-9h25 » -> minutes depuis minuit. */
  function parseTimeRange(value) {
    const matches = String(value || '').match(/(\d{1,2})\s*[h:]\s*(\d{2})/g);
    if (!matches || matches.length < 2) return null;
    const toMinutes = (raw) => {
      const parts = raw.match(/(\d{1,2})\s*[h:]\s*(\d{2})/);
      return Number(parts[1]) * 60 + Number(parts[2]);
    };
    const start = toMinutes(matches[0]);
    const end = toMinutes(matches[matches.length - 1]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
    return { start, end };
  }

  /** Lignes de l'emploi du temps, enrichies (horaire, matière, salle). */
  function timetableRows() {
    const roots = SELECTORS.timetableRoots.map((selector) => $(selector)).filter(Boolean);
    const scope = roots[0] || document;
    const rows = $$(SELECTORS.timetableRows, scope).filter((row) => !$$('tr', row).length);
    return rows
      .map((row) => {
        try {
          const cells = cellTexts(row);
          if (cells.length < 2) return null;
          const timeText = cells.find((cell) => parseTimeRange(cell));
          const range = timeText ? parseTimeRange(timeText) : null;
          if (!range) return null;
          const roomCell = cells.find((cell) => /salle|s[0-9]|b[0-9]|amphi/i.test(cell) && !parseDateFr(cell));
          const subject = cells.find(
            (cell) => cell !== timeText && cell.length > 2 && !/salle|prof|absent|annul/i.test(cell)
          );
          return {
            row,
            timeText,
            start: range.start,
            end: range.end,
            subject: normalizeLabel(subject) || 'Cours',
            room: normalizeLabel(roomCell) || '',
            cancelled: /annul|absent|pas de cours/i.test(cells.join(' '))
          };
        } catch (error) {
          return null;
        }
      })
      .filter(Boolean);
  }

  /** Date affichée juste avant une ligne de devoir (souvent un titre de jour). */
  function precedingDate(row) {
    let node = row.previousElementSibling || (row.parentElement && row.parentElement.previousElementSibling);
    let hops = 0;
    while (node && hops < 5) {
      const attrs = attrBag(node);
      const dataDate = (attrs.match(/(?:data-)?date="([^"]+)"/i) || [])[1];
      const parsed = parseDateFr(dataDate) || parseDateFr(text(node));
      if (parsed) return parsed;
      node = node.previousElementSibling;
      hops += 1;
    }
    return null;
  }

  /** Lignes du cahier de textes, enrichies (échéance, matière, état « fait »). */
  function homeworkRows() {
    const roots = SELECTORS.homeworkRoots.map((selector) => $(selector)).filter(Boolean);
    const scope = roots[0] || document;
    const rows = $$(SELECTORS.homeworkRows, scope).filter((row) => !$$('tr', row).length);
    return rows
      .map((row) => {
        try {
          const cells = cellTexts(row);
          const blob = cells.length ? cells.join(' | ') : normalizeLabel(text(row));
          if (!blob || blob.length < 4) return null;
          const ownDate = cells.map(parseDateFr).find(Boolean);
          const due = ownDate || precedingDate(row) || null;
          const subject = cells.find((cell) => cell.length > 2 && !parseDateFr(cell) && cell.length < 40) || '';
          const checkbox = $('input[type="checkbox"]', row);
          const done =
            (checkbox && checkbox.checked) ||
            /fait|termin|rendu|fait\b/i.test(attrBag(row)) ||
            /fait|termin|rendu/i.test(blob);
          return {
            row,
            due,
            subject: normalizeLabel(subject) || 'Devoir',
            label: normalizeLabel(blob).slice(0, 160),
            done: Boolean(done)
          };
        } catch (error) {
          return null;
        }
      })
      .filter((entry) => entry && entry.label);
  }

  // ---------------------------------------------------------------------------
  // Interface de source
  // ---------------------------------------------------------------------------

  /** La page contient-elle des notes lisibles ? */
  function available() {
    return gradeTables().length > 0;
  }

  /** Lecture complète : renvoie des enregistrements BRUTS (modèle à part). */
  async function read() {
    const tables = gradeTables();
    const warnings = [];
    const grades = [];
    let unidentifiedSubjects = 0;

    tables.forEach(({ table, rows }) => {
      const headers = headerMap(table);
      const subject = subjectForTable(table);
      if (!subject) unidentifiedSubjects += 1;

      rows.forEach((row) => {
        try {
          const record = extractRow(row, headers, subject);
          if (record) grades.push(record);
        } catch (error) {
          warnings.push(`Ligne ignorée (${String(error.message || error).slice(0, 60)}).`);
        }
      });
    });

    if (unidentifiedSubjects) {
      warnings.push(
        `${unidentifiedSubjects} tableau(x) sans matière identifiée : ajoutez le sélecteur manquant dans SELECTORS.notesHeading.`
      );
    }
    if (!grades.length) {
      warnings.push('Aucune note lue : le balisage du site a peut-être changé (voir EDP.debug()).');
    }

    return { grades, period: detectPeriod(), warnings };
  }

  /**
   * Diagnostic à lancer dans la console de la page : il dit précisément ce que
   * la lecture a trouvé, ce qu'elle a raté, et où ajuster les sélecteurs.
   */
  function debug() {
    const tables = gradeTables();
    const report = {
      available: available(),
      period: detectPeriod(),
      tables: tables.length,
      rows: tables.reduce((total, entry) => total + entry.rows.length, 0)
    };
    console.groupCollapsed('[ED+] lecture du site (source-dom)');
    console.log('résumé :', report);
    console.table(
      tables.map(({ table, rows }, position) => ({
        '#': position,
        id: attr(table, 'id') || '(sans id)',
        classes: attr(table, 'class').slice(0, 60) || '(sans classe)',
        matière: subjectForTable(table) || '⚠️ non identifiée',
        entêtes: headerMap(table).cells.join(' | ').slice(0, 120),
        lignes: rows.length,
        exemple: rows[0] ? cellTexts(rows[0]).join(' | ').slice(0, 120) : ''
      }))
    );
    console.log('marqueurs de route :', MARKERS);
    console.log('sélecteurs ajustables :', SELECTORS);
    console.groupEnd();
    return report;
  }

  // ---------------------------------------------------------------------------
  // Marqueurs de route (utilisés par content/core/router.js)
  // ---------------------------------------------------------------------------

  const MARKERS = [
    { route: EDP.ROUTES.NOTES, selector: '#notes' },
    { route: EDP.ROUTES.NOTES, test: () => gradeTables().length > 0 },
    { route: EDP.ROUTES.TIMETABLE, selector: '#emploiDuTemps' },
    { route: EDP.ROUTES.TIMETABLE, test: () => timetableRows().length > 3 },
    { route: EDP.ROUTES.HOMEWORK, selector: '#cahierDeTexte' },
    { route: EDP.ROUTES.HOMEWORK, test: () => homeworkRows().length > 3 }
  ];

  EDP.data = EDP.data || {};
  EDP.data.sourceDom = {
    id: 'dom',
    SELECTORS,
    MARKERS,
    available,
    read,
    debug,
    // Exposés aux fonctionnalités : toute la connaissance du site est ici.
    gradeTables,
    timetableRows,
    homeworkRows
  };
})();
