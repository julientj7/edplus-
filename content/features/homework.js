'use strict';
/**
 * content/features/homework.js
 * --------------------------
 * Cahier de textes utilisable : « qu'est-ce que je dois faire, et pour quand ? »
 *
 * Ce que la fonctionnalité ajoute :
 *   1. sur la page, un état par devoir — edp-done, edp-late, edp-today,
 *      edp-soon — doublé d'une étiquette TEXTE (data-edp-status) : un devoir
 *      fait reste reconnaissable en niveaux de gris, à l'impression, ou pour un
 *      élève daltonien ;
 *   2. dans le panneau, une barre de progression segmentée (fait / en retard /
 *      aujourd'hui / 48 h / plus tard), puis les devoirs groupés par urgence,
 *      les faits étant repliés au lieu d'encombrer ;
 *   3. les devoirs urgents (retard ou pour aujourd'hui) sont mis en avant deux
 *      fois : couleur de fond ET étiquette, jamais la couleur seule.
 *
 * La détection « fait » reste volontairement prudente : on lit une case cochée
 * ou un mot-clé évident. Mieux vaut ne rien marquer que d'annoncer à un élève
 * que son devoir est fait alors qu'il ne l'est pas.
 */
(() => {
  const EDP = globalThis.EDP;
  const { daysUntil } = EDP.utils;
  const ui = () => EDP.ui;

  const CLASS_LATE = 'edp-late';
  const CLASS_TODAY = 'edp-today';
  const CLASS_SOON = 'edp-soon';
  const CLASS_DONE = 'edp-done';
  const CLASS_URGENT = 'edp-urgent';

  /** Fenêtre de « bientôt », en jours. */
  const SOON_DAYS = 2;

  /** Classe chaque devoir selon son échéance. */
  function classify(entries) {
    const now = new Date();
    const items = entries.map((entry) => {
      const days = entry.due ? daysUntil(entry.due, now) : null;
      return {
        ...entry,
        days,
        late: days !== null && days < 0 && !entry.done,
        today: days === 0 && !entry.done,
        soon: days !== null && days > 0 && days <= SOON_DAYS && !entry.done
      };
    });
    return {
      items,
      late: items.filter((item) => item.late),
      today: items.filter((item) => item.today),
      soon: items.filter((item) => item.soon),
      done: items.filter((item) => item.done),
      later: items.filter((item) => !item.done && !item.late && !item.today && !item.soon)
    };
  }

  /** État d'un devoir, du plus urgent au moins urgent. */
  function stateOf(item) {
    if (item.done) return 'done';
    if (item.late) return 'late';
    if (item.today) return 'today';
    if (item.soon) return 'soon';
    return 'later';
  }

  /** Étiquette courte posée devant la ligne, sur la page. */
  function statusText(item) {
    if (item.done) return 'fait';
    if (item.days === null) return 'à faire';
    if (item.days < 0) return item.days === -1 ? 'en retard · hier' : `en retard · ${-item.days} j`;
    if (item.days === 0) return 'aujourd’hui';
    if (item.days === 1) return 'demain';
    if (item.days <= SOON_DAYS) return `dans ${item.days} j`;
    return '';
  }

  function markPage(items) {
    const touched = [];

    items.forEach((item) => {
      const row = item.row;
      if (!row) return;

      const stateName = stateOf(item);
      const classes = [];
      if (stateName === 'done') classes.push(CLASS_DONE);
      else if (stateName === 'late') classes.push(CLASS_LATE, CLASS_URGENT);
      else if (stateName === 'today') classes.push(CLASS_TODAY, CLASS_URGENT);
      else if (stateName === 'soon') classes.push(CLASS_SOON);

      if (!classes.length) return;

      classes.forEach((name) => row.classList.add(name));

      // Une ligne de tableau : l'étiquette va sur la première cellule (voir le
      // commentaire équivalent dans timetable.js). Un <li> : sur lui-même.
      const cell = row.tagName === 'TR' ? (row.cells && row.cells[0]) || row.querySelector('td, th') : row;
      if (cell) {
        cell.dataset.edpState = stateName;
        cell.dataset.edpStatus = statusText(item);
      }

      touched.push({ row, classes, cell });
    });

    return () => {
      touched.forEach(({ row, classes, cell }) => {
        classes.forEach((name) => row.classList.remove(name));
        if (cell) {
          delete cell.dataset.edpState;
          delete cell.dataset.edpStatus;
        }
      });
    };
  }

  /** « hier », « aujourd'hui », « dans 2 j » : l'échéance en une pastille. */
  function dueLabel(item) {
    if (item.done) return 'fait';
    if (item.days === null) return null;
    if (item.days < 0) return item.days === -1 ? 'hier' : `il y a ${-item.days} j`;
    if (item.days === 0) return 'aujourd’hui';
    if (item.days === 1) return 'demain';
    return `dans ${item.days} j`;
  }

  /** Ligne du panneau : pastille d'état, matière, intitulé, échéance. */
  function taskItem(item) {
    const tone = stateOf(item);
    const due = dueLabel(item);

    return ui().el('div', { class: 'edp-task', dataset: { tone } }, [
      ui().el('span', { class: 'edp-task__mark', 'aria-hidden': 'true' }, [tone === 'done' ? '✓' : '']),
      ui().el('span', { class: 'edp-task__body' }, [
        ui().el('span', { class: 'edp-task__subject', text: item.subject }),
        ui().el('span', { class: 'edp-task__label', text: item.label.slice(0, 120) })
      ]),
      due ? ui().el('span', { class: 'edp-chip', dataset: { tone }, text: due }) : null
    ]);
  }

  /**
   * Barre segmentée : la part de chaque état dans le travail affiché.
   * `flexGrow` est une donnée, pas une couleur — le CSS garde la main sur
   * l'apparence de chaque segment.
   */
  function progressMeter(buckets) {
    const total = buckets.items.length;
    const parts = [
      ['done', buckets.done.length],
      ['late', buckets.late.length],
      ['today', buckets.today.length],
      ['soon', buckets.soon.length],
      ['later', buckets.later.length]
    ].filter(([, count]) => count > 0);

    const percent = total ? Math.round((buckets.done.length / total) * 100) : 0;
    const bar = ui().el('div', {
      class: 'edp-meter',
      role: 'img',
      'aria-label': `${percent} % des devoirs affichés marqués faits (${buckets.done.length} sur ${total})`
    });

    parts.forEach(([tone, count]) => {
      const segment = ui().el('span', { class: 'edp-meter__seg', dataset: { tone } });
      segment.style.flexGrow = String(count);
      bar.appendChild(segment);
    });

    return bar;
  }

  /** Groupe « En retard », « Aujourd'hui »… avec son compte dans le titre. */
  function group(title, tone, items) {
    if (!items.length) return null;
    const wrapper = ui().el('div', { class: 'edp-group' });
    wrapper.appendChild(ui().note(`${title} (${items.length})`, tone));
    items.forEach((item) => wrapper.appendChild(taskItem(item)));
    return wrapper;
  }

  function renderCard(ctx, buckets) {
    const body = ctx.panel.slot('homework', 'Cahier de textes');
    body.textContent = '';

    const total = buckets.items.length;
    const percent = total ? Math.round((buckets.done.length / total) * 100) : 0;

    const card = ui().card({
      title: 'À faire',
      hint: `${buckets.done.length}/${total} marqué(s) fait(s) · tri par urgence`
    });

    card.body.appendChild(
      ui().row([
        ui().stat({
          label: 'En retard',
          value: String(buckets.late.length),
          tone: buckets.late.length ? 'negative' : 'neutral'
        }),
        ui().stat({
          label: 'Aujourd’hui',
          value: String(buckets.today.length),
          tone: buckets.today.length ? 'warning' : 'neutral'
        }),
        ui().stat({ label: 'Sous 48 h', value: String(buckets.soon.length), tone: 'warning' }),
        ui().stat({ label: 'Faits', value: `${percent} %`, tone: 'positive' })
      ])
    );

    card.body.appendChild(progressMeter(buckets));

    [
      group('En retard', 'negative', buckets.late),
      group('Pour aujourd’hui', 'accent', buckets.today),
      group('Dans les 48 heures', 'warning', buckets.soon),
      group('Plus tard', 'muted', buckets.later)
    ].forEach((node) => {
      if (node) card.body.appendChild(node);
    });

    // Les devoirs faits restent consultables, mais repliés : ils ne doivent pas
    // repousser ce qui reste à faire hors de l'écran.
    if (buckets.done.length) {
      const doneList = ui().el('div', { class: 'edp-group' });
      buckets.done.forEach((item) => doneList.appendChild(taskItem(item)));
      card.body.appendChild(ui().details(`${buckets.done.length} devoir(s) fait(s)`, doneList));
    }

    if (!buckets.late.length && !buckets.today.length && !buckets.soon.length && !buckets.later.length) {
      card.body.appendChild(ui().muted('Rien à faire d’ici là sur cet écran.'));
    }
    if (!buckets.items.some((item) => item.due)) {
      card.body.appendChild(
        ui().muted('Aucune date d’échéance lisible : le site groupe peut-être les devoirs par jour, voir le README.')
      );
    }

    return card;
  }

  function mount(ctx) {
    const source = EDP.data.sourceDom;
    if (!source || !source.homeworkRows) return null;
    const entries = source.homeworkRows();
    if (!entries.length) return null;

    const buckets = classify(entries);
    const cleanupMark = markPage(buckets.items);
    renderCard(ctx, buckets);

    return {
      destroy() {
        cleanupMark();
        ctx.panel.clear('homework');
      }
    };
  }

  EDP.registry.registerFeature({
    id: 'homework',
    label: 'Cahier de textes',
    settingKey: 'homework',
    detect: (ctx) => {
      const source = EDP.data.sourceDom;
      if (!source || !source.homeworkRows) return false;
      return source.homeworkRows().length > 0 && ctx.route !== EDP.ROUTES.NOTES;
    },
    mount,
    snapshot: () => {
      const source = EDP.data.sourceDom;
      if (!source || !source.homeworkRows) return null;
      const buckets = classify(source.homeworkRows());
      return {
        late: buckets.late.length,
        today: buckets.today.length,
        soon: buckets.soon.length,
        done: buckets.done.length,
        total: buckets.items.length,
        next: buckets.late
          .concat(buckets.today, buckets.soon)
          .slice(0, 3)
          .map((item) => ({
            subject: item.subject,
            label: item.label.slice(0, 80),
            due: item.due ? item.due.toISOString() : null
          }))
      };
    }
  });
})();
