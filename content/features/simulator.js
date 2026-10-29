'use strict';
/**
 * content/features/simulator.js
 * ----------------------------
 * Le simulateur, version 1.0 : deux questions, deux réponses.
 *
 *   1. « Et si j'avais 17 à ce contrôle ? » -> ajoute une note FICTIVE et
 *      recalcule la matière et la moyenne générale, avec l'écart.
 *   2. « Il me faut combien pour atteindre 15 de moyenne dans cette matière ? »
 *      -> résout l'équation inverse et affiche la note nécessaire sur le barème.
 *
 * Points importants :
 *   - aucune donnée réelle n'est modifiée : le scénario est appliqué à un
 *     bundle copié (voir EDP.averages.simulate) ;
 *   - le brouillon est conservé dans storage.local (clé « edp.simulation »),
 *     jamais envoyé nulle part ;
 *   - chaque champ recalcule immédiatement : c'est un outil qu'on utilise en
 *     boucle, tout délai supplémentaire est une friction.
 */
(() => {
  const EDP = globalThis.EDP;
  const { STORAGE_KEYS } = EDP;
  const { formatFr, formatDelta } = EDP.utils;
  const ui = () => EDP.ui;

  /** Brouillon de simulation, rechargé au montage. */
  let draft = {
    subjectKey: '',
    value: '15',
    outOf: '20',
    coefficient: '1',
    target: '15',
    newWeight: '1'
  };

  function optionsFrom(ctx) {
    return ctx.data.subjects
      .filter((subject) => subject.average20 !== null || subject.grades.length)
      .map((subject) => ({ value: subject.key, label: subject.name }));
  }

  /** Note nécessaire pour atteindre la cible dans une matière. */
  function solveTarget(ctx) {
    const target = EDP.utils.parseNumber(draft.target);
    const subject = ctx.data.subjects.find((entry) => entry.key === draft.subjectKey);
    if (!subject) return { needed20: null, reason: 'Choisissez une matière.' };

    const counted = subject.grades.filter((grade) => grade.counted && grade.value20 !== null);
    const weightSoFar = counted.reduce(
      (total, grade) => total + (ctx.settings.useGradeCoefficients ? grade.coefficient : 1),
      0
    );
    const newWeight = EDP.utils.parseNumber(draft.newWeight) || 1;

    const needed20 = EDP.averages.neededGrade({
      currentAverage: subject.average20,
      currentWeight: weightSoFar,
      target,
      newWeight
    });

    if (needed20 === null) return { needed20: null, reason: 'Objectif invalide.' };
    if (needed20 > 20) {
      return { needed20, reason: `Objectif hors d'atteinte avec une seule note (${formatFr(needed20)}/20 requis).` };
    }
    if (needed20 <= 0) return { needed20, reason: 'Objectif déjà acquis : même une mauvaise note suffit.' };
    return { needed20, reason: null };
  }

  function renderResult(container, ctx) {
    container.textContent = '';
    const scenario = {
      subjectKey: draft.subjectKey,
      value: EDP.utils.parseNumber(draft.value),
      outOf: EDP.utils.parseNumber(draft.outOf),
      coefficient: EDP.utils.parseNumber(draft.coefficient)
    };

    if (!scenario.subjectKey || scenario.value === null) {
      container.appendChild(ui().muted('Choisissez une matière et saisissez une note.'));
    } else {
      const result = EDP.averages.simulate(ctx.data, scenario, ctx.settings);
      const simulatedAverage = result.simulated.general.average20;
      container.appendChild(
        ui().row([
          ui().stat({
            label: 'Moyenne générale simulée',
            value: simulatedAverage === null ? '—' : formatFr(simulatedAverage),
            tone: 'accent'
          }),
          ui().stat({
            label: 'Écart',
            value: formatDelta(result.delta),
            hint: 'par rapport à la moyenne calculée',
            tone: ui().toneForDelta(result.delta)
          }),
          ui().stat({
            label: 'Dans la matière',
            value: formatDelta(result.subjectDelta),
            tone: ui().toneForDelta(result.subjectDelta)
          })
        ])
      );
      container.appendChild(
        ui().muted(
          `Avec ${formatFr(scenario.value, 1)}/${formatFr(scenario.outOf, 0)} ` +
            `(coef. ${formatFr(scenario.coefficient, 1)}) — hypothèse locale, non enregistrée.`
        )
      );
    }

    const solved = solveTarget(ctx);
    const targetBox = ui().el('div', { class: 'edp-target' });
    targetBox.appendChild(
      ui().stat({
        label: `Pour atteindre ${formatFr(EDP.utils.parseNumber(draft.target))} de moyenne`,
        value:
          solved.needed20 === null
            ? '—'
            : `${formatFr(solved.needed20)}/20`,
        hint:
          solved.needed20 === null
            ? solved.reason
            : `soit ${formatFr(EDP.averages.neededGradeOnScale(solved.needed20, 20))}/20 (${formatFr(
                EDP.averages.neededGradeOnScale(solved.needed20, EDP.utils.parseNumber(draft.outOf) || 20)
              )}/${formatFr(EDP.utils.parseNumber(draft.outOf) || 20, 0)})`,
        tone: solved.reason ? 'warning' : 'positive'
      })
    );
    if (solved.reason) targetBox.appendChild(ui().note(solved.reason, 'warning'));
    container.appendChild(targetBox);
  }

  async function persist() {
    try {
      await EDP.settings.writeKey(STORAGE_KEYS.simulation, draft);
    } catch (error) {
      console.debug('[ED+] sauvegarde du brouillon impossible :', error);
    }
  }

  async function mount(ctx) {
    const options = optionsFrom(ctx);
    if (!options.length) return null;

    const stored = await EDP.settings.readKey(STORAGE_KEYS.simulation, null);
    if (stored && typeof stored === 'object') draft = { ...draft, ...stored };
    if (!draft.subjectKey || !options.some((option) => option.value === draft.subjectKey)) {
      draft.subjectKey = options[0].value;
    }

    const body = ctx.panel.slot('simulator', 'Simulateur de notes');
    const card = ui().card({
      title: 'Et si… ?',
      hint: 'Hypothèses locales : rien n’est envoyé au site ni enregistré dans vos notes.'
    });

    const result = ui().el('div', { class: 'edp-result' });

    const rerender = () => renderResult(result, ctx);
    const onChange = (patch) => {
      Object.assign(draft, patch);
      rerender();
      persist();
    };

    const form = ui().el('div', { class: 'edp-form' }, [
      ui().select({
        label: 'Matière',
        options,
        value: draft.subjectKey,
        onChange: (value) => onChange({ subjectKey: value })
      }),
      ui().numberInput({
        label: 'Note envisagée',
        value: draft.value,
        min: 0,
        step: '0.25',
        onInput: (value) => onChange({ value })
      }),
      ui().select({
        label: 'Barème',
        options: [10, 20, 30, 40, 50].map((scale) => ({ value: String(scale), label: `sur ${scale}` })),
        value: draft.outOf,
        onChange: (value) => onChange({ outOf: value })
      }),
      ui().numberInput({
        label: 'Coefficient',
        value: draft.coefficient,
        min: 0.5,
        max: 10,
        step: '0.5',
        onInput: (value) => onChange({ coefficient: value })
      }),
      ui().numberInput({
        label: 'Objectif de moyenne',
        value: draft.target,
        min: 0,
        max: 20,
        step: '0.5',
        onInput: (value) => onChange({ target: value }),
        hint: 'Dans la matière sélectionnée'
      }),
      ui().numberInput({
        label: 'Poids de la prochaine note',
        value: draft.newWeight,
        min: 0.5,
        max: 10,
        step: '0.5',
        onInput: (value) => onChange({ newWeight: value })
      })
    ]);

    card.body.appendChild(form);
    card.body.appendChild(result);

    const reset = ui().button(
      'Réinitialiser',
      () => {
        draft = { ...draft, value: '15', outOf: '20', coefficient: '1', target: '15', newWeight: '1' };
        rerender();
        persist();
      },
      { variant: 'ghost' }
    );
    card.actions.appendChild(reset);

    body.appendChild(card.root);
    rerender();

    return {
      destroy() {
        ctx.panel.clear('simulator');
      }
    };
  }

  EDP.registry.registerFeature({
    id: 'simulator',
    label: 'Simulateur de notes',
    settingKey: 'simulator',
    detect: (ctx) => Boolean(ctx.data && ctx.data.grades && ctx.data.grades.length),
    mount,
    snapshot: (ctx) => ({ draft: { ...draft }, subjectKey: draft.subjectKey, target: draft.target })
  });
})();
