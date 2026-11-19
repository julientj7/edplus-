'use strict';
/**
 * content/features/simulator.js
 * ----------------------------
 * Le simulateur : une LISTE de notes fictives, et l'effet immédiat sur les
 * moyennes.
 *
 *   1. on ajoute une hypothèse (matière, note, barème, coefficient) ;
 *   2. la liste reste visible et chaque ligne se retire d'un clic (×) ;
 *   3. à chaque ajout ou retrait, la moyenne de la matière ET la moyenne
 *      générale sont recalculées, avec l'écart par rapport au relevé réel ;
 *   4. « Réinitialiser » efface toutes les hypothèses.
 *
 * Aucune note réelle n'est modifiée : `EDP.averages.simulateAll` travaille sur
 * une copie du bundle (voir features/averages.js). Les hypothèses sont
 * conservées dans storage.local (clé « edp.simulation ») pour survivre à un
 * changement d'écran, et ne sont jamais envoyées nulle part.
 *
 * Le formulaire n'est construit qu'une fois : seuls la liste, les résultats et
 * la question inverse sont redessinés. Reconstruire les champs à chaque frappe
 * ferait perdre le focus et le curseur — c'est le défaut classique des
 * interfaces « temps réel ».
 */
(() => {
  const EDP = globalThis.EDP;
  const { STORAGE_KEYS } = EDP;
  const { formatFr, formatDelta, parseNumber } = EDP.utils;
  const ui = () => EDP.ui;

  /** Valeurs par défaut des champs (et de « Réinitialiser »). */
  const FIELD_DEFAULTS = {
    value: '15',
    outOf: '20',
    coefficient: '1',
    target: '15',
    newWeight: '1'
  };

  /** État : champs du formulaire + hypothèses ajoutées. */
  let draft = { subjectKey: '', ...FIELD_DEFAULTS, notes: [] };

  /** Nombre de décimales utiles : 17 -> 0, 17,5 -> 1, 13,75 -> 2. */
  function digitsFor(value) {
    if (!Number.isFinite(value) || Number.isInteger(value)) return 0;
    return Math.round(value * 10) === value * 10 ? 1 : 2;
  }

  /** Note formatée « 17/20 » (barème conservé, format français). */
  function formatGradeValue(value, outOf) {
    return `${formatFr(value, digitsFor(value))}/${formatFr(outOf, 0)}`;
  }

  /**
   * Une hypothèse est-elle exploitable ? Sert à la relecture du stockage : une
   * valeur corrompue doit être écartée, jamais propagée au moteur de calcul.
   */
  function sanitizeNote(raw) {
    if (!raw || typeof raw.subjectKey !== 'string' || !raw.subjectKey) return null;
    const value = parseNumber(raw.value);
    const outOf = parseNumber(raw.outOf);
    const coefficient = parseNumber(raw.coefficient);
    if (value === null || !Number.isFinite(outOf) || outOf <= 0) return null;
    return {
      subjectKey: raw.subjectKey,
      value,
      outOf,
      coefficient: Number.isFinite(coefficient) && coefficient > 0 ? coefficient : 1
    };
  }

  function subjectName(subjects, key) {
    const subject = subjects.find((entry) => entry.key === key);
    return subject ? subject.name : key;
  }

  /** Hypothèses au format attendu par le moteur de calcul. */
  function scenariosOf(notes) {
    return notes.map((note) => ({
      subjectKey: note.subjectKey,
      value: note.value,
      outOf: note.outOf,
      coefficient: note.coefficient
    }));
  }

  /** Champ numérique (barème, note, coefficient, objectif…). */
  function numberControl({ value, min = null, max = null, step = '0.5' }) {
    return ui().el('input', {
      class: 'edp-input',
      type: 'number',
      inputmode: 'decimal',
      value: String(value),
      min,
      max,
      step
    });
  }

  async function mount(ctx) {
    const options = ctx.data.subjects
      .filter((subject) => subject.average20 !== null || subject.grades.length)
      .map((subject) => ({ value: subject.key, label: subject.name }));
    if (!options.length) return null;

    // --- Reprise du brouillon ---------------------------------------------
    const stored = await EDP.settings.readKey(STORAGE_KEYS.simulation, null);
    if (stored && typeof stored === 'object') {
      Object.keys(FIELD_DEFAULTS).forEach((key) => {
        const saved = stored[key];
        if (saved !== undefined && saved !== null && saved !== '') draft[key] = String(saved);
      });
      if (typeof stored.subjectKey === 'string') draft.subjectKey = stored.subjectKey;
      draft.notes = Array.isArray(stored.notes) ? stored.notes.map(sanitizeNote).filter(Boolean) : [];
    }
    if (!draft.subjectKey || !options.some((option) => option.value === draft.subjectKey)) {
      draft.subjectKey = options[0].value;
    }

    const body = ctx.panel.slot('simulator', 'Simulateur de notes');
    const card = ui().card({
      title: 'Et si… ?',
      hint: 'Notes fictives calculées localement : vos vraies notes ne sont jamais modifiées.'
    });

    // --- Formulaire (construit une seule fois) ----------------------------
    const subjectControl = ui().el(
      'select',
      { class: 'edp-input' },
      options.map((option) => ui().el('option', { value: option.value }, [option.label]))
    );
    subjectControl.value = draft.subjectKey;

    const valueControl = numberControl({ value: draft.value, min: 0, step: '0.25' });
    const scaleControl = ui().el(
      'select',
      { class: 'edp-input' },
      [10, 20, 30, 40].map((scale) => ui().el('option', { value: String(scale) }, [`sur ${scale}`]))
    );
    scaleControl.value = draft.outOf;
    const coefficientControl = numberControl({ value: draft.coefficient, min: 0.5, max: 10, step: '0.5' });

    const status = ui().el('p', { class: 'edp-sim-status', role: 'status', hidden: true });
    const addButton = ui().button('Ajouter', () => addNote(), { variant: 'primary' });

    const form = ui().el('div', { class: 'edp-form edp-sim-form' }, [
      ui().field({ label: 'Matière', control: subjectControl }),
      ui().field({ label: 'Note', control: valueControl }),
      ui().field({ label: 'Barème', control: scaleControl }),
      ui().field({ label: 'Coefficient', control: coefficientControl }),
      ui().el('div', { class: 'edp-sim-submit' }, [addButton])
    ]);

    // --- Liste des hypothèses ---------------------------------------------
    const notesList = ui().el('ul', { class: 'edp-sim-notes' });
    const emptyHint = ui().el('p', {
      class: 'edp-sim-empty',
      text: 'Aucune note fictive pour l’instant : ajoutez-en une pour voir l’effet.'
    });

    // --- Résultats --------------------------------------------------------
    const result = ui().el('div', { class: 'edp-result' });

    // --- Question inverse -------------------------------------------------
    const targetControl = numberControl({ value: draft.target, min: 0, max: 20, step: '0.5' });
    const weightControl = numberControl({ value: draft.newWeight, min: 0.5, max: 10, step: '0.5' });
    const targetResult = ui().el('div', { class: 'edp-target' });
    const targetBlock = ui().details('Il me faut combien pour atteindre mon objectif ?', [
      ui().el('div', { class: 'edp-form' }, [
        ui().field({ label: 'Objectif de moyenne', control: targetControl, hint: 'Dans la matière choisie' }),
        ui().field({ label: 'Poids de la prochaine note', control: weightControl })
      ]),
      targetResult
    ]);

    // --- Persistance ------------------------------------------------------
    async function save() {
      try {
        await EDP.settings.writeKey(STORAGE_KEYS.simulation, {
          ...draft,
          notes: draft.notes.map((note) => ({ ...note }))
        });
      } catch (error) {
        console.debug('[ED+] sauvegarde du simulateur impossible :', error);
      }
    }
    const persist = EDP.utils.debounce(save, 250);

    function showStatus(message) {
      status.textContent = message || '';
      status.hidden = !message;
    }

    // --- Rendu ------------------------------------------------------------
    function renderNotes() {
      notesList.textContent = '';
      draft.notes.forEach((note, index) => {
        const name = subjectName(ctx.data.subjects, note.subjectKey);

        const label = ui().el('span', { class: 'edp-sim-note__subject', text: name });
        label.title = name;

        const remove = ui().el(
          'button',
          {
            class: 'edp-sim-note__remove',
            type: 'button',
            title: `Retirer cette hypothèse (${name})`,
            'aria-label': `Retirer l’hypothèse ${name}`,
            onclick: () => {
              draft.notes.splice(index, 1);
              render();
              persist();
            }
          },
          ['×']
        );

        notesList.appendChild(
          ui().el('li', { class: 'edp-sim-note' }, [
            label,
            ui().el('span', {
              class: 'edp-sim-note__value',
              text: `${formatGradeValue(note.value, note.outOf)} · coef. ${formatFr(
                note.coefficient,
                digitsFor(note.coefficient)
              )}`
            }),
            remove
          ])
        );
      });

      notesList.hidden = draft.notes.length === 0;
      emptyHint.hidden = draft.notes.length > 0;
    }

    function renderResult() {
      result.textContent = '';

      if (!draft.notes.length) {
        result.appendChild(
          ui().muted('Ajoutez une note fictive : les moyennes se recalculent ici, sans rien changer à vos notes.')
        );
        return;
      }

      const simulation = EDP.averages.simulateAll(ctx.data, scenariosOf(draft.notes), ctx.settings);
      const base = simulation.base.general.average20;
      const simulated = simulation.simulated.general.average20;
      const count = draft.notes.length;

      result.appendChild(
        ui().row([
          ui().stat({
            label: 'Moyenne actuelle',
            value: base === null ? '—' : formatFr(base),
            hint: `${simulation.base.general.subjectsUsed} matière(s)`,
            tone: 'neutral'
          }),
          ui().stat({
            label: 'Moyenne simulée',
            value: simulated === null ? '—' : formatFr(simulated),
            hint: `${count} hypothèse${count > 1 ? 's' : ''}`,
            tone: 'accent'
          }),
          ui().stat({
            label: 'Écart',
            value: formatDelta(simulation.delta),
            hint: 'par rapport au relevé',
            tone: ui().toneForDelta(simulation.delta)
          })
        ])
      );

      if (simulation.subjects.length) {
        result.appendChild(
          ui().table({
            caption: 'Effet des notes fictives, matière par matière',
            head: ['Matière', 'Actuelle', 'Simulée', 'Écart'],
            rows: simulation.subjects.map((subject) => [
              subject.name,
              subject.baseAverage20 === null
                ? ui().el('span', { class: 'edp-muted', text: '—' })
                : formatFr(subject.baseAverage20),
              ui().el('strong', {
                text: subject.simulatedAverage20 === null ? '—' : formatFr(subject.simulatedAverage20)
              }),
              ui().delta(subject.delta)
            ])
          })
        );
      }

      const ignored = draft.notes.filter(
        (note) => !ctx.data.subjects.some((subject) => subject.key === note.subjectKey)
      ).length;
      if (ignored) {
        result.appendChild(
          ui().note(
            `${ignored} hypothèse${ignored > 1 ? 's' : ''} ignorée${
              ignored > 1 ? 's' : ''
            } : la matière n’est pas présente sur cet écran.`,
            'warning'
          )
        );
      }
    }

    function renderTarget() {
      targetResult.textContent = '';
      const target = parseNumber(draft.target);
      const subject = ctx.data.subjects.find((entry) => entry.key === draft.subjectKey);
      if (!subject) {
        targetResult.appendChild(ui().muted('Choisissez une matière.'));
        return;
      }

      const counted = subject.grades.filter((grade) => grade.counted && grade.value20 !== null);
      const weightSoFar = counted.reduce(
        (total, grade) => total + (ctx.settings.useGradeCoefficients ? grade.coefficient : 1),
        0
      );
      const newWeight = parseNumber(draft.newWeight) || 1;
      const needed20 = EDP.averages.neededGrade({
        currentAverage: subject.average20,
        currentWeight: weightSoFar,
        target,
        newWeight
      });

      let reason = null;
      if (needed20 === null) reason = 'Objectif invalide.';
      else if (needed20 > 20) {
        reason = `Objectif hors d’atteinte avec une seule note (${formatFr(needed20)}/20 requis).`;
      } else if (needed20 <= 0) reason = 'Objectif déjà acquis : même une mauvaise note suffit.';

      const outOf = parseNumber(draft.outOf) || 20;
      targetResult.appendChild(
        ui().stat({
          label: `Pour atteindre ${formatFr(target, digitsFor(target))} de moyenne`,
          value: needed20 === null ? '—' : `${formatFr(needed20)}/20`,
          hint:
            needed20 === null
              ? reason
              : `soit ${formatFr(EDP.averages.neededGradeOnScale(needed20, outOf))}/${formatFr(outOf, 0)} avec ce barème`,
          tone: reason ? 'warning' : 'positive'
        })
      );
      if (reason) targetResult.appendChild(ui().note(reason, 'warning'));
    }

    function render() {
      renderNotes();
      renderResult();
      renderTarget();
    }

    // --- Actions ----------------------------------------------------------
    function addNote() {
      const note = sanitizeNote({
        subjectKey: subjectControl.value,
        value: valueControl.value,
        outOf: scaleControl.value,
        coefficient: coefficientControl.value
      });

      if (!note) {
        showStatus('Saisissez une note valide (un nombre).');
        valueControl.focus();
        return;
      }
      if (note.value < 0 || note.value > note.outOf) {
        showStatus(`La note doit être comprise entre 0 et ${formatFr(note.outOf, 0)}.`);
        valueControl.focus();
        return;
      }

      draft.subjectKey = note.subjectKey;
      draft.outOf = String(note.outOf);
      draft.coefficient = String(note.coefficient);
      draft.notes.push(note);

      // Le champ se vide et reprend le focus : on enchaîne les hypothèses sans
      // re-cliquer.
      valueControl.value = '';
      draft.value = '';
      showStatus('');
      render();
      persist();
      valueControl.focus();
    }

    const reset = ui().button(
      'Réinitialiser',
      () => {
        draft = { ...draft, ...FIELD_DEFAULTS, notes: [] };
        valueControl.value = FIELD_DEFAULTS.value;
        scaleControl.value = FIELD_DEFAULTS.outOf;
        coefficientControl.value = FIELD_DEFAULTS.coefficient;
        targetControl.value = FIELD_DEFAULTS.target;
        weightControl.value = FIELD_DEFAULTS.newWeight;
        showStatus('');
        render();
        // Action explicite : on enregistre tout de suite, sans attendre le
        // temporisateur du brouillon.
        save();
      },
      { variant: 'ghost', title: 'Effacer toutes les notes fictives' }
    );

    subjectControl.addEventListener('change', () => {
      draft.subjectKey = subjectControl.value;
      renderTarget();
      persist();
    });
    targetControl.addEventListener('input', () => {
      draft.target = targetControl.value;
      renderTarget();
      persist();
    });
    weightControl.addEventListener('input', () => {
      draft.newWeight = weightControl.value;
      renderTarget();
      persist();
    });

    // Entrée dans un champ numérique = ajouter l'hypothèse (le geste naturel).
    [valueControl, coefficientControl].forEach((control) => {
      control.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        addNote();
      });
    });

    // --- Assemblage -------------------------------------------------------
    card.body.appendChild(form);
    card.body.appendChild(status);
    card.body.appendChild(notesList);
    card.body.appendChild(emptyHint);
    card.body.appendChild(result);
    card.body.appendChild(targetBlock);
    card.actions.appendChild(reset);
    body.appendChild(card.root);

    render();

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
    snapshot: () => ({ notes: draft.notes.length, subjectKey: draft.subjectKey })
  });
})();
