'use strict';
/**
 * content/features/homework.js
 * --------------------------
 * Cahier de textes utilisable : « qu'est-ce que je dois faire, et pour quand ? »
 *
 *   1. sur la page : marque les devoirs en retard (edp-late) et ceux des
 *      prochaines 48 heures (edp-soon) ;
 *   2. dans le panneau : liste « en retard », « aujourd'hui », « bientôt ».
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
  const CLASS_SOON = 'edp-soon';
  const CLASS_DONE = 'edp-done';

  /** Classe chaque devoir selon son échéance. */
  function classify(entries) {
    const now = new Date();
    const items = entries.map((entry) => {
      const days = entry.due ? daysUntil(entry.due, now) : null;
      return { ...entry, days, late: days !== null && days < 0 && !entry.done };
    });
    return {
      items,
      late: items.filter((item) => item.late),
      today: items.filter((item) => item.days === 0 && !item.done),
      soon: items.filter((item) => item.days !== null && item.days > 0 && item.days <= 2 && !item.done),
      done: items.filter((item) => item.done)
    };
  }

  function markPage(items, buckets) {
    const touched = [];
    items.forEach((item) => {
      const classes = [];
      if (item.done) classes.push(CLASS_DONE);
      else if (item.late) classes.push(CLASS_LATE);
      else if (item.days !== null && item.days >= 0 && item.days <= 2) classes.push(CLASS_SOON);
      if (!classes.length) return;
      classes.forEach((name) => item.row.classList.add(name));
      touched.push({ row: item.row, classes });
    });
    return () => {
      touched.forEach(({ row, classes }) => classes.forEach((name) => row.classList.remove(name)));
    };
  }

  function renderCard(ctx, buckets) {
    const body = ctx.panel.slot('homework', 'Cahier de textes');
    const card = ui().card({ title: 'À faire', hint: 'Tri par échéance, retards en premier' });

    card.body.appendChild(
      ui().row([
        ui().stat({
          label: 'En retard',
          value: String(buckets.late.length),
          tone: buckets.late.length ? 'negative' : 'neutral'
        }),
        ui().stat({ label: "Aujourd'hui", value: String(buckets.today.length), tone: 'accent' }),
        ui().stat({ label: 'Sous 48 h', value: String(buckets.soon.length), tone: 'warning' })
      ])
    );

    const describe = (item) =>
      `${item.subject} — ${item.label.slice(0, 70)}${item.due ? ` (${item.due.toLocaleDateString('fr-FR')})` : ''}`;

    if (buckets.late.length) {
      card.body.appendChild(ui().note('Travail en retard', 'negative'));
      card.body.appendChild(ui().list(buckets.late.map(describe)));
    }
    if (buckets.today.length) {
      card.body.appendChild(ui().note('Pour aujourd’hui', 'accent'));
      card.body.appendChild(ui().list(buckets.today.map(describe)));
    }
    if (buckets.soon.length) {
      card.body.appendChild(ui().note('Dans les 48 heures', 'warning'));
      card.body.appendChild(ui().list(buckets.soon.map(describe)));
    }
    if (!buckets.late.length && !buckets.today.length && !buckets.soon.length) {
      card.body.appendChild(ui().muted('Rien d’urgent détecté sur cet écran.'));
    }
    if (!buckets.items.some((item) => item.due)) {
      card.body.appendChild(
        ui().muted('Aucune date d’échéance lisible : le site groupe peut-être les devoirs par jour, voir le README.')
      );
    }

    body.appendChild(card.root);
    return card;
  }

  function mount(ctx) {
    const source = EDP.data.sourceDom;
    if (!source || !source.homeworkRows) return null;
    const entries = source.homeworkRows();
    if (!entries.length) return null;

    const buckets = classify(entries);
    const cleanupMark = markPage(buckets.items, buckets);
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
