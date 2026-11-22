'use strict';
/**
 * content/features/progress.js
 * ----------------------------
 * Préparation des séries chronologiques affichées par les graphiques
 * (content/features/charts.js).
 *
 * Ce fichier est du code PUR : pas de DOM, pas de stockage, pas d'API — comme
 * features/averages.js, ce qui permet de le vérifier hors navigateur avec
 * `node scripts/self-check.mjs`. Il ne calcule aucune moyenne « à sa façon » :
 * il réutilise EDP.averages.computeBundle() pour la moyenne générale et les
 * mêmes règles (coefficients de devoir, coefficients de matière, matières
 * exclues). Une courbe ne peut donc pas raconter autre chose que l'en-tête du
 * relevé de notes.
 *
 * Trois notions :
 *   1. une note n'entre dans une courbe que si elle est COMPTÉE et DATÉE ;
 *   2. une moyenne « à une date » = moyenne de toutes les notes jusqu'à cette
 *      date incluse (c'est la définition d'une évolution, pas d'un lissage) ;
 *   3. les coefficients de matière utilisés pour la courbe générale sont ceux
 *      de la période entière : les faire varier à chaque note ferait sauter la
 *      courbe pour une raison que l'élève ne peut pas voir.
 *
 * Le découpage des trimestres est une ESTIMATION (septembre -> décembre,
 * décembre -> mars, mars -> août) : École Directe n'expose pas ses bornes dans
 * la page. L'interface le dit, et le mode « personnalisée » permet de choisir
 * exactement les dates voulues.
 */
(() => {
  const EDP = globalThis.EDP;
  const { round2 } = EDP.utils;

  const DAY = 24 * 60 * 60 * 1000;

  /** Minuit local (les notes d'un même jour sont regroupées). */
  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  /** 23:59:59.999 local : borne haute INCLUSIVE d'une période. */
  function endOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
  }

  /** Clé d'un jour, pour regrouper les notes d'une même date. */
  function dayKey(date) {
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  }

  /** Une date exploitable ? */
  function validDate(value) {
    return value instanceof Date && !Number.isNaN(value.getTime());
  }

  /** Notes affichées, comptées, pourvues d'une valeur sur 20 et d'une date. */
  function usableGrades(grades) {
    return (Array.isArray(grades) ? grades : [])
      .filter(
        (grade) =>
          grade &&
          grade.counted === true &&
          Number.isFinite(grade.value20) &&
          validDate(grade.date)
      )
      .sort((left, right) => left.date.getTime() - right.date.getTime());
  }

  /** Regroupe une liste déjà triée en journées consécutives. */
  function dayGroups(grades) {
    const groups = [];
    let current = null;
    (grades || []).forEach((grade) => {
      const key = dayKey(grade.date);
      if (!current || current.key !== key) {
        current = { key, grades: [] };
        groups.push(current);
      }
      current.grades.push(grade);
    });
    return groups;
  }

  // ---------------------------------------------------------------------------
  // Périodes
  // ---------------------------------------------------------------------------

  /** 1er septembre de l'année scolaire qui contient `reference`. */
  function schoolYearStart(reference) {
    const year = reference.getMonth() >= 8 ? reference.getFullYear() : reference.getFullYear() - 1;
    return new Date(year, 8, 1);
  }

  /**
   * Trimestre estimé autour d'une date.
   * Bornes exclusives en interne, converties en borne inclusive à la sortie.
   */
  function trimesterWindow(reference) {
    const start = schoolYearStart(reference);
    const year = start.getFullYear();
    const next = year + 1;
    const windows = [
      { from: new Date(year, 8, 1), to: new Date(year, 11, 1), label: 'Trimestre 1' },
      { from: new Date(year, 11, 1), to: new Date(next, 2, 1), label: 'Trimestre 2' },
      { from: new Date(next, 2, 1), to: new Date(next, 8, 1), label: 'Trimestre 3' }
    ];
    const time = reference.getTime();
    const found =
      windows.find((window) => time >= window.from.getTime() && time < window.to.getTime()) ||
      windows[windows.length - 1];
    return {
      from: found.from,
      to: new Date(found.to.getTime() - 1),
      label: found.label
    };
  }

  /** Lit « AAAA-MM-JJ » (valeur d'un <input type="date">) ou une Date. */
  function parseDay(value, fallback) {
    if (validDate(value)) return startOfDay(value);
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const parts = value.split('-').map(Number);
      const date = new Date(parts[0], parts[1] - 1, parts[2]);
      if (!Number.isNaN(date.getTime())) return date;
    }
    return fallback;
  }

  function formatDay(date) {
    if (!validDate(date)) return '';
    try {
      return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch (error) {
      return '';
    }
  }

  /**
   * Bornes de la période demandée.
   *
   * @param {'trimester'|'year'|'custom'} period
   * @param {object} [options] { now, grades, custom: { from, to } }
   * @returns {{period: string, from: Date, to: Date, label: string,
   *   estimated: boolean, fallback: boolean}}
   */
  function periodBounds(period, options = {}) {
    const now = validDate(options.now) ? options.now : new Date();
    const grades = Array.isArray(options.grades) ? options.grades : [];
    const custom = options.custom || {};

    if (period === 'year') {
      const from = schoolYearStart(now);
      return {
        period: 'year',
        from,
        to: endOfDay(new Date(from.getFullYear() + 1, 7, 31)),
        label: `Année scolaire ${from.getFullYear()}–${from.getFullYear() + 1}`,
        estimated: false,
        fallback: false
      };
    }

    if (period === 'custom') {
      const dated = usableGrades(grades);
      const defaultFrom = dated.length ? dated[0].date : schoolYearStart(now);
      const from = parseDay(custom.from, defaultFrom);
      const to = endOfDay(parseDay(custom.to, now));
      if (from.getTime() <= to.getTime()) {
        return {
          period: 'custom',
          from,
          to,
          label: `du ${formatDay(from)} au ${formatDay(to)}`,
          estimated: false,
          fallback: false
        };
      }
      // Dates incohérentes : on retombe sur l'année plutôt que sur du vide.
      const year = periodBounds('year', { now, grades });
      return { ...year, period: 'custom', fallback: true };
    }

    // Trimestre « en cours ». Si aucune note datée n'existe dans le trimestre
    // courant (vacances, début d'année), on montre le dernier trimestre noté :
    // un graphique vide serait pris pour une panne.
    const window = trimesterWindow(now);
    const dated = usableGrades(grades);
    const hasCurrent = dated.some(
      (grade) => grade.date.getTime() >= window.from.getTime() && grade.date.getTime() <= window.to.getTime()
    );
    if (dated.length && !hasCurrent) {
      const last = trimesterWindow(dated[dated.length - 1].date);
      if (last.from.getTime() !== window.from.getTime()) {
        return {
          period: 'trimester',
          from: last.from,
          to: last.to,
          label: `${last.label} (dernier trimestre noté)`,
          estimated: true,
          fallback: true
        };
      }
    }
    return { period: 'trimester', from: window.from, to: window.to, label: window.label, estimated: true, fallback: false };
  }

  /** Une date appartient-elle aux bornes (incluses) ? */
  function inBounds(date, bounds) {
    if (!validDate(date)) return false;
    if (!bounds) return true;
    const time = date.getTime();
    return time >= bounds.from.getTime() && time <= bounds.to.getTime();
  }

  // ---------------------------------------------------------------------------
  // Séries
  // ---------------------------------------------------------------------------

  /** Regroupe des notes par matière, dans l'ordre d'apparition. */
  function groupBySubject(grades) {
    const map = new Map();
    (grades || []).forEach((grade) => {
      if (!map.has(grade.subjectKey)) {
        map.set(grade.subjectKey, { key: grade.subjectKey, name: grade.subject, grades: [] });
      }
      map.get(grade.subjectKey).grades.push(grade);
    });
    return Array.from(map.values());
  }

  /** Poids d'une note dans sa matière (coefficient de devoir, si activé). */
  function gradeWeight(grade, settings) {
    if (settings && settings.useGradeCoefficients === false) return 1;
    return Number.isFinite(grade.coefficient) && grade.coefficient > 0 ? grade.coefficient : 1;
  }

  /** Coefficient de matière, avec la même règle que le relevé de notes. */
  function subjectCoefficient(subject, settings) {
    if (EDP.model && typeof EDP.model.subjectCoefficient === 'function') {
      return EDP.model.subjectCoefficient(subject, settings);
    }
    return 1;
  }

  /**
   * Moyenne courante d'une matière, une valeur par journée notée.
   * @returns {Array<{date: Date, value: number}>}
   */
  function runningPoints(subjectGrades, settings) {
    const points = [];
    let sum = 0;
    let weight = 0;
    dayGroups(subjectGrades).forEach((group) => {
      group.grades.forEach((grade) => {
        const gradeW = gradeWeight(grade, settings);
        sum += grade.value20 * gradeW;
        weight += gradeW;
      });
      if (weight > 0) points.push({ date: group.grades[0].date, value: round2(sum / weight) });
    });
    return points;
  }

  /**
   * Moyenne générale à une date : on rejoue le MOTEUR du relevé de notes sur
   * les notes déjà reçues à cet instant, avec les coefficients de la période.
   */
  function generalAt(grades, settings, coefficients) {
    const subjects = groupBySubject(grades).map((subject) => ({
      key: subject.key,
      name: subject.name,
      grades: subject.grades,
      coefficient: coefficients.get(subject.key) || 1,
      excluded: false
    }));
    try {
      const computed = EDP.averages.computeBundle({ grades, subjects }, settings);
      return computed.general.average20;
    } catch (error) {
      return null;
    }
  }

  /** Série de la moyenne générale, une valeur par journée notée. */
  function generalPoints(grades, settings, coefficients) {
    const points = [];
    const received = [];
    dayGroups(grades).forEach((group) => {
      group.grades.forEach((grade) => received.push(grade));
      const value = generalAt(received.slice(), settings, coefficients);
      if (Number.isFinite(value)) points.push({ date: group.grades[0].date, value });
    });
    return points;
  }

  /**
   * Construit toutes les séries d'une période.
   *
   * @param {object[]} grades     notes normalisées (content/data/model.js)
   * @param {object}   settings   réglages courants (coefficients, exclusions)
   * @param {object|null} bounds  bornes de periodBounds(), ou null = tout
   * @returns {{general: Array, subjects: Array, count: number, undated: number,
   *   first: Date|null, last: Date|null, bounds: object|null}}
   */
  function buildSeries(grades, settings, bounds = null) {
    const config = settings || {};
    const all = usableGrades(grades);
    const list = bounds ? all.filter((grade) => inBounds(grade.date, bounds)) : all;

    // Notes comptées mais SANS date : elles ne peuvent pas être placées sur une
    // courbe. On les compte pour pouvoir le dire à l'utilisateur.
    const undated = (Array.isArray(grades) ? grades : []).filter(
      (grade) =>
        grade &&
        grade.counted === true &&
        Number.isFinite(grade.value20) &&
        !validDate(grade.date)
    ).length;

    const grouped = groupBySubject(list);
    const coefficients = new Map();
    grouped.forEach((subject) => {
      coefficients.set(subject.key, subjectCoefficient(subject, config));
    });

    const subjects = grouped
      .map((subject) => {
        const points = runningPoints(subject.grades, config);
        return {
          key: subject.key,
          name: subject.name,
          coefficient: coefficients.get(subject.key),
          gradeCount: subject.grades.length,
          points,
          current: points.length ? points[points.length - 1].value : null
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name, 'fr'));

    return {
      general: generalPoints(list, config, coefficients),
      subjects,
      count: list.length,
      undated,
      first: list.length ? list[0].date : null,
      last: list.length ? list[list.length - 1].date : null,
      bounds: bounds || null
    };
  }

  EDP.progress = {
    DAY,
    startOfDay,
    endOfDay,
    usableGrades,
    dayGroups,
    schoolYearStart,
    trimesterWindow,
    periodBounds,
    inBounds,
    buildSeries,
    generalPoints,
    runningPoints
  };
})();
