'use strict';
/**
 * content/features/grades.js
 * -------------------------
 * Cœur de la promesse : « ma moyenne, tout de suite ».
 *
 * Deux emplacements, volontairement :
 *   1. une carte dans le panneau : moyenne générale, moyenne par matière,
 *      comparaison avec la classe, et le détail de ce qui a été écarté ;
 *   2. une bande de résumé insérée JUSTE AVANT le tableau de notes du site,
 *      parce que c'est là que l'utilisateur regarde (et qu'un panneau qu'il faut
 *      penser à ouvrir ne sert à rien).
 */
(() => {
  const EDP = globalThis.EDP;
  const { formatFr, formatDelta } = EDP.utils;
  const ui = () => EDP.ui;

  const INLINE_ID = 'edp-inline-summary';
  const NOTES_TABLE_CLASS = 'edp-notes-table';

  /**
   * Bande de résumé insérée dans la page, devant le tableau de notes.
   * Au passage, on marque les tableaux de notes d'une classe dédiée : c'est ce
   * qui permet à styles/features/grades.css de les rendre plus lisibles SANS
   * toucher au reste de la page.
   */
  function mountInline(data) {
    const existing = document.getElementById(INLINE_ID);
    if (existing) existing.remove();

    if (!EDP.data.sourceDom || !EDP.data.sourceDom.gradeTables) return null;
    const tables = EDP.data.sourceDom.gradeTables();
    if (!tables.length) return null;

    tables.forEach(({ table }) => table.classList.add(NOTES_TABLE_CLASS));
    const target = tables[0].table;
    const strip = ui().el('div', { id: INLINE_ID, class: 'edp-inline-summary' });

    const average = data.general.average20;
    strip.appendChild(
      ui().stat({
        label: 'Moyenne calculée',
        value: average === null ? '—' : formatFr(average),
        hint: `${data.general.subjectsUsed} matière(s) · ${data.grades.filter((g) => g.counted).length} notes`,
        tone: 'accent'
      })
    );

    if (Number.isFinite(data.classGeneral)) {
      const gap = average === null ? null : average - data.classGeneral;
      strip.appendChild(
        ui().stat({
          label: 'Moyenne de la classe',
          value: formatFr(data.classGeneral),
          hint: gap === null ? null : `${formatDelta(gap)} par rapport à vous`,
          tone: ui().toneForDelta(gap)
        })
      );
    }

    const period = data.period ? ui().badge(data.period, 'neutral') : null;
    if (period) strip.appendChild(period);

    try {
      target.parentElement.insertBefore(strip, target);
    } catch (error) {
      console.debug('[ED+] insertion du résumé impossible :', error);
      tables.forEach(({ table }) => table.classList.remove(NOTES_TABLE_CLASS));
      return null;
    }
    return () => {
      const node = document.getElementById(INLINE_ID);
      if (node) node.remove();
      tables.forEach(({ table }) => table.classList.remove(NOTES_TABLE_CLASS));
    };
  }

  /** Carte du panneau. */
  function mountCard(ctx) {
    const { data } = ctx;
    const body = ctx.panel.slot('grades', 'Moyennes calculées');
    const average = data.general.average20;

    body.appendChild(
      ui().row([
        ui().stat({
          label: 'Moyenne générale',
          value: average === null ? '—' : formatFr(average),
          hint: data.period || null,
          tone: 'accent'
        }),
        Number.isFinite(data.classGeneral)
          ? ui().stat({
              label: 'Classe',
              value: formatFr(data.classGeneral),
              tone: ui().toneForDelta(average === null ? null : average - data.classGeneral)
            })
          : null,
        ui().stat({
          label: 'Notes prises en compte',
          value: String(data.grades.filter((grade) => grade.counted).length),
          hint: `${data.grades.length} au total`
        })
      ])
    );

    const rows = data.subjects
      .filter((subject) => subject.average20 !== null || subject.grades.length)
      .map((subject) => {
        const averageCell =
          subject.average20 === null
            ? ui().el('span', { class: 'edp-muted', text: '—' })
            : ui().el('strong', { text: formatFr(subject.average20) });
        const classCell = subject.grades
          .map((grade) => grade.classAverage)
          .filter((value) => Number.isFinite(value));
        const classAverage = classCell.length
          ? classCell.reduce((total, value) => total + value, 0) / classCell.length
          : null;
        return [
          subject.name,
          averageCell,
          formatFr(subject.coefficient, Number.isInteger(subject.coefficient) ? 0 : 1),
          String(subject.gradeCount || 0),
          Number.isFinite(classAverage)
            ? ui().delta(subject.average20 === null ? null : subject.average20 - classAverage)
            : ui().el('span', { class: 'edp-muted', text: '—' }),
          subject.excluded ? ui().badge('hors moyenne', 'muted') : null
        ];
      });

    body.appendChild(
      ui().table({ head: ['Matière', 'Moyenne', 'Coef.', 'Notes', 'Écart classe', ''], rows })
    );

    if (data.warnings.length) {
      body.appendChild(
        ui().details(
          `${data.warnings.length} point(s) à vérifier`,
          ui().list(data.warnings.map((warning) => ui().el('span', { text: warning })))
        )
      );
    }

    body.appendChild(ui().muted(`Source : ${data.source === 'api' ? 'API du site' : 'page affichée'} · calcul local`));

    return () => ctx.panel.clear('grades');
  }

  function snapshot(ctx) {
    const { data } = ctx;
    return {
      average20: data.general.average20,
      classAverage: Number.isFinite(data.classGeneral) ? data.classGeneral : null,
      subjectsUsed: data.general.subjectsUsed,
      period: data.period
    };
  }

  EDP.registry.registerFeature({
    id: 'grades',
    label: 'Moyennes calculées',
    settingKey: 'grades',
    detect: (ctx) => Boolean(ctx.data && ctx.data.grades && ctx.data.grades.length),
    mount(ctx) {
      const destroyInline = mountInline(ctx.data);
      const destroyCard = mountCard(ctx);
      return {
        destroy() {
          if (destroyInline) destroyInline();
          destroyCard();
        }
      };
    },
    snapshot
  });
})();
