'use strict';
/**
 * content/features/grades.js
 * -------------------------
 * Refonte de l'affichage des notes.
 *
 * Sur l'écran Notes, les tableaux du site sont MASQUÉS (jamais supprimés) et
 * remplacés par un relevé unique, construit à partir des notes normalisées
 * (content/data/model.js) :
 *
 *   - en-tête : moyenne générale mise en avant, jauge, classe, compteurs ;
 *   - barre d'outils : filtres (toutes / comptées / hors moyenne / absences),
 *     filtre par matière, recherche, et six ordres de tri ;
 *   - tableau : une ligne par évaluation, pastille de note colorée selon le
 *     palier (≥ 15, 10–15, < 10), note ramenée sur 20 quand le barème diffère,
 *     moyenne de la matière rappelée sous son nom, écart à la classe, statut.
 *
 * Compatibilité avec le simulateur : les hypothèses enregistrées
 * (`edp.simulation`) sont relues et passées au MÊME moteur de calcul
 * (`EDP.averages.simulateAll`). La moyenne simulée apparaît dans l'en-tête et,
 * matière par matière, sous le nom de la matière — rien n'est inventé, rien
 * n'est envoyé nulle part. Le bouton « Simuler une note » ouvre le simulateur
 * déjà monté dans le panneau.
 *
 * Règles de sûreté (identiques au tableau de bord) :
 *   - on ne supprime rien : les tableaux d'origine sont marqués
 *     `data-edp-native-grades` puis masqués par styles/features/grades.css,
 *     et restitués tels quels au démontage ;
 *   - s'il n'y a aucun tableau à remplacer, la vue n'est pas montée ;
 *   - tout vit dans un shadow root : les styles du site ne peuvent pas la
 *     déformer, et elle hérite des variables de thème posées sur <html>.
 *
 * Aucune couleur en dur, aucun innerHTML : le DOM est construit avec
 * `EDP.ui.el` (createElement + textContent).
 */
(() => {
  const EDP = globalThis.EDP;
  const { formatFr, formatDelta } = EDP.utils;
  /** Accès paresseux : ui/components.js est chargé après ce fichier. */
  const ui = () => EDP.ui;

  const HOST_ID = 'edp-grades-host';
  const NATIVE_ATTR = 'data-edp-native-grades';

  /** Ordres de tri proposés. `value` est stocké tel quel dans l'état. */
  const SORTS = [
    { value: 'recent', label: 'Plus récentes' },
    { value: 'oldest', label: 'Plus anciennes' },
    { value: 'best', label: 'Meilleures notes' },
    { value: 'worst', label: 'Notes les plus basses' },
    { value: 'subject', label: 'Par matière' },
    { value: 'coefficient', label: 'Coefficient le plus élevé' }
  ];

  /** Filtres rapides (pastilles de la barre d'outils). */
  const FILTERS = [
    { value: 'all', label: 'Toutes' },
    { value: 'counted', label: 'Comptées' },
    { value: 'excluded', label: 'Hors moyenne' },
    { value: 'absent', label: 'Absences' }
  ];

  /**
   * État de l'interface. Conservé au niveau du module : un changement d'écran
   * suivi d'un retour aux notes retrouve le tri et les filtres choisis.
   */
  const view = {
    sort: 'recent',
    filter: 'all',
    subject: 'all',
    query: ''
  };

  // ---------------------------------------------------------------------------
  // Formatage et classement
  // ---------------------------------------------------------------------------

  /** Nombre de décimales utiles : 13 -> 0, 13,5 -> 1, 13,33 -> 2. */
  function digitsFor(value) {
    if (!Number.isFinite(value) || Number.isInteger(value)) return 0;
    return Math.round(value * 10) === value * 10 ? 1 : 2;
  }

  /** Date courte française (jj/mm/aa), chaîne vide si inconnue. */
  function formatDate(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    try {
      return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });
    } catch (error) {
      return '';
    }
  }

  /** Palier de lecture d'une note (voir --edp-grade-* dans tokens.css). */
  function toneForGrade(grade) {
    if (!Number.isFinite(grade.value20) || !grade.counted) return 'muted';
    if (grade.value20 >= 15) return 'high';
    if (grade.value20 >= 10) return 'mid';
    return 'low';
  }

  /** Palier d'une moyenne. */
  function toneForAverage(average) {
    if (!Number.isFinite(average)) return 'muted';
    if (average >= 15) return 'high';
    if (average >= 10) return 'mid';
    return 'low';
  }

  /**
   * Compare deux nombres en laissant TOUJOURS les valeurs inconnues en fin de
   * liste : une note sans valeur ne doit pas se retrouver en tête d'un tri
   * « meilleures notes ».
   */
  function compareNumbers(left, right, direction = 1) {
    const a = Number.isFinite(left) ? left : null;
    const b = Number.isFinite(right) ? right : null;
    if (a === null && b === null) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    return direction * (a - b);
  }

  function timeOf(grade) {
    return grade && grade.date instanceof Date ? grade.date.getTime() : null;
  }

  /** Applique l'ordre choisi, sans jamais modifier le tableau d'origine. */
  function sortGrades(grades) {
    const list = grades.slice();
    const byDateDesc = (a, b) => compareNumbers(timeOf(b), timeOf(a));

    switch (view.sort) {
      case 'oldest':
        return list.sort((a, b) => compareNumbers(timeOf(a), timeOf(b)));
      case 'best':
        return list.sort((a, b) => compareNumbers(b.value20, a.value20));
      case 'worst':
        return list.sort((a, b) => compareNumbers(a.value20, b.value20));
      case 'subject':
        return list.sort(
          (a, b) => String(a.subject).localeCompare(String(b.subject), 'fr') || byDateDesc(a, b)
        );
      case 'coefficient':
        return list.sort(
          (a, b) => compareNumbers(b.coefficient, a.coefficient) || byDateDesc(a, b)
        );
      default:
        return list.sort(byDateDesc);
    }
  }

  /** Une note passe-t-elle le filtre rapide courant ? */
  function matchesFilter(grade) {
    switch (view.filter) {
      case 'counted':
        return grade.counted === true;
      case 'excluded':
        return grade.counted !== true && grade.value20 !== null;
      case 'absent':
        return grade.value20 === null || grade.status === EDP.GRADE_STATUS.ABSENT;
      default:
        return true;
    }
  }

  function matchesSubject(grade) {
    return view.subject === 'all' || grade.subjectKey === view.subject;
  }

  function matchesQuery(grade) {
    const query = view.query.trim().toLowerCase();
    if (!query) return true;
    return `${grade.subject} ${grade.label}`.toLowerCase().includes(query);
  }

  /** Étiquette de statut d'une note (null quand elle compte normalement). */
  function statusOf(grade) {
    if (grade.status === EDP.GRADE_STATUS.ABSENT || grade.value20 === null) {
      return { text: 'Absent', tone: 'muted' };
    }
    if (grade.status === EDP.GRADE_STATUS.NON_SIGNIFICANT) {
      return { text: 'Non significative', tone: 'muted' };
    }
    if (grade.counted !== true) return { text: 'Hors moyenne', tone: 'muted' };
    return null;
  }

  // ---------------------------------------------------------------------------
  // Données dérivées
  // ---------------------------------------------------------------------------

  /** Index des matières calculées (moyenne, coefficient, exclusion). */
  function subjectIndex(data) {
    const map = new Map();
    (Array.isArray(data.subjects) ? data.subjects : []).forEach((subject) => {
      if (subject && subject.key) map.set(subject.key, subject);
    });
    return map;
  }

  /** Moyennes simulées par matière, quand des hypothèses existent. */
  function simulatedIndex(simulation) {
    const map = new Map();
    if (!simulation || !Array.isArray(simulation.subjects)) return map;
    simulation.subjects.forEach((subject) => {
      if (subject && subject.key && Number.isFinite(subject.simulatedAverage20)) {
        map.set(subject.key, subject.simulatedAverage20);
      }
    });
    return map;
  }

  /** Relit une hypothèse du simulateur : une valeur corrompue est écartée. */
  function sanitizeScenario(raw) {
    if (!raw || typeof raw.subjectKey !== 'string' || !raw.subjectKey) return null;
    const value = Number(raw.value);
    const outOf = Number(raw.outOf);
    const coefficient = Number(raw.coefficient);
    if (!Number.isFinite(value) || !Number.isFinite(outOf) || outOf <= 0) return null;
    return {
      subjectKey: raw.subjectKey,
      value,
      outOf,
      coefficient: Number.isFinite(coefficient) && coefficient > 0 ? coefficient : 1
    };
  }

  // ---------------------------------------------------------------------------
  // Feuille de style du shadow root
  // ---------------------------------------------------------------------------

  async function adoptStyles(shadow) {
    try {
      const response = await fetch(EDP.API.runtime.getURL('styles/components/grades.css'));
      if (!response.ok) return;
      const css = await response.text();
      if (!css) return;

      if (typeof CSSStyleSheet === 'function' && 'adoptedStyleSheets' in shadow) {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(css);
        shadow.adoptedStyleSheets = [sheet];
        return;
      }
      const style = document.createElement('style');
      style.textContent = css;
      shadow.appendChild(style);
    } catch (error) {
      console.debug('[ED+] feuille du relevé de notes illisible :', error);
    }
  }

  // ---------------------------------------------------------------------------
  // Vue principale
  // ---------------------------------------------------------------------------

  async function mountView(ctx) {
    const source = EDP.data && EDP.data.sourceDom;
    const tablesOf = () =>
      source && typeof source.gradeTables === 'function' ? source.gradeTables() : [];

    const tables = tablesOf();
    if (!tables.length) return null;

    let data = EDP.data.get() || ctx.data || {};
    let scenarios = [];
    let simulation = null;

    const host = document.createElement('div');
    host.id = HOST_ID;
    const shadow = host.attachShadow({ mode: 'open' });
    await adoptStyles(shadow);

    // --- Coquille : construite une fois, seuls les contenus varient ---------
    const refs = {
      summary: ui().el('div', { class: 'edp-grades__summary' }),
      chips: ui().el('div', {
        class: 'edp-grades__chips',
        role: 'group',
        'aria-label': 'Filtrer les notes'
      }),
      sort: null,
      subject: null,
      search: null,
      body: ui().el('tbody'),
      count: ui().el('span', { class: 'edp-grades__count' }),
      notices: ui().el('div', { class: 'edp-grades__notices' }),
      foot: ui().el('p', { class: 'edp-grades__foot' })
    };

    FILTERS.forEach((filter) => {
      refs.chips.appendChild(
        ui().el(
          'button',
          {
            type: 'button',
            class: 'edp-grades__chip',
            dataset: { filter: filter.value },
            onclick: () => {
              view.filter = filter.value;
              render();
            }
          },
          [filter.label]
        )
      );
    });

    refs.sort = ui().el(
      'select',
      {
        class: 'edp-grades__select',
        'aria-label': 'Trier les notes',
        onchange: (event) => {
          view.sort = event.target.value;
          render();
        }
      },
      SORTS.map((sort) => ui().el('option', { value: sort.value }, [sort.label]))
    );
    refs.sort.value = view.sort;

    refs.subject = ui().el('select', {
      class: 'edp-grades__select',
      'aria-label': 'Filtrer par matière',
      onchange: (event) => {
        view.subject = event.target.value;
        render();
      }
    });

    refs.search = ui().el('input', {
      class: 'edp-grades__search',
      type: 'search',
      placeholder: 'Rechercher une matière, une évaluation…',
      'aria-label': 'Rechercher une note',
      oninput: (event) => {
        view.query = event.target.value;
        render();
      }
    });
    refs.search.value = view.query;

    function openSimulator() {
      if (!ctx.panel || typeof ctx.panel.reveal !== 'function') return;
      const opened = ctx.panel.reveal('simulator');
      if (!opened) console.debug('[ED+] simulateur non monté sur cet écran.');
    }

    const head = ui().el('header', { class: 'edp-grades__head' }, [
      ui().el('div', { class: 'edp-grades__titles' }, [
        ui().el('p', { class: 'edp-grades__eyebrow', text: 'Notes' }),
        ui().el('h2', { class: 'edp-grades__title', text: 'Relevé de notes' }),
        ui().el('p', {
          class: 'edp-grades__subtitle',
          text: 'Toutes vos notes, triées et filtrées. Calcul local, rien n’est transmis.'
        })
      ]),
      ui().el(
        'button',
        { type: 'button', class: 'edp-grades__action', onclick: openSimulator },
        ['Simuler une note']
      )
    ]);

    const toolbar = ui().el('div', { class: 'edp-grades__toolbar' }, [
      refs.chips,
      ui().el('div', { class: 'edp-grades__controls' }, [refs.search, refs.subject, refs.sort])
    ]);

    const table = ui().el('table', { class: 'edp-grades__table' }, [
      ui().el('thead', {}, [
        ui().el('tr', {}, [
          ui().el('th', { scope: 'col', text: 'Évaluation' }),
          ui().el('th', { scope: 'col', text: 'Matière' }),
          ui().el('th', { scope: 'col', class: 'edp-grades__col-coef', text: 'Coef.' }),
          ui().el('th', { scope: 'col', class: 'edp-grades__col-value', text: 'Note' }),
          ui().el('th', { scope: 'col', class: 'edp-grades__col-class', text: 'Classe' }),
          ui().el('th', { scope: 'col', class: 'edp-grades__col-status', text: 'Statut' })
        ])
      ]),
      refs.body
    ]);

    const root = ui().el('section', { class: 'edp-grades' }, [
      head,
      refs.summary,
      toolbar,
      ui().el('div', { class: 'edp-grades__tablewrap' }, [table]),
      ui().el('div', { class: 'edp-grades__aftertable' }, [refs.count, refs.notices]),
      refs.foot
    ]);
    shadow.appendChild(root);

    // --- Rendu des contenus -------------------------------------------------

    function kpi(label, value, hint, tone = 'neutral') {
      return ui().el('div', { class: 'edp-grades__kpi' }, [
        ui().el('span', { class: 'edp-grades__kpi-label', text: label }),
        ui().el('span', { class: 'edp-grades__kpi-value', dataset: { tone }, text: value }),
        hint ? ui().el('span', { class: 'edp-grades__kpi-hint', text: hint }) : null
      ]);
    }

    function renderSummary(grades) {
      const general = data.general || {};
      const average = Number.isFinite(general.average20) ? general.average20 : null;
      const classAverage = Number.isFinite(data.classGeneral) ? data.classGeneral : null;
      const counted = grades.filter((grade) => grade.counted).length;
      const tone = toneForAverage(average);

      const meter = ui().el('div', { class: 'edp-grades__meter' }, [
        ui().el('span', { class: 'edp-grades__meter-fill', dataset: { tone } })
      ]);
      meter.firstChild.style.width =
        average === null ? '0%' : `${Math.max(0, Math.min(100, (average / 20) * 100))}%`;

      const metaParts = [];
      if (general.subjectsUsed) {
        metaParts.push(`${general.subjectsUsed} matière${general.subjectsUsed > 1 ? 's' : ''}`);
      }
      metaParts.push(`${counted} note${counted > 1 ? 's' : ''} comptée${counted > 1 ? 's' : ''}`);
      if (data.period) metaParts.push(data.period);

      refs.summary.textContent = '';
      refs.summary.appendChild(
        ui().el('div', { class: 'edp-grades__hero' }, [
          ui().el('p', { class: 'edp-grades__hero-label', text: 'Moyenne générale' }),
          ui().el('p', { class: 'edp-grades__hero-value', dataset: { tone } }, [
            ui().el('strong', { text: average === null ? '—' : formatFr(average) }),
            ui().el('span', { class: 'edp-grades__hero-scale', text: '/20' })
          ]),
          meter,
          ui().el('p', { class: 'edp-grades__hero-meta', text: metaParts.join(' · ') })
        ])
      );

      const kpis = ui().el('div', { class: 'edp-grades__kpis' });
      const gap = average !== null && classAverage !== null ? average - classAverage : null;
      kpis.appendChild(
        kpi(
          'Moyenne de la classe',
          classAverage === null ? '—' : formatFr(classAverage),
          gap === null
            ? 'non affichée sur cette page'
            : `${formatDelta(gap)} par rapport à vous`,
          gap === null ? 'neutral' : gap > 0 ? 'positive' : gap < 0 ? 'negative' : 'neutral'
        )
      );
      kpis.appendChild(
        kpi(
          'Notes retenues',
          `${counted}/${grades.length}`,
          'dans la moyenne générale'
        )
      );

      const simulated =
        simulation && simulation.simulated && Number.isFinite(simulation.simulated.general.average20)
          ? simulation.simulated.general.average20
          : null;
      if (simulated !== null) {
        kpis.appendChild(
          kpi(
            'Moyenne simulée',
            formatFr(simulated),
            simulation.delta === null
              ? 'hypothèses prises en compte'
              : `${formatDelta(simulation.delta)} d’écart`,
            simulation.delta === null ? 'accent' : simulation.delta > 0 ? 'positive' : simulation.delta < 0 ? 'negative' : 'accent'
          )
        );
      } else {
        kpis.appendChild(
          kpi(
            'Écart à la classe',
            gap === null ? '—' : formatDelta(gap),
            gap === null ? '—' : 'points sur 20'
          )
        );
      }

      refs.summary.appendChild(kpis);
    }

    function buildRow(grade, subjects, simulated) {
      const tone = toneForGrade(grade);
      const status = statusOf(grade);
      const subject = subjects.get(grade.subjectKey);
      const dateText = formatDate(grade.date);

      const subjectMeta = ui().el('span', { class: 'edp-grades__subject-meta' });
      if (subject && Number.isFinite(subject.average20)) {
        subjectMeta.appendChild(
          ui().el('span', { text: `moy. ${formatFr(subject.average20)}` })
        );
      }
      if (subject && subject.excluded) {
        subjectMeta.appendChild(ui().el('span', { class: 'edp-grades__subject-flag', text: 'exclue' }));
      }
      const simulatedAverage = simulated.get(grade.subjectKey);
      if (Number.isFinite(simulatedAverage)) {
        subjectMeta.appendChild(
          ui().el('span', {
            class: 'edp-grades__subject-sim',
            text: `simulé ${formatFr(simulatedAverage)}`
          })
        );
      }

      const valueCell = ui().el('td', { class: 'edp-grades__cell-value' }, [
        ui().el('span', { class: 'edp-grade', dataset: { tone } }, [
          ui().el('strong', {
            class: 'edp-grade__value',
            text: grade.value === null ? '—' : formatFr(grade.value, digitsFor(grade.value))
          }),
          ui().el('span', { class: 'edp-grade__scale', text: `/${formatFr(grade.outOf, 0)}` })
        ])
      ]);
      // Barème ≠ 20 : on rappelle l'équivalent sur 20, sans le confondre avec
      // la note réellement affichée par le site.
      if (grade.outOf !== 20 && Number.isFinite(grade.value20)) {
        valueCell.appendChild(
          ui().el('span', { class: 'edp-grade__equiv', text: `soit ${formatFr(grade.value20)}/20` })
        );
      }

      const classCell = ui().el('td', { class: 'edp-grades__cell-class' });
      if (Number.isFinite(grade.classAverage) && Number.isFinite(grade.value20)) {
        classCell.appendChild(
          ui().el('span', { class: 'edp-grades__class-value', text: formatFr(grade.classAverage) })
        );
        classCell.appendChild(ui().delta(grade.value20 - grade.classAverage));
      } else {
        classCell.appendChild(ui().el('span', { class: 'edp-grades__muted', text: '—' }));
      }

      return ui().el('tr', { class: 'edp-grades__row', dataset: { tone } }, [
        ui().el('td', { class: 'edp-grades__cell-work' }, [
          ui().el('span', { class: 'edp-grades__work', text: grade.label }),
          dateText ? ui().el('span', { class: 'edp-grades__date', text: dateText }) : null
        ]),
        ui().el('td', { class: 'edp-grades__cell-subject' }, [
          ui().el('span', { class: 'edp-grades__subject', text: grade.subject }),
          subjectMeta.childNodes.length ? subjectMeta : null
        ]),
        ui().el('td', {
          class: 'edp-grades__cell-coef',
          text: formatFr(grade.coefficient, digitsFor(grade.coefficient))
        }),
        valueCell,
        classCell,
        ui().el('td', { class: 'edp-grades__cell-status' }, [
          status
            ? ui().el('span', {
                class: 'edp-grades__status',
                dataset: { tone: status.tone },
                text: status.text
              })
            : null
        ])
      ]);
    }

    /** Options du filtre par matière : triées, sans doublon, choix conservé. */
    function refreshSubjects() {
      const subjects = Array.isArray(data.subjects) ? data.subjects.slice() : [];
      subjects.sort((a, b) => String(a.name).localeCompare(String(b.name), 'fr'));

      const signature = subjects.map((subject) => `${subject.key}|${subject.name}`).join('§');
      if (signature === refreshSubjects.signature) return;
      refreshSubjects.signature = signature;

      refs.subject.textContent = '';
      refs.subject.appendChild(ui().el('option', { value: 'all' }, ['Toutes les matières']));
      subjects.forEach((subject) => {
        refs.subject.appendChild(
          ui().el('option', { value: subject.key }, [subject.name])
        );
      });
      const available = subjects.some((subject) => subject.key === view.subject);
      if (!available) view.subject = 'all';
      refs.subject.value = view.subject;
    }

    function render() {
      const grades = Array.isArray(data.grades) ? data.grades : [];
      const subjects = subjectIndex(data);
      const simulated = simulatedIndex(simulation);

      const visible = sortGrades(grades.filter(matchesFilter).filter(matchesSubject).filter(matchesQuery));

      renderSummary(grades);
      refreshSubjects();

      refs.body.textContent = '';
      if (!visible.length) {
        refs.body.appendChild(
          ui().el('tr', { class: 'edp-grades__empty-row' }, [
            ui().el('td', { colspan: '6', class: 'edp-grades__empty' }, [
              grades.length
                ? 'Aucune note ne correspond à ces filtres.'
                : 'Aucune note lisible sur cette page.'
            ])
          ])
        );
      } else {
        visible.forEach((grade) => refs.body.appendChild(buildRow(grade, subjects, simulated)));
      }

      Array.from(refs.chips.children).forEach((chip) => {
        const active = chip.dataset.filter === view.filter;
        chip.dataset.active = active ? '1' : '0';
        chip.setAttribute('aria-pressed', active ? 'true' : 'false');
      });

      refs.count.textContent = `${visible.length} note${visible.length > 1 ? 's' : ''} affichée${
        visible.length > 1 ? 's' : ''
      } sur ${grades.length}`;

      refs.notices.textContent = '';
      const warnings = Array.isArray(data.warnings) ? data.warnings : [];
      if (warnings.length) {
        refs.notices.appendChild(
          ui().el('details', { class: 'edp-grades__details' }, [
            ui().el('summary', {
              class: 'edp-grades__details-summary',
              text: `${warnings.length} point(s) à vérifier`
            }),
            ui().el(
              'ul',
              { class: 'edp-grades__details-list' },
              warnings.map((warning) => ui().el('li', { text: warning }))
            )
          ])
        );
      }

      refs.foot.textContent = `Source : ${
        data.source === 'api' ? 'API du site' : 'page affichée'
      } · calcul local${simulation ? ' · hypothèses du simulateur incluses' : ''}`;
    }

    // --- Simulation ---------------------------------------------------------

    function computeSimulation() {
      simulation = null;
      if (!scenarios.length || !EDP.averages || !Array.isArray(data.subjects)) return;
      try {
        simulation = EDP.averages.simulateAll(data, scenarios, ctx.settings || data.settings || {});
      } catch (error) {
        console.debug('[ED+] simulation impossible à calculer :', error);
        simulation = null;
      }
    }

    async function loadSimulation() {
      try {
        const stored = await EDP.settings.readKey(EDP.STORAGE_KEYS.simulation, null);
        const notes = stored && Array.isArray(stored.notes) ? stored.notes : [];
        scenarios = notes.map(sanitizeScenario).filter(Boolean);
      } catch (error) {
        console.debug('[ED+] hypothèses du simulateur illisibles :', error);
        scenarios = [];
      }
      computeSimulation();
      render();
    }

    // --- Marquage, insertion et repositionnement ----------------------------

    function markNative() {
      const list = tablesOf();
      list.forEach(({ table }) => {
        try {
          table.setAttribute(NATIVE_ATTR, '1');
        } catch (error) {
          /* table détachée entre-temps : sans importance */
        }
      });
      return list;
    }

    function isOurs(node) {
      if (!node || typeof node.closest !== 'function') return false;
      try {
        return Boolean(node.closest(`#${HOST_ID}, #edp-panel-host, [class*="edp-"]`));
      } catch (error) {
        return false;
      }
    }

    const anchor = tables[0].table;
    if (!anchor || !anchor.parentNode) return null;

    render();
    try {
      anchor.parentNode.insertBefore(host, anchor);
    } catch (error) {
      console.debug('[ED+] insertion du relevé de notes impossible :', error);
      return null;
    }
    markNative();
    document.documentElement.dataset.edpGrades = '1';

    // Les notes arrivent en Ajax : on se resynchronise à chaque collecte.
    const unsubscribe =
      EDP.data && typeof EDP.data.subscribe === 'function'
        ? EDP.data.subscribe((next) => {
            if (!next || !Array.isArray(next.grades) || !next.grades.length) return;
            data = next;
            computeSimulation();
            render();
          })
        : () => {};

    // Le simulateur écrit dans storage.local : on suit ses changements pour
    // garder la moyenne simulée à jour sans recharger la page.
    let stopStorage = () => {};
    try {
      if (EDP.API && EDP.API.storage && EDP.API.storage.onChanged) {
        const onChanged = (changes, areaName) => {
          if (areaName !== 'local' || !changes[EDP.STORAGE_KEYS.simulation]) return;
          loadSimulation();
        };
        EDP.API.storage.onChanged.addListener(onChanged);
        stopStorage = () => {
          try {
            EDP.API.storage.onChanged.removeListener(onChanged);
          } catch (error) {
            /* extension déchargée : rien à retirer */
          }
        };
      }
    } catch (error) {
      console.debug('[ED+] suivi du simulateur indisponible :', error);
    }

    // Le site remplace parfois son contenu : on garde notre bloc devant le
    // premier tableau de notes, et on marque les tableaux fraîchement créés.
    const stopWatch = EDP.dom.onDomChange(
      () => {
        const list = markNative();
        const first = list[0] && list[0].table;
        if (!first || !first.parentNode) return;
        if (host.parentNode === first.parentNode && host.nextElementSibling === first) return;
        try {
          first.parentNode.insertBefore(host, first);
        } catch (error) {
          console.debug('[ED+] relevé de notes : repositionnement impossible', error);
        }
      },
      { delay: 900, ignore: (node) => isOurs(node) }
    );

    loadSimulation();

    return {
      destroy() {
        unsubscribe();
        stopStorage();
        stopWatch();
        host.remove();
        EDP.dom.$$(`[${NATIVE_ATTR}="1"]`).forEach((node) => node.removeAttribute(NATIVE_ATTR));
        delete document.documentElement.dataset.edpGrades;
      }
    };
  }

  // ---------------------------------------------------------------------------
  // Carte du panneau
  // ---------------------------------------------------------------------------

  /**
   * Carte « Moyennes calculées » du tiroir : synthèse compacte (générale,
   * classe, notes comptées) et tableau matière par matière. Elle reste utile
   * même quand le relevé refondu n'est pas monté (autre écran avec notes).
   */
  function mountCard(ctx) {
    const { data } = ctx;
    if (!ctx.panel) return () => {};
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
        const classValues = subject.grades
          .map((grade) => grade.classAverage)
          .filter((value) => Number.isFinite(value));
        const classAverage = classValues.length
          ? classValues.reduce((total, value) => total + value, 0) / classValues.length
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

    body.appendChild(
      ui().muted(`Source : ${data.source === 'api' ? 'API du site' : 'page affichée'} · calcul local`)
    );

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
    // La refonte remplace l'écran Notes ; la carte du panneau suit la même
    // activation, puisqu'elle vit sur le même écran.
    detect: (ctx) =>
      ctx.route === EDP.ROUTES.NOTES &&
      Boolean(ctx.data && ctx.data.grades && ctx.data.grades.length),
    async mount(ctx) {
      const destroyView = await mountView(ctx);
      const destroyCard = mountCard(ctx);
      return {
        destroy() {
          if (destroyView) destroyView.destroy();
          destroyCard();
        }
      };
    },
    snapshot
  });
})();
