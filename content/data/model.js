'use strict';
/**
 * content/data/model.js
 * --------------------
 * Modèle de données interne : c'est le contrat STABLE du projet.
 *
 * Toute la fragile lecture du site (voir source-dom.js) doit se traduire ici en
 * un objet `Grade` normalisé. Les fonctionnalités (moyennes, simulateur, panneau,
 * popup) ne connaissent que ce modèle : le jour où le site change de balisage,
 * seul source-dom.js bouge.
 *
 *   Grade {
 *     id            : string   identifiant stable (empreinte) pour retrouver la note
 *     subject       : string   nom de la matière tel qu'affiché
 *     subjectKey    : string   clé normalisée de la matière (comparaisons, surcharges)
 *     label         : string   libellé du devoir (« Contrôle n°3 — dérivées »)
 *     value         : number|null  note brute
 *     outOf         : number   barème (20, 10, 40…)
 *     value20       : number|null  note ramenée sur 20 (null si inutilisable)
 *     coefficient   : number   coefficient du devoir (1 par défaut)
 *     date          : Date|null
 *     status        : string   EDP.GRADE_STATUS.*
 *     counted       : boolean  entre-t-elle dans le calcul avec les réglages actuels ?
 *     classAverage  : number|null  moyenne de la classe sur 20 (si affichée)
 *     classMin/Max  : number|null  (si affichés)
 *     raw           : string   texte d'origine, pour le diagnostic
 *   }
 */
(() => {
  const EDP = globalThis.EDP;
  const { GRADE_STATUS } = EDP;
  const { toOutOf20, round2, fingerprint, normalizeLabel } = EDP.utils;

  /** Clé de matière : insensible à la casse et aux espaces multiples. */
  function subjectKey(name) {
    return normalizeLabel(name)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  /**
   * Construit une note normalisée à partir d'un enregistrement brut.
   * @param {object} raw enregistrement produit par une source (DOM, API…)
   * @param {object} [options] { defaultScale }
   * @returns {object|null} null si rien d'exploitable (pas de matière)
   */
  function createGrade(raw, options = {}) {
    if (!raw) return null;
    const defaultScale = options.defaultScale || 20;
    const subject = normalizeLabel(raw.subject);
    if (!subject) return null;

    const value = Number.isFinite(raw.value) ? raw.value : null;
    const outOf = Number.isFinite(raw.outOf) && raw.outOf > 0 ? raw.outOf : defaultScale;
    const status = raw.status || (value === null ? GRADE_STATUS.ABSENT : GRADE_STATUS.COUNTED);
    const coefficient = Number.isFinite(raw.coefficient) && raw.coefficient > 0 ? raw.coefficient : 1;

    const grade = {
      id: raw.id || fingerprint([subject, raw.label, raw.date, raw.value, raw.outOf].join('|')),
      subject,
      subjectKey: subjectKey(subject),
      label: normalizeLabel(raw.label) || 'Évaluation',
      value,
      outOf,
      value20: value === null ? null : round2(toOutOf20(value, outOf)),
      coefficient,
      date: raw.date instanceof Date && !Number.isNaN(raw.date.getTime()) ? raw.date : null,
      status,
      counted: false, // décidé par applyRules()
      classAverage: Number.isFinite(raw.classAverage) ? round2(raw.classAverage) : null,
      classMin: Number.isFinite(raw.classMin) ? round2(raw.classMin) : null,
      classMax: Number.isFinite(raw.classMax) ? round2(raw.classMax) : null,
      source: raw.source || 'dom',
      raw: raw.rawText || ''
    };
    return grade;
  }

  /**
   * Décide si une note entre dans le calcul, en fonction des réglages.
   * Séparé de createGrade() exprès : les règles changent souvent (interrupteur
   * « notes non significatives »), le modèle de données beaucoup moins.
   */
  function isCounted(grade, settings) {
    if (grade.value20 === null) return false;
    if (grade.status === GRADE_STATUS.ABSENT) return false;
    if (grade.status === GRADE_STATUS.NOT_COUNTED) return false;
    if (grade.status === GRADE_STATUS.NON_SIGNIFICANT) {
      return settings.excludeNonSignificant === false;
    }
    return true;
  }

  /**
   * Regroupe les notes en matières, applique les règles et calcule les
   * coefficients de matière (surcharge utilisateur prioritaire, puis somme des
   * coefficients de devoirs, puis 1).
   *
   * @returns {{ grades: object[], subjects: object[], warnings: string[] }}
   */
  function buildBundle(rawGrades, settings) {
    const warnings = [];
    const grades = [];

    (rawGrades || []).forEach((raw) => {
      const grade = createGrade(raw);
      if (grade) grades.push(grade);
    });

    if (!grades.length) {
      return { grades: [], subjects: [], warnings: ['Aucune note exploitable détectée sur cette page.'] };
    }

    grades.forEach((grade) => {
      const counted = isCounted(grade, settings);
      grade.counted = counted;
      if (!counted && grade.value20 !== null) {
        warnings.push(
          grade.status === GRADE_STATUS.NON_SIGNIFICANT
            ? `« ${grade.subject} » : note non significative exclue.`
            : `« ${grade.subject} » : note hors moyenne exclue.`
        );
      }
    });

    const bySubject = new Map();
    grades.forEach((grade) => {
      if (!bySubject.has(grade.subjectKey)) {
        bySubject.set(grade.subjectKey, {
          key: grade.subjectKey,
          name: grade.subject,
          grades: [],
          coefficient: 1,
          excluded: false
        });
      }
      bySubject.get(grade.subjectKey).grades.push(grade);
    });

    // Note : ce drapeau n'est qu'une valeur PAR DÉFAUT lisible sur le bundle
    // brut. La décision qui fait foi est prise par EDP.averages.computeBundle(),
    // qui relit les réglages — sinon un changement de matières exclues resterait
    // sans effet tant que le bundle n'est pas reconstruit.
    const excluded = new Set(
      (settings.excludedSubjects || []).map((name) => subjectKey(name)).filter(Boolean)
    );
    const overrides = settings.coefficientOverrides || {};

    const subjects = Array.from(bySubject.values()).map((subject) => {
      const explicit = Number(overrides[subject.name]);
      if (Number.isFinite(explicit) && explicit > 0) subject.coefficient = explicit;
      else {
        const sum = subject.grades
          .filter((grade) => grade.counted && grade.value20 !== null)
          .reduce((total, grade) => total + grade.coefficient, 0);
        subject.coefficient = sum > 0 ? round2(sum) : 1;
      }
      subject.excluded = excluded.has(subject.key);
      subject.average20 = null; // rempli par features/averages.js
      return subject;
    });

    subjects.sort((a, b) => a.name.localeCompare(b.name, 'fr'));

    return {
      grades,
      subjects,
      warnings: Array.from(new Set(warnings)).slice(0, 6)
    };
  }

  /** Tri par date décroissante (les notes sans date passent en dernier). */
  function sortByDateDesc(grades) {
    return grades.slice().sort((a, b) => {
      const left = a.date ? a.date.getTime() : -Infinity;
      const right = b.date ? b.date.getTime() : -Infinity;
      return right - left;
    });
  }

  EDP.model = { createGrade, isCounted, buildBundle, sortByDateDesc, subjectKey };
})();
