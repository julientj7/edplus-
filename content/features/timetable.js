'use strict';
/**
 * content/features/timetable.js
 * ---------------------------
 * Emploi du temps lisible : « où suis-je, et qu'est-ce qui vient ensuite ? »
 *
 * Deux actions :
 *   1. sur la page, on marque les lignes de cours : en cours (edp-now), suivant
 *      (edp-next), annulé (edp-cancelled) — le style vient de
 *      styles/features/timetable.css, donc entièrement désactivable ;
 *   2. dans le panneau, une carte donne le cours en cours et le suivant, avec le
 *      temps restant.
 *
 * Limite assumée de la v1.0 : on raisonne sur l'heure courante et la journée
 * affichée. Si l'emploi du temps couvre plusieurs jours d'un coup, seule la
 * première journée contenant des horaires est exploitée (voir README).
 */
(() => {
  const EDP = globalThis.EDP;
  const { formatFr } = EDP.utils;
  const ui = () => EDP.ui;

  const CLASS_NOW = 'edp-now';
  const CLASS_NEXT = 'edp-next';
  const CLASS_CANCELLED = 'edp-cancelled';

  /** Minutes depuis minuit, pour l'heure locale. */
  function nowMinutes() {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  }

  function formatTime(minutes) {
    const hours = Math.floor(minutes / 60) % 24;
    const mins = minutes % 60;
    return `${String(hours).padStart(2, '0')}h${String(mins).padStart(2, '0')}`;
  }

  /** Classe les cours par rapport à maintenant. */
  function classify(entries, now = nowMinutes()) {
    const sorted = entries.slice().sort((a, b) => a.start - b.start);
    const current = sorted.find((entry) => entry.start <= now && entry.end > now) || null;
    const next = sorted.find((entry) => entry.start > now) || null;
    return { current, next, sorted, now };
  }

  /** Marque les lignes de la page, et renvoie de quoi tout nettoyer. */
  function markPage(entries, state) {
    const touched = [];
    entries.forEach((entry) => {
      const classes = [];
      if (state.current === entry) classes.push(CLASS_NOW);
      if (state.next === entry) classes.push(CLASS_NEXT);
      if (entry.cancelled) classes.push(CLASS_CANCELLED);
      if (!classes.length) return;
      classes.forEach((name) => entry.row.classList.add(name));
      touched.push({ row: entry.row, classes });
    });
    return () => {
      touched.forEach(({ row, classes }) => classes.forEach((name) => row.classList.remove(name)));
    };
  }

  function renderCard(ctx, entries) {
    const body = ctx.panel.slot('timetable', 'Emploi du temps');
    const card = ui().card({ title: 'Maintenant', hint: 'Surlignage des lignes sur la page' });
    const state = classify(entries);

    if (state.current) {
      card.body.appendChild(
        ui().row([
          ui().stat({
            label: 'En cours',
            value: state.current.subject,
            hint: `${state.current.timeText}${state.current.room ? ` · ${state.current.room}` : ''}`,
            tone: 'accent'
          }),
          ui().stat({
            label: 'Fin dans',
            value: `${formatFr((state.current.end - state.now) / 60, 1)} h`,
            hint: `à ${formatTime(state.current.end)}`
          })
        ])
      );
    } else {
      card.body.appendChild(ui().muted('Aucun cours en ce moment.'));
    }

    if (state.next) {
      card.body.appendChild(
        ui().stat({
          label: 'Prochain cours',
          value: state.next.subject,
          hint: `${state.next.timeText}${state.next.room ? ` · ${state.next.room}` : ''} · dans ${formatFr(
            (state.next.start - state.now) / 60,
            1
          )} h`
        })
      );
    }

    card.body.appendChild(ui().muted(`${entries.length} créneau(x) analysé(s) sur cet écran.`));
    body.appendChild(card.root);
    return { state, card };
  }

  function snapshot(entries) {
    const state = classify(entries);
    return {
      current: state.current
        ? { subject: state.current.subject, time: state.current.timeText, room: state.current.room, endsInMinutes: state.current.end - state.now }
        : null,
      next: state.next
        ? { subject: state.next.subject, time: state.next.timeText, room: state.next.room, startsInMinutes: state.next.start - state.now }
        : null,
      slots: entries.length
    };
  }

  function mount(ctx) {
    const source = EDP.data.sourceDom;
    if (!source || !source.timetableRows) return null;
    const entries = source.timetableRows();
    if (!entries.length) return null;

    const cleanupMark = markPage(entries, classify(entries));
    renderCard(ctx, entries);

    return {
      destroy() {
        cleanupMark();
        ctx.panel.clear('timetable');
      }
    };
  }

  EDP.registry.registerFeature({
    id: 'timetable',
    label: 'Emploi du temps',
    settingKey: 'timetable',
    detect: (ctx) => {
      const source = EDP.data.sourceDom;
      if (!source || !source.timetableRows) return false;
      // Détection par le contenu : inutile de dépendre du nom de la route.
      return source.timetableRows().length > 0 && ctx.route !== EDP.ROUTES.NOTES;
    },
    mount,
    snapshot: () => {
      const source = EDP.data.sourceDom;
      if (!source || !source.timetableRows) return null;
      return snapshot(source.timetableRows());
    }
  });
})();
