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
   * Fabrique une note FICTIVE à partir d'une hypothèse saisie.
   *
   * Elle a exactement la forme d'une note réelle (voir content/data/model.js) :
   * c'est ce qui permet de la faire passer dans le même moteur de calcul, sans
   * branche spéciale ni second calcul parallèle — donc sans risque que les deux
   * finissent par diverger.
   *
   * @param {object} subject  matière du bundle (name, key)
   * @param {object} scenario { value, outOf, coefficient }
   * @param {number} index    rang de l'hypothèse (identifiant lisible en debug)
   */
  function virtualGrade(subject, scenario, index = 0) {
    const value = Number(scenario.value);
    const outOf = Number(scenario.outOf) > 0 ? Number(scenario.outOf) : 20;
    const coefficient = Number(scenario.coefficient) > 0 ? Number(scenario.coefficient) : 1;
    return {
      id: `sim-${index}-${subject.key}`,
      subject: subject.name,
      subjectKey: subject.key,
      label: 'Note simulée',
      value,
      outOf,
      value20: round2((value / outOf) * 20),
      coefficient,
      date: null, // une hypothèse n'a pas de date : elle ne doit pas fausser les tris
      status: EDP.GRADE_STATUS.COUNTED,
      counted: true,
      classAverage: null,
      classMin: null,
      classMax: null,
      source: 'simulation',
      raw: ''
    };
  }

  /**
   * Ajoute les notes fictives d'une matière et recalcule son coefficient.
   *
   * Le coefficient d'une matière vaut par défaut, dans ce projet, la somme des
   * coefficients de ses devoirs comptés (voir model.buildBundle). On applique la
   * MÊME règle ici : sans ça, une note simulée avec un gros coefficient
   * changerait la moyenne de la matière sans changer son poids dans la moyenne
   * générale, et le chiffre affiché serait faux dès que la note arriverait
   * vraiment. Une surcharge manuelle de l'utilisateur reste prioritaire.
   */
  function withVirtualGrades(subject, virtuals, settings) {
    const grades = subject.grades.concat(virtuals);
    const coefficient =
      EDP.model && typeof EDP.model.subjectCoefficient === 'function'
        ? EDP.model.subjectCoefficient({ ...subject, grades }, settings)
        : subject.coefficient;
    return { ...subject, grades, coefficient };
  }

  /**
   * Simulateur multi-notes : applique PLUSIEURS hypothèses d'un coup, sur une
   * copie du bundle, et renvoie l'écart par matière et sur la générale.
   *
   * Une hypothèse dont la matière est absente du relevé est ignorée (elle ne
   * peut pas être calculée) : c'est pour ça que `count` peut être inférieur au
   * nombre d'hypothèses reçues.
   *
   * @param {object} bundle    bundle enrichi (avec subjects[].average20)
   * @param {Array}  scenarios [{ subjectKey, value, outOf, coefficient }, …]
   * @param {object} settings  réglages courants
   * @returns {{ base, simulated, delta: number|null, subjects: object[], count: number }}
   */
  function simulateAll(bundle, scenarios, settings) {
    const base = computeBundle(bundle, settings);
    const list = (scenarios || []).filter(
      (scenario) => scenario && scenario.subjectKey && Number.isFinite(Number(scenario.value))
    );

    const unchanged = { base, simulated: base, delta: null, subjects: [], count: 0 };
    if (!list.length) return unchanged;

    const extras = new Map();
    list.forEach((scenario, index) => {
      const target = (bundle.subjects || []).find((subject) => subject.key === scenario.subjectKey);
      if (!target) return;
      if (!extras.has(target.key)) extras.set(target.key, []);
      extras.get(target.key).push(virtualGrade(target, scenario, index));
    });
    if (!extras.size) return unchanged;

    const simulatedBundle = {
      ...bundle,
      subjects: (bundle.subjects || []).map((subject) =>
        extras.has(subject.key)
          ? withVirtualGrades(subject, extras.get(subject.key), settings)
          : subject
      )
    };

    const simulated = computeBundle(simulatedBundle, settings);

    const subjects = Array.from(extras.keys()).map((key) => {
      const before = base.subjects.find((subject) => subject.key === key) || {};
      const after = simulated.subjects.find((subject) => subject.key === key) || {};
      const comparable = Number.isFinite(before.average20) && Number.isFinite(after.average20);
      return {
        key,
        name: after.name || before.name || key,
        baseAverage20: Number.isFinite(before.average20) ? before.average20 : null,
        simulatedAverage20: Number.isFinite(after.average20) ? after.average20 : null,
        delta: comparable ? round2(after.average20 - before.average20) : null,
        coefficient: Number.isFinite(after.coefficient) ? after.coefficient : null,
        simulatedGrades: extras.get(key).length
      };
    });

    return {
      base,
      simulated,
      delta:
        base.general.average20 === null || simulated.general.average20 === null
          ? null
          : round2(simulated.general.average20 - base.general.average20),
      subjects,
      count: list.length
    };
  }

  /**
   * Compatibilité mono-note : un seul scénario, avec `subjectDelta`.
   * Utilisé par `scripts/self-check.mjs` et par tout appel qui ne veut que la
   * première matière touchée.
   */
  function simulate(bundle, scenario, settings) {
    const result = simulateAll(bundle, scenario ? [scenario] : [], settings);
    const first = result.subjects[0] || null;
    return { ...result, subjectDelta: first ? first.delta : null };
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

  EDP.averages = {
    weightedMean,
    subjectAverage,
    computeBundle,
    simulate,
    simulateAll,
    virtualGrade,
    neededGrade,
    neededGradeOnScale
  };
})();
