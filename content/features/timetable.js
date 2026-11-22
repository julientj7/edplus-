'use strict';
/**
 * content/features/timetable.js
 * ---------------------------
 * Emploi du temps lisible : « où suis-je, et qu'est-ce qui vient ensuite ? »
 *
 * Ce que la fonctionnalité ajoute :
 *   1. sur la page, trois états sur les lignes de cours — edp-now, edp-next,
 *      edp-cancelled — plus une étiquette TEXTE (data-edp-status) et, pour le
 *      cours en cours, une jauge d'avancement (--edp-progress). Aucune
 *      structure du site n'est modifiée : uniquement des classes et attributs,
 *      retirés au démontage ;
 *   2. dans le panneau, la journée entière en agenda vertical : cours passés
 *      estompés, cours en cours mis en avant, prochain cours signalé ;
 *   3. un rafraîchissement chaque minute. Un repère « en cours » calculé une
 *      seule fois ment au bout de cinq minutes — et c'est précisément
 *      l'information qu'on vient chercher.
 *
 * Limite assumée de la v1.0 : on raisonne sur l'heure courante et la journée
 * affichée. Si l'emploi du temps couvre plusieurs jours d'un coup, seule la
 * première journée contenant des horaires est exploitée (voir README).
 */
(() => {
  const EDP = globalThis.EDP;
  const ui = () => EDP.ui;

  const CLASS_NOW = 'edp-now';
  const CLASS_NEXT = 'edp-next';
  const CLASS_CANCELLED = 'edp-cancelled';

  /** Une minute : assez fin pour un temps restant, assez rare pour être gratuit. */
  const TICK_MS = 60_000;

  /** Minutes depuis minuit, pour l'heure locale. */
  function nowMinutes() {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  }

  function pad(value) {
    return String(value).padStart(2, '0');
  }

  function formatTime(minutes) {
    const wrapped = ((minutes % 1440) + 1440) % 1440;
    return `${pad(Math.floor(wrapped / 60))}h${pad(wrapped % 60)}`;
  }

  /** « 12 min », « 1 h 05 » : plus parlant qu'un nombre décimal d'heures. */
  function humanDelay(minutes) {
    const total = Math.max(0, Math.round(minutes));
    if (total < 60) return `${total} min`;
    const hours = Math.floor(total / 60);
    const mins = total % 60;
    return mins ? `${hours} h ${pad(mins)}` : `${hours} h`;
  }

  /** Classe les cours par rapport à maintenant. */
  function classify(entries, now = nowMinutes()) {
    const sorted = entries.slice().sort((a, b) => a.start - b.start);
    const current = sorted.find((entry) => entry.start <= now && entry.end > now) || null;
    const next = sorted.find((entry) => entry.start > now) || null;
    return { current, next, sorted, now };
  }

  /**
   * Marque les lignes de la page, et renvoie de quoi tout nettoyer.
   *
   * L'étiquette est posée sur la PREMIÈRE CELLULE, pas sur la ligne : `attr()`
   * dans un pseudo-élément ne lit que l'élément qui porte le pseudo, donc un
   * attribut posé sur <tr> serait invisible depuis `td::before`.
   */
  function markPage(entries, state) {
    const touched = [];

    entries.forEach((entry) => {
      const row = entry.row;
      if (!row) return;

      const classes = [];
      let stateName = '';
      let status = '';

      if (entry.cancelled) {
        classes.push(CLASS_CANCELLED);
        stateName = 'cancelled';
        status = 'annulé';
      }
      if (state.current === entry && !entry.cancelled) {
        classes.push(CLASS_NOW);
        stateName = 'now';
        status = `en cours · reste ${humanDelay(entry.end - state.now)}`;
      } else if (state.next === entry && !entry.cancelled) {
        classes.push(CLASS_NEXT);
        stateName = 'next';
        status = `dans ${humanDelay(entry.start - state.now)}`;
      }

      if (!classes.length) return;

      classes.forEach((name) => row.classList.add(name));

      // Jauge : part du cours déjà écoulée. Posée en propriété personnalisée,
      // lue par le CSS — aucune largeur calculée en JavaScript.
      const isNow = state.current === entry && !entry.cancelled;
      if (isNow) {
        const span = Math.max(1, entry.end - entry.start);
        const ratio = Math.min(1, Math.max(0, (state.now - entry.start) / span));
        row.style.setProperty('--edp-progress', `${(ratio * 100).toFixed(1)}%`);
      }

      const cell = (row.cells && row.cells[0]) || row.querySelector('td, th');
      if (cell) {
        cell.dataset.edpState = stateName;
        cell.dataset.edpStatus = status;
      }

      touched.push({ row, classes, cell, isNow });
    });

    return () => {
      touched.forEach(({ row, classes, cell, isNow }) => {
        classes.forEach((name) => row.classList.remove(name));
        if (cell) {
          delete cell.dataset.edpState;
          delete cell.dataset.edpStatus;
        }
        if (isNow) row.style.removeProperty('--edp-progress');
      });
    };
  }

  /** Une ligne de l'agenda du panneau. */
  function agendaItem(entry, state) {
    let stateName = 'later';
    let badge = null;

    if (entry.cancelled) {
      stateName = 'cancelled';
      badge = ui().badge('annulé', 'muted');
    } else if (state.current === entry) {
      stateName = 'now';
      badge = ui().badge('en cours');
    } else if (entry.end <= state.now) {
      stateName = 'past';
    } else if (state.next === entry) {
      stateName = 'next';
      badge = ui().badge('ensuite');
    }

    return ui().el('li', { class: 'edp-agenda__item', dataset: { state: stateName } }, [
      ui().el('span', { class: 'edp-agenda__time', text: `${formatTime(entry.start)}–${formatTime(entry.end)}` }),
      ui().el('span', { class: 'edp-agenda__main' }, [
        ui().el('span', { class: 'edp-agenda__subject', text: entry.subject }),
        entry.room ? ui().el('span', { class: 'edp-agenda__room', text: entry.room }) : null
      ]),
      badge
    ]);
  }

  /** Carte du panneau : chiffres clés + journée complète. */
  function renderDay(state, entries) {
    const card = ui().card({ title: 'Ma journée', hint: 'Le cours en cours est surligné sur la page' });
    const current = state.current && !state.current.cancelled ? state.current : null;
    const finished = entries.filter((entry) => !entry.cancelled && entry.end <= state.now).length;

    card.body.appendChild(
      ui().row([
        ui().stat({
          label: 'En cours',
          value: current ? current.subject : 'Aucun',
          hint: current ? `${current.timeText}${current.room ? ` · ${current.room}` : ''}` : 'Entre deux cours',
          tone: current ? 'accent' : 'neutral'
        }),
        ui().stat({
          label: 'Temps restant',
          value: current ? humanDelay(current.end - state.now) : '—',
          hint: current ? `fin à ${formatTime(current.end)}` : null
        }),
        ui().stat({
          label: 'Créneaux',
          value: String(entries.length),
          hint: `${finished} terminé(s)`
        })
      ])
    );

    card.body.appendChild(ui().el('ul', { class: 'edp-agenda' }, state.sorted.map((entry) => agendaItem(entry, state))));

    const cancelled = entries.filter((entry) => entry.cancelled).length;
    if (cancelled) {
      card.body.appendChild(ui().muted(`${cancelled} créneau(x) annulé(s) aujourd’hui.`));
    }

    return card.root;
  }

  /**
   * Repeint le panneau ET les marqueurs de la page.
   * @returns {() => void} nettoyage des marqueurs posés
   */
  function paint(ctx, entries) {
    const state = classify(entries);
    const cleanup = markPage(entries, state);

    const body = ctx.panel.slot('timetable', 'Emploi du temps');
    body.textContent = '';
    body.appendChild(renderDay(state, entries));

    return cleanup;
  }

  function snapshot(entries) {
    const state = classify(entries);
    return {
      current: state.current
        ? {
            subject: state.current.subject,
            time: state.current.timeText,
            room: state.current.room,
            endsInMinutes: state.current.end - state.now
          }
        : null,
      next: state.next
        ? {
            subject: state.next.subject,
            time: state.next.timeText,
            room: state.next.room,
            startsInMinutes: state.next.start - state.now
          }
        : null,
      slots: entries.length,
      cancelled: entries.filter((entry) => entry.cancelled).length
    };
  }

  function mount(ctx) {
    const source = EDP.data.sourceDom;
    if (!source || !source.timetableRows) return null;

    let entries = source.timetableRows();
    if (!entries.length) return null;

    let cleanupMark = paint(ctx, entries);

    // Relecture de la page à chaque minute : le site peut avoir rechargé son
    // emploi du temps, et « en cours » doit suivre l'horloge.
    const timer = setInterval(() => {
      try {
        const fresh = EDP.data.sourceDom.timetableRows();
        if (!fresh.length) return;
        entries = fresh;
        cleanupMark();
        cleanupMark = paint(ctx, entries);
      } catch (error) {
        console.debug('[ED+] emploi du temps : rafraîchissement ignoré', error);
      }
    }, TICK_MS);

    return {
      destroy() {
        clearInterval(timer);
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
