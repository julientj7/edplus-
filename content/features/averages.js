'use strict';
/**
 * content/features/averages.js
 * ---------------------------
 * Moteur de calcul. C'est du code PUR : pas de DOM, pas de stockage, pas d'API.
 * Cette contrainte est volontaire — c'est ce qui permet de le vérifier hors
 * navigateur avec `node scripts/self-check.mjs`, et c'est la partie du projet où
 * une erreur se voit immédiatement dans la moyenne d'un élève.
 *
 * Règles françaises prises en compte :
 *   - notes sur d'autres barèmes que /20 (10, 40…) ramenées sur 20 ;
 *   - notes non significatives ou hors moyenne exclues si l'utilisateur le veut ;
 *   - coefficients de devoir, et coefficient de matière pour la générale ;
 *   - matières sans note (aucune moyenne, pas de division par zéro) ;
 *   - points de bonus/option : via le coefficient de matière surchargé.
 */
(() => {
  const EDP = globalThis.EDP;
  const { round2 } = EDP.utils;

  /**
   * Moyenne pondérée robuste.
   * @param {Array<{value20: number|null, weight: number}>} items
   * @returns {{ average: number|null, weight: number, count: number }}
   */
  function weightedMean(items) {
    let points = 0;
    let weight = 0;
    let count = 0;

    (items || []).forEach((item) => {
      if (!item || !Number.isFinite(item.value20)) return;
      const itemWeight = Number.isFinite(item.weight) && item.weight > 0 ? item.weight : 1;
      points += item.value20 * itemWeight;
      weight += itemWeight;
      count += 1;
    });

    if (!count || weight <= 0) return { average: null, weight: 0, count: 0 };
    return { average: round2(points / weight), weight: round2(weight), count };
  }

  /** Moyenne d'une matière à partir de ses notes comptées. */
  function subjectAverage(subject, settings) {
    const counted = subject.grades.filter((grade) => grade.counted && grade.value20 !== null);
    const items = counted.map((grade) => ({
      value20: grade.value20,
      weight: settings.useGradeCoefficients ? grade.coefficient : 1
    }));
    const mean = weightedMean(items);
    return {
      average20: mean.average,
      weight: mean.weight,
      gradeCount: mean.count,
      skipped: subject.grades.length - counted.length,
      grades: counted
    };
  }

  /**
   * Clé de comparaison d'un nom de matière. On délègue au modèle pour qu'il n'y
   * ait qu'une seule implémentation de cette normalisation : deux versions
   * divergentes feraient silencieusement échouer l'exclusion d'une matière.
   */
  function keyOf(name) {
    if (EDP.model && typeof EDP.model.subjectKey === 'function') return EDP.model.subjectKey(name);
    return String(name || '').trim().toLowerCase();
  }

  /**
   * Calcule toutes les moyennes d'un bundle.
   *
   * L'exclusion des matières est décidée ICI, à partir des réglages reçus, et
   * non héritée du bundle : c'est indispensable pour pouvoir recalculer avec
   * d'autres réglages (simulateur, aperçu) sans reconstruire le bundle — et
   * c'était le défaut de la première version, qui ignorait toute modification de
   * la liste des matières exclues.
   *
   * @returns {{ subjects: object[], general: object, classGeneral: number|null }}
   */
  function computeBundle(bundle, settings) {
    const excludedKeys = new Set((settings.excludedSubjects || []).map(keyOf).filter(Boolean));

    const subjects = (bundle.subjects || []).map((subject) => {
      const stats = subjectAverage(subject, settings);
      return {
        ...subject,
        excluded: subject.excluded === true || excludedKeys.has(subject.key),
        average20: stats.average20,
        gradeCount: stats.gradeCount,
        skipped: stats.skipped,
        points: stats.average20 === null ? null : round2(stats.average20 * subject.coefficient)
      };
    });

    // Moyenne générale : matières non exclues, pourvues d'au moins une note.
    const usable = subjects.filter((subject) => subject.average20 !== null && !subject.excluded);
    const items = usable.map((subject) => ({
      value20: subject.average20,
      weight: settings.useSubjectCoefficients ? subject.coefficient : 1
    }));
    const mean = weightedMean(items);

    // Moyenne de classe : mêmes poids, uniquement les notes qui l'affichent.
    const classItems = [];
    (bundle.grades || []).forEach((grade) => {
      if (!grade.counted || !Number.isFinite(grade.classAverage)) return;
      const subject = subjects.find((entry) => entry.key === grade.subjectKey);
      if (!subject || subject.excluded) return;
      const gradeWeight = settings.useGradeCoefficients ? grade.coefficient : 1;
      const subjectWeight = settings.useSubjectCoefficients ? subject.coefficient : 1;
      classItems.push({ value20: grade.classAverage, weight: gradeWeight * subjectWeight });
    });
    const classMean = weightedMean(classItems);

    return {
      subjects,
      general: {
        average20: mean.average,
        weight: mean.weight,
        subjectsUsed: usable.length,
        subjectsTotal: subjects.length
      },
      classGeneral: classMean.average
    };
  }

  /**
   * Simulateur : applique un scénario à un bundle SANS modifier les données
   * réelles, et renvoie l'écart obtenu.
   *
   * @param {object} bundle   bundle enrichi (avec subjects[].average20)
   * @param {object} scenario { subjectKey, value, outOf, coefficient }
   * @param {object} settings réglages courants
   */
  function simulate(bundle, scenario, settings) {
    const base = computeBundle(bundle, settings);
    if (!scenario) return { base, simulated: base, delta: null, subjectDelta: null };

    const target = bundle.subjects.find((subject) => subject.key === scenario.subjectKey);
    if (!target) return { base, simulated: base, delta: null, subjectDelta: null };

    const virtualGrade = {
      subject: target.name,
      subjectKey: target.key,
      label: 'Note simulée',
      value: Number(scenario.value),
      outOf: Number(scenario.outOf) || 20,
      value20: round2(((Number(scenario.value) || 0) / (Number(scenario.outOf) || 20)) * 20),
      coefficient: Number(scenario.coefficient) || 1,
      date: new Date(),
      status: EDP.GRADE_STATUS.COUNTED,
      counted: true,
      classAverage: null,
      source: 'simulation'
    };

    const simulatedBundle = {
      ...bundle,
      subjects: bundle.subjects.map((subject) =>
        subject.key === target.key
          ? { ...subject, grades: subject.grades.concat([virtualGrade]) }
          : subject
      )
    };

    const simulated = computeBundle(simulatedBundle, settings);
    const baseSubject = base.subjects.find((subject) => subject.key === target.key) || {};
    const simulatedSubject = simulated.subjects.find((subject) => subject.key === target.key) || {};

    return {
      base,
      simulated,
      delta:
        base.general.average20 === null || simulated.general.average20 === null
          ? null
          : round2(simulated.general.average20 - base.general.average20),
      subjectDelta:
        baseSubject.average20 === null || simulatedSubject.average20 === null
          ? null
          : round2(simulatedSubject.average20 - baseSubject.average20)
    };
  }

  /**
   * Question inverse : « combien me faut-il à la prochaine évaluation pour
   * atteindre telle moyenne ? »
   *
   * Résout  (moyenne × poidsActuel + note × poidsNouveau) / (poidsActuel + poidsNouveau) = cible
   *
   * @param {object} params { currentAverage, currentWeight, target, newWeight }
   * @returns {number|null} note nécessaire sur 20 (null si déjà atteint ou impossible)
   */
  function neededGrade({ currentAverage, currentWeight, target, newWeight }) {
    if (!Number.isFinite(target)) return null;
    const weightSoFar = Number.isFinite(currentWeight) ? currentWeight : 0;
    const addedWeight = Number.isFinite(newWeight) && newWeight > 0 ? newWeight : 1;
    // Matière sans aucune note : la cible est directement la note à obtenir.
    if (!weightSoFar || !Number.isFinite(currentAverage)) return round2(target);
    const needed = (target * (weightSoFar + addedWeight) - currentAverage * weightSoFar) / addedWeight;
    return round2(needed);
  }

  /** Note nécessaire ramenée sur le barème de l'évaluation, pour l'affichage. */
  function neededGradeOnScale(neededOn20, outOf) {
    if (neededOn20 === null || !Number.isFinite(outOf) || outOf <= 0) return null;
    return round2((neededOn20 / 20) * outOf);
  }

  EDP.averages = { weightedMean, subjectAverage, computeBundle, simulate, neededGrade, neededGradeOnScale };
})();
