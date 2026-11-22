'use strict';
/**
 * content/features/charts.js
 * --------------------------
 * Graphiques d'évolution des notes, affichés sous le relevé sur l'écran Notes :
 *
 *   - courbe de la moyenne générale (aire teintée + points datés) ;
 *   - courbes des moyennes par matière, avec une légende cliquable qui montre
 *     ou masque chaque matière ;
 *   - choix de la période : trimestre, année scolaire ou dates personnalisées ;
 *   - bouton « Masquer / Afficher les graphiques », mémorisé dans les réglages.
 *
 * POURQUOI PAS CHART.JS : le CSP d'une extension MV3 interdit tout script
 * distant, il faudrait donc embarquer Chart.js (~200 ko minifié) et sa feuille
 * pour dessiner deux courbes. Un <svg> construit ici suffit largement : il est
 * net à toutes les tailles, il hérite des variables de thème (donc du mode
 * clair/sombre et du préréglage de l'utilisateur), il ne dépend de rien et il
 * n'ajoute pas 200 ko à auditer par l'AMO. Les couleurs viennent uniquement de
 * styles/tokens.css (--edp-chart-1 à 6), et le tracé ne connaît aucune couleur.
 *
 * Règles de sûreté (les mêmes que le relevé de notes) :
 *   - rien n'est supprimé : l'hôte est inséré après le dernier tableau de notes
 *     du site, qui reste masqué par styles/features/grades.css ;
 *   - tout vit dans un shadow root : le site ne peut pas déformer les courbes ;
 *   - aucune donnée inventée : une période sans note datée affiche un état vide
 *     explicite, jamais une ligne plate à 0.
 *
 * Le calcul des séries est dans content/features/progress.js (code pur).
 */
(() => {
  const EDP = globalThis.EDP;
  const { formatFr } = EDP.utils;
  /** Accès paresseux : ui/components.js est chargé après ce fichier. */
  const ui = () => EDP.ui;

  const HOST_ID = 'edp-charts-host';
  const DAY = 24 * 60 * 60 * 1000;
  const PALETTE = 6;
  /** Matières affichées d'emblée : au-delà, la légende sert à choisir. */
  const DEFAULT_SERIES = 6;

  const PERIODS = [
    { value: 'trimester', label: 'Trimestre' },
    { value: 'year', label: 'Année' },
    { value: 'custom', label: 'Personnalisée' }
  ];

  /**
   * État de l'interface, conservé au niveau du module : un passage par l'emploi
   * du temps puis un retour aux notes retrouve la période et les matières
   * choisies.
   */
  const view = {
    period: 'trimester',
    from: '',
    to: '',
    hidden: new Set(),
    selectionReady: false,
    visible: true
  };

  // ---------------------------------------------------------------------------
  // Petits utilitaires
  // ---------------------------------------------------------------------------

  /** Valeur d'un <input type="date"> (AAAA-MM-JJ) depuis une Date. */
  function inputValue(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
  }

  /** « 03/11 » : libellé d'une graduation de l'axe des dates. */
  function shortDay(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    try {
      return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
    } catch (error) {
      return '';
    }
  }

  function colorFor(index) {
    return `var(--edp-chart-${(index % PALETTE) + 1})`;
  }

  // ---------------------------------------------------------------------------
  // SVG
  // ---------------------------------------------------------------------------

  const NS = 'http://www.w3.org/2000/svg';

  /** Création d'un nœud SVG (createElementNS, jamais d'innerHTML). */
  function svgEl(tag, attrs = {}, children = []) {
    const node = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([key, value]) => {
      if (value === null || value === undefined || value === false) return;
      if (key === 'text') node.textContent = String(value);
      else if (key === 'style' && value && typeof value === 'object') {
        Object.entries(value).forEach(([name, raw]) => node.style.setProperty(name, String(raw)));
      } else node.setAttribute(key, String(value));
    });
    (Array.isArray(children) ? children : [children]).forEach((child) => {
      if (!child) return;
      node.appendChild(child);
    });
    return node;
  }

  /** Chemin d'une polyligne. */
  function linePath(points, x, y) {
    return points
      .map((point, index) => `${index ? 'L' : 'M'}${x(point.date.getTime()).toFixed(1)} ${y(point.value).toFixed(1)}`)
      .join(' ');
  }

  /**
   * Construit une courbe SVG autonome.
   *
   * Le viewBox fait 720 × 250 et le SVG est étiré en largeur par le CSS : la
   * courbe s'adapte donc au panneau, sans recalcul ni redimensionnement JS.
   *
   * @param {object} params
   * @param {Array<{name: string, points: Array, color: string}>} params.series
   * @param {string} params.ariaLabel description lue par les lecteurs d'écran
   * @param {boolean} [params.filled] aire teintée sous la première courbe
   */
  function buildChart({ series, ariaLabel, filled = false }) {
    const width = 720;
    const height = 250;
    const pad = { top: 16, right: 18, bottom: 30, left: 38 };

    const points = (series || []).flatMap((entry) => entry.points || []);
    if (!points.length) return null;

    const times = points.map((point) => point.date.getTime());
    let minTime = Math.min(...times);
    let maxTime = Math.max(...times);
    if (minTime === maxTime) {
      // Une seule date : on centre le point avec une fenêtre de trois jours.
      minTime -= 3 * DAY;
      maxTime += 3 * DAY;
    }

    const values = points.map((point) => point.value);
    // L'axe va toujours au moins jusqu'à 20 : une moyenne sur 20 se lit par
    // rapport à son barème, pas par rapport à sa propre valeur maximale.
    const yMax = Math.max(20, Math.ceil(Math.max(...values) / 5) * 5);
    const plotWidth = width - pad.left - pad.right;
    const plotHeight = height - pad.top - pad.bottom;

    const x = (time) => pad.left + ((time - minTime) / (maxTime - minTime)) * plotWidth;
    const y = (value) => height - pad.bottom - (value / yMax) * plotHeight;

    const svg = svgEl('svg', {
      viewBox: `0 0 ${width} ${height}`,
      class: 'edp-chart__svg',
      role: 'img',
      'aria-label': ariaLabel
    });

    // --- Grille horizontale + graduations de notes ------------------------
    for (let value = 0; value <= yMax; value += 5) {
      svg.appendChild(
        svgEl('line', {
          class: 'edp-chart__grid-line',
          x1: pad.left,
          x2: width - pad.right,
          y1: y(value).toFixed(1),
          y2: y(value).toFixed(1)
        })
      );
      svg.appendChild(
        svgEl('text', {
          class: 'edp-chart__axis-label',
          x: pad.left - 8,
          y: (y(value) + 4).toFixed(1),
          'text-anchor': 'end',
          text: String(value)
        })
      );
    }

    // --- Graduations de dates (quatre repères, jamais de chevauchement) ----
    const ticks = 4;
    for (let index = 0; index < ticks; index += 1) {
      const time = minTime + ((maxTime - minTime) * index) / (ticks - 1);
      const anchor = index === 0 ? 'start' : index === ticks - 1 ? 'end' : 'middle';
      svg.appendChild(
        svgEl('text', {
          class: 'edp-chart__axis-label',
          x: x(time).toFixed(1),
          y: height - 8,
          'text-anchor': anchor,
          text: shortDay(new Date(time))
        })
      );
    }

    // --- Aire teintée (moyenne générale seulement) ------------------------
    if (filled && series[0] && series[0].points.length > 1) {
      const first = series[0].points[0];
      const last = series[0].points[series[0].points.length - 1];
      svg.appendChild(
        svgEl('path', {
          class: 'edp-chart__area',
          d: `${linePath(series[0].points, x, y)} L${x(last.date.getTime()).toFixed(1)} ${y(0).toFixed(
            1
          )} L${x(first.date.getTime()).toFixed(1)} ${y(0).toFixed(1)} Z`
        })
      );
    }

    // --- Courbes et points ------------------------------------------------
    series.forEach((entry) => {
      const list = entry.points || [];
      if (!list.length) return;

      if (list.length > 1) {
        svg.appendChild(
          svgEl('path', {
            class: 'edp-chart__line',
            d: linePath(list, x, y),
            style: { stroke: entry.color || 'var(--edp-chart-1)' }
          })
        );
      }

      // Au-delà de 40 points, les pastilles deviennent un pavé illisible : la
      // courbe suffit, et les valeurs restent consultables au survol des points
      // conservés (le dernier et le premier).
      const dots =
        list.length <= 40 ? list : [list[0], list[list.length - 1]].filter(Boolean);

      dots.forEach((point) => {
        const dot = svgEl('circle', {
          class: 'edp-chart__dot',
          cx: x(point.date.getTime()).toFixed(1),
          cy: y(point.value).toFixed(1),
          r: 3,
          style: { fill: entry.color || 'var(--edp-chart-1)' }
        });
        // Info-bulle native : aucune librairie, aucun script au survol.
        dot.appendChild(
          svgEl('title', {
            text: `${shortDay(point.date)} · ${formatFr(point.value)}/20 — ${entry.name}`
          })
        );
        svg.appendChild(dot);
      });
    });

    return svg;
  }

  // ---------------------------------------------------------------------------
  // Styles du shadow root
  // ---------------------------------------------------------------------------

  async function adoptStyles(shadow) {
    try {
      const response = await fetch(EDP.API.runtime.getURL('styles/components/charts.css'));
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
      console.debug('[ED+] feuille des graphiques illisible :', error);
    }
  }

  // ---------------------------------------------------------------------------
  // Vue
  // ---------------------------------------------------------------------------

  async function mountView(initialCtx) {
    let ctx = initialCtx;

    const source = EDP.data && EDP.data.sourceDom;
    const tablesOf = () =>
      source && typeof source.gradeTables === 'function' ? source.gradeTables() : [];

    const tables = tablesOf();
    if (!tables.length) return null;

    const host = document.createElement('div');
    host.id = HOST_ID;
    const shadow = host.attachShadow({ mode: 'open' });
    await adoptStyles(shadow);

    view.visible = !(ctx.settings && ctx.settings.chartsVisible === false);

    // --- Coquille ---------------------------------------------------------
    const refs = {
      toggle: null,
      panel: null,
      periods: null,
      custom: null,
      fromInput: null,
      toInput: null,
      range: null,
      timeline: null,
      generalCard: null,
      subjectCard: null,
      legend: null,
      foot: null
    };

    refs.toggle = ui().el('button', {
      type: 'button',
      class: 'edp-charts__toggle',
      onclick: () => setVisible(!view.visible)
    });

    refs.periods = ui().el('div', {
      class: 'edp-charts__periods',
      role: 'group',
      'aria-label': 'Période affichée'
    });

    PERIODS.forEach((period) => {
      refs.periods.appendChild(
        ui().el(
          'button',
          {
            type: 'button',
            class: 'edp-charts__period',
            dataset: { period: period.value },
            onclick: () => {
              view.period = period.value;
              if (view.period === 'custom' && (!view.from || !view.to)) {
                // Premier passage en personnalisé : on propose l'année entière
                // comme point de départ, l'utilisateur resserre ensuite.
                const year = EDP.progress.periodBounds('year', { grades: currentGrades() });
                view.from = inputValue(year.from);
                view.to = inputValue(year.to);
              }
              render();
            }
          },
          [period.label]
        )
      );
    });

    function dateField(label, key) {
      const input = ui().el('input', {
        type: 'date',
        class: 'edp-charts__date',
        'aria-label': label
      });
      input.addEventListener('change', () => {
        view[key] = input.value;
        render();
      });
      const field = ui().el('label', { class: 'edp-charts__field' }, [
        ui().el('span', { class: 'edp-charts__field-label', text: label }),
        input
      ]);
      return { field, input };
    }

    const fromField = dateField('Du', 'from');
    const toField = dateField('Au', 'to');
    refs.fromInput = fromField.input;
    refs.toInput = toField.input;

    refs.custom = ui().el('div', { class: 'edp-charts__custom' }, [
      fromField.field,
      toField.field
    ]);
    refs.range = ui().el('p', { class: 'edp-charts__range' });

    /** Carte d'un graphique : titre, valeur courante, corps redessiné. */
    function chartCard(title, hint) {
      const value = ui().el('span', { class: 'edp-chart__value' });
      const body = ui().el('div', { class: 'edp-chart__body' });
      const root = ui().el('section', { class: 'edp-chart' }, [
        ui().el('header', { class: 'edp-chart__head' }, [
          ui().el('div', { class: 'edp-chart__titles' }, [
            ui().el('h3', { class: 'edp-chart__title', text: title }),
            ui().el('p', { class: 'edp-chart__hint', text: hint })
          ]),
          value
        ]),
        body
      ]);
      return { root, body, value };
    }

    const generalCard = chartCard(
      'Moyenne générale',
      'Moyenne de toutes les notes reçues, à chaque date.'
    );
    const subjectCard = chartCard(
      'Par matière',
      'Cliquez sur une matière pour l’afficher ou la masquer.'
    );
    refs.legend = ui().el('div', {
      class: 'edp-chart-legend',
      role: 'group',
      'aria-label': 'Matières affichées'
    });
    subjectCard.root.insertBefore(refs.legend, subjectCard.body);

    refs.generalCard = generalCard;
    refs.subjectCard = subjectCard;
    refs.timeline = ui().el('div', { class: 'edp-charts__grid' }, [
      generalCard.root,
      subjectCard.root
    ]);
    refs.foot = ui().el('p', { class: 'edp-charts__foot' });

    refs.panel = ui().el('div', { class: 'edp-charts__panel' }, [
      ui().el('div', { class: 'edp-charts__toolbar' }, [
        refs.periods,
        refs.custom
      ]),
      refs.range,
      refs.timeline,
      refs.foot
    ]);

    const root = ui().el('section', { class: 'edp-charts' }, [
      ui().el('header', { class: 'edp-charts__head' }, [
        ui().el('div', { class: 'edp-charts__titles' }, [
          ui().el('p', { class: 'edp-charts__eyebrow', text: 'Progression' }),
          ui().el('h2', { class: 'edp-charts__title', text: 'Évolution des notes' }),
          ui().el('p', {
            class: 'edp-charts__subtitle',
            text: 'Moyenne générale et moyennes par matière, dans le temps. Calcul local, rien n’est transmis.'
          })
        ]),
        refs.toggle
      ]),
      refs.panel
    ]);
    shadow.appendChild(root);

    // --- Données ----------------------------------------------------------

    function currentData() {
      return EDP.data.get() || (ctx && ctx.data) || {};
    }

    function currentGrades() {
      const data = currentData();
      return Array.isArray(data.grades) ? data.grades : [];
    }

    function currentSettings() {
      return (ctx && ctx.settings) || currentData().settings || {};
    }

    let lastSeries = null;
    let colorIndex = new Map();

    // --- Légende ----------------------------------------------------------

    function renderLegend(subjects) {
      refs.legend.textContent = '';
      colorIndex = new Map();

      subjects.forEach((subject, index) => {
        colorIndex.set(subject.key, index);
        const color = colorFor(index);
        const button = ui().el(
          'button',
          {
            type: 'button',
            class: 'edp-chart-legend__item',
            dataset: { key: subject.key },
            onclick: () => toggleSubject(subject.key)
          },
          [
            ui().el('span', { class: 'edp-chart-legend__swatch' }),
            ui().el('span', { class: 'edp-chart-legend__name', text: subject.name }),
            ui().el('span', {
              class: 'edp-chart-legend__value',
              text: Number.isFinite(subject.current) ? formatFr(subject.current) : '—'
            })
          ]
        );
        button.style.setProperty('--edp-chart-color', color);
        button.setAttribute('aria-pressed', view.hidden.has(subject.key) ? 'false' : 'true');
        refs.legend.appendChild(button);
      });

      refs.legend.hidden = subjects.length === 0;
    }

    function syncLegendPressed() {
      Array.from(refs.legend.children).forEach((button) => {
        const hidden = view.hidden.has(button.dataset.key);
        button.setAttribute('aria-pressed', hidden ? 'false' : 'true');
      });
    }

    function toggleSubject(key) {
      if (view.hidden.has(key)) view.hidden.delete(key);
      else view.hidden.add(key);
      syncLegendPressed();
      if (lastSeries) drawCharts(lastSeries);
    }

    /** Choix initial : les six matières les plus notées, le reste masqué. */
    function ensureSelection(subjects) {
      if (view.selectionReady) return;
      if (!subjects.length) return;
      subjects
        .slice()
        .sort((left, right) => right.gradeCount - left.gradeCount)
        .slice(DEFAULT_SERIES)
        .forEach((subject) => view.hidden.add(subject.key));
      view.selectionReady = true;
    }

    // --- Tracé ------------------------------------------------------------

    function emptyNote(text) {
      return ui().el('p', { class: 'edp-chart__empty', text });
    }

    function drawCharts(series) {
      // Moyenne générale
      refs.generalCard.body.textContent = '';
      const general = series.general;
      refs.generalCard.value.textContent = general.length
        ? `${formatFr(general[general.length - 1].value)}/20`
        : '';
      if (general.length >= 2) {
        refs.generalCard.body.appendChild(
          buildChart({
            series: [{ name: 'Moyenne générale', points: general, color: 'var(--edp-chart-1)' }],
            ariaLabel: 'Courbe de la moyenne générale dans le temps, sur 20',
            filled: true
          })
        );
      } else {
        refs.generalCard.body.appendChild(
          emptyNote(
            general.length
              ? 'Une seule note datée sur cette période : il n’y a pas encore d’évolution à tracer.'
              : 'Aucune note datée sur cette période.'
          )
        );
      }

      // Moyennes par matière
      refs.subjectCard.body.textContent = '';
      const subjects = series.subjects.filter((subject) => subject.points.length);
      const visible = subjects.filter((subject) => !view.hidden.has(subject.key));
      refs.subjectCard.value.textContent = subjects.length
        ? `${visible.length}/${subjects.length} affichée${visible.length > 1 ? 's' : ''}`
        : '';

      const plottable = visible.filter((subject) => subject.points.length > 1);
      if (plottable.length) {
        refs.subjectCard.body.appendChild(
          buildChart({
            series: plottable.map((subject) => ({
              name: subject.name,
              points: subject.points,
              color: colorFor(colorIndex.has(subject.key) ? colorIndex.get(subject.key) : 0)
            })),
            ariaLabel: `Courbes des moyennes par matière : ${plottable
              .map((subject) => subject.name)
              .join(', ')}`
          })
        );
      } else if (!subjects.length) {
        refs.subjectCard.body.appendChild(emptyNote('Aucune matière notée sur cette période.'));
      } else if (!visible.length) {
        refs.subjectCard.body.appendChild(
          emptyNote('Toutes les matières sont masquées : cliquez sur une matière ci-dessus.')
        );
      } else {
        refs.subjectCard.body.appendChild(
          emptyNote('Une seule note par matière sur cette période : pas encore de courbe à tracer.')
        );
      }

      refs.foot.textContent = [
        `${series.count} note${series.count > 1 ? 's' : ''} datée${series.count > 1 ? 's' : ''}`,
        series.undated
          ? `${series.undated} sans date ignorée${series.undated > 1 ? 's' : ''}`
          : null,
        'calcul local'
      ]
        .filter(Boolean)
        .join(' · ');
    }

    // --- Rendu complet ----------------------------------------------------

    function render() {
      const grades = currentGrades();
      const settings = currentSettings();
      const bounds = EDP.progress.periodBounds(view.period, {
        grades,
        custom: { from: view.from, to: view.to }
      });

      Array.from(refs.periods.children).forEach((button) => {
        const active = button.dataset.period === view.period;
        button.dataset.active = active ? '1' : '0';
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
      });

      refs.custom.hidden = view.period !== 'custom';
      if (view.period === 'custom') {
        if (!view.from) view.from = inputValue(bounds.from);
        if (!view.to) view.to = inputValue(bounds.to);
        refs.fromInput.value = view.from;
        refs.toInput.value = view.to;
      }

      refs.range.textContent = bounds.estimated
        ? `${bounds.label} · découpage estimé d’après les dates des notes`
        : bounds.label;

      const series = EDP.progress.buildSeries(grades, settings, bounds);
      lastSeries = series;
      ensureSelection(series.subjects);
      renderLegend(series.subjects);
      drawCharts(series);
      return series;
    }

    // --- Visibilité -------------------------------------------------------

    function applyVisibility() {
      refs.panel.hidden = !view.visible;
      refs.toggle.textContent = view.visible ? 'Masquer les graphiques' : 'Afficher les graphiques';
      refs.toggle.setAttribute('aria-expanded', view.visible ? 'true' : 'false');
      host.dataset.edpChartsVisible = view.visible ? '1' : '0';
    }

    async function setVisible(visible) {
      view.visible = visible;
      applyVisibility();
      try {
        await EDP.settings.set({ chartsVisible: visible });
      } catch (error) {
        // L'affichage reste correct pour la session en cours.
        console.debug('[ED+] préférence des graphiques non enregistrée :', error);
      }
    }

    // --- Insertion et suivi du DOM ---------------------------------------

    function isOurs(node) {
      if (!node || typeof node.closest !== 'function') return false;
      try {
        return Boolean(node.closest(`#${HOST_ID}, #edp-panel-host, [class*="edp-"]`));
      } catch (error) {
        return false;
      }
    }

    /**
     * Place le bloc APRÈS le dernier tableau de notes.
     *
     * Pas avant : le relevé refondu (features/grades.js) s'insère juste avant le
     * premier tableau et se replace à chaque mutation. Se disputer la même
     * ancre ferait danser les deux blocs d'un rechargement à l'autre.
     */
    function place() {
      const list = tablesOf();
      const table = list.length ? list[list.length - 1].table : null;
      if (!table || !table.parentNode) return false;
      if (host.parentNode === table.parentNode && host.previousElementSibling === table) return true;
      try {
        table.parentNode.insertBefore(host, table.nextSibling);
        return true;
      } catch (error) {
        console.debug('[ED+] insertion des graphiques impossible :', error);
        return false;
      }
    }

    if (!place()) return null;

    const stopWatch = EDP.dom.onDomChange(
      () => {
        place();
        // Le site recharge ses notes en Ajax : on redessine quand les données
        // ont réellement changé, pas à chaque mutation.
        const data = currentData();
        if (!data || !Array.isArray(data.grades)) return;
        const signature = dataSignature(data.grades, currentSettings());
        if (signature === lastSignature) return;
        lastSignature = signature;
        render();
      },
      { delay: 900, ignore: (node) => isOurs(node) }
    );

    applyVisibility();
    let lastSignature = dataSignature(currentGrades(), currentSettings());
    render();

    return {
      /** Appelé par le registre à chaque collecte (nouveaux réglages, notes). */
      refresh(next) {
        if (next) ctx = next;
        view.visible = !(ctx.settings && ctx.settings.chartsVisible === false);
        applyVisibility();
        const grades = currentGrades();
        const signature = dataSignature(grades, currentSettings());
        if (signature === lastSignature) return;
        lastSignature = signature;
        render();
      },
      destroy() {
        stopWatch();
        host.remove();
      }
    };
  }

  /**
   * Empreinte des données affichées : évite de reconstruire le SVG à chaque
   * mutation du DOM alors que rien n'a bougé.
   */
  function dataSignature(grades, settings) {
    const parts = (Array.isArray(grades) ? grades : []).map(
      (grade) => `${grade.id}:${grade.value20}:${grade.counted ? 1 : 0}:${grade.date ? grade.date.getTime() : 0}`
    );
    return [
      parts.join('|'),
      settings && settings.useGradeCoefficients === false ? 0 : 1,
      settings && settings.useSubjectCoefficients === false ? 0 : 1,
      ((settings && settings.excludedSubjects) || []).join(','),
      view.period,
      view.from,
      view.to
    ].join('§');
  }

  // ---------------------------------------------------------------------------
  // Fonctionnalité
  // ---------------------------------------------------------------------------

  let instance = null;

  EDP.registry.registerFeature({
    id: 'charts',
    label: 'Graphiques de progression',
    // Les graphiques complètent l'écran Notes : désactiver le relevé refondu
    // les désactive aussi, puisqu'ils partagent la même lecture des notes.
    settingKey: 'grades',
    detect: (ctx) =>
      ctx.route === EDP.ROUTES.NOTES &&
      Boolean(ctx.data && ctx.data.grades && ctx.data.grades.length),
    async mount(ctx) {
      instance = await mountView(ctx);
      return instance;
    },
    update(ctx) {
      if (!instance || typeof instance.refresh !== 'function') return;
      instance.refresh(ctx);
    },
    unmount() {
      if (instance && typeof instance.destroy === 'function') instance.destroy();
      instance = null;
    }
  });
})();
