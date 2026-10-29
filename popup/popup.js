'use strict';
/**
 * popup/popup.js
 * -------------
 * Le popup fait deux choses, et rien d'autre :
 *   1. afficher le dernier « snapshot » calculé (moyenne, dernière note, cours
 *      suivant, devoirs) — il ne recalcule rien lui-même, il demande au
 *      background, qui relit le cache écrit par le content script ;
 *   2. modifier les réglages partagés. Aucun envoi vers le site, aucune donnée
 *      transmise.
 *
 * Pourquoi ne pas calculer dans le popup : il n'a pas accès au DOM de la page,
 * il ne pourrait lire ni les notes, ni l'emploi du temps. Le laisser recalculer
 * créerait deux moteurs divergents — donc deux moyennes différentes affichées
 * à deux endroits.
 */
(() => {
  const EDP = globalThis.EDP;
  const { API, MESSAGES } = EDP;
  const { formatFr, formatDelta } = EDP.utils;
  const ui = EDP.ui || null;

  const nodes = {};

  /** Envoie un message au background et renvoie la donnée utile (ou null). */
  async function request(type, payload = null) {
    try {
      const response = await API.runtime.sendMessage({ type, ...(payload || {}) });
      return response && response.ok ? response.data : null;
    } catch (error) {
      console.debug('[ED+] popup : message sans réponse', type, error);
      return null;
    }
  }

  /** Petit créateur de nœuds, pour ne jamais utiliser innerHTML. */
  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    Object.entries(props).forEach(([key, value]) => {
      if (value === null || value === undefined || value === false) return;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = String(value);
      else if (key === 'hidden') node.hidden = Boolean(value);
      else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
      else node.setAttribute(key, String(value));
    });
    (Array.isArray(children) ? children : [children]).forEach((child) => {
      if (child === null || child === undefined) return;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    });
    return node;
  }

  function stat({ label, value, hint = null, tone = 'neutral' }) {
    return el('div', { class: `edp-stat edp-tone-${tone}` }, [
      el('span', { class: 'edp-stat__label', text: label }),
      el('strong', { class: 'edp-stat__value', text: value }),
      hint ? el('span', { class: 'edp-stat__hint', text: hint }) : null
    ]);
  }

  function toneForDelta(value) {
    if (!Number.isFinite(value)) return 'neutral';
    if (value > 0) return 'positive';
    if (value < 0) return 'negative';
    return 'neutral';
  }

  // ---------------------------------------------------------------------------
  // Affichage du résumé
  // ---------------------------------------------------------------------------

  function renderSummary(snapshot) {
    const stats = nodes.summaryStats;
    const last = nodes.summaryLast;
    stats.textContent = '';
    last.textContent = '';

    if (!snapshot || !snapshot.general || snapshot.general.average20 === null) {
      nodes.summaryEmpty.hidden = false;
      nodes.summarySource.textContent = 'aucune donnée pour l’instant';
      return;
    }

    nodes.summaryEmpty.hidden = true;
    const average = snapshot.general.average20;
    nodes.summarySource.textContent = `${snapshot.period || 'période en cours'} · ${snapshot.counts.counted} notes prises en compte`;

    stats.appendChild(
      stat({
        label: 'Moyenne générale',
        value: formatFr(average),
        hint: `${snapshot.general.subjectsUsed} matière(s)`,
        tone: 'accent'
      })
    );

    if (Number.isFinite(snapshot.classGeneral)) {
      stats.appendChild(
        stat({
          label: 'Classe',
          value: formatFr(snapshot.classGeneral),
          hint: formatDelta(average - snapshot.classGeneral),
          tone: toneForDelta(average - snapshot.classGeneral)
        })
      );
    }

    if (snapshot.newGrades) {
      stats.appendChild(stat({ label: 'Nouvelles notes', value: String(snapshot.newGrades), tone: 'accent' }));
    }

    if (snapshot.lastGrade) {
      const grade = snapshot.lastGrade;
      const when = grade.date ? new Date(grade.date).toLocaleDateString('fr-FR') : 'date inconnue';
      last.textContent = `Dernière note : ${grade.subject} — ${formatFr(grade.value, 1)}/${formatFr(
        grade.outOf,
        0
      )} (${when})`;
    }

    // Détail par matière (utile pour répondre à « et en maths ? »)
    const list = el('div', { class: 'edp-subjects' });
    (snapshot.subjects || []).forEach((subject) => {
      list.appendChild(
        el('div', { class: 'edp-subject-line' }, [
          el('span', { text: subject.name }),
          el('span', { class: 'edp-subject-line__value', text: formatFr(subject.average20) })
        ])
      );
    });
    if (snapshot.subjects && snapshot.subjects.length) stats.appendChild(list);
  }

  /** Sections fournies par les fonctionnalités de la page (cours, devoirs). */
  function renderSections(snapshot) {
    const sections = (snapshot && snapshot.sections) || {};
    const body = nodes.sectionsBody;
    body.textContent = '';
    let anything = false;

    if (sections.timetable && (sections.timetable.current || sections.timetable.next)) {
      anything = true;
      const timetable = sections.timetable;
      if (timetable.current) {
        body.appendChild(
          stat({
            label: 'Cours en cours',
            value: timetable.current.subject,
            hint: `${timetable.current.time}${timetable.current.room ? ` · ${timetable.current.room}` : ''}`,
            tone: 'accent'
          })
        );
      }
      if (timetable.next) {
        body.appendChild(
          stat({
            label: 'Prochain cours',
            value: timetable.next.subject,
            hint: `${timetable.next.time} · dans ${formatFr(timetable.next.startsInMinutes / 60, 1)} h`
          })
        );
      }
    }

    if (sections.homework) {
      anything = true;
      body.appendChild(
        stat({
          label: 'Devoirs',
          value: `${sections.homework.today} aujourd’hui · ${sections.homework.late} en retard`,
          hint: sections.homework.next && sections.homework.next[0]
            ? `${sections.homework.next[0].subject} — ${sections.homework.next[0].label.slice(0, 48)}`
            : null,
          tone: sections.homework.late ? 'negative' : 'neutral'
        })
      );
    }

    nodes.sections.hidden = !anything;
  }

  // ---------------------------------------------------------------------------
  // Réglages
  // ---------------------------------------------------------------------------

  async function loadSettingsIntoUi() {
    const settings = await EDP.settings.get();
    document.documentElement.dataset.edpTheme = EDP.theme ? EDP.theme.resolve(settings.theme) : 'light';
    nodes.enabled.checked = settings.enabled;
    nodes.theme.value = settings.theme;
    nodes.modules.grades.checked = settings.modules.grades !== false;
    nodes.modules.simulator.checked = settings.modules.simulator !== false;
    nodes.modules.timetable.checked = settings.modules.timetable !== false;
    nodes.modules.homework.checked = settings.modules.homework !== false;
    nodes.modules.themeToggle.checked = settings.modules.themeToggle !== false;
    nodes.badge.checked = settings.badgeNewGrades !== false;
    return settings;
  }

  function wireSettings() {
    nodes.enabled.addEventListener('change', () => EDP.settings.set({ enabled: nodes.enabled.checked }));

    nodes.theme.addEventListener('change', async () => {
      const settings = await EDP.settings.set({ theme: nodes.theme.value });
      // Le popup s'applique son propre thème immédiatement : sans ça, il
      // faudrait le refermer et le rouvrir pour voir le changement.
      document.documentElement.dataset.edpTheme = EDP.theme ? EDP.theme.resolve(settings.theme) : 'light';
    });

    Object.entries(nodes.modules).forEach(([key, input]) => {
      input.addEventListener('change', () => EDP.settings.set({ modules: { [key]: input.checked } }));
    });

    nodes.badge.addEventListener('change', () => EDP.settings.set({ badgeNewGrades: nodes.badge.checked }));

    nodes.reset.addEventListener('click', async () => {
      await EDP.settings.reset();
      await loadSettingsIntoUi();
    });

    nodes.openSite.addEventListener('click', () => {
      API.tabs.create({ url: 'https://www.ecoledirecte.com/' });
      window.close();
    });
  }

  // ---------------------------------------------------------------------------
  // Démarrage
  // ---------------------------------------------------------------------------

  function bindNodes() {
    nodes.version = document.getElementById('version');
    nodes.enabled = document.getElementById('enabled');
    nodes.theme = document.getElementById('theme');
    nodes.modules = {
      grades: document.getElementById('module-grades'),
      simulator: document.getElementById('module-simulator'),
      timetable: document.getElementById('module-timetable'),
      homework: document.getElementById('module-homework'),
      themeToggle: document.getElementById('module-theme-toggle')
    };
    nodes.badge = document.getElementById('badge');
    nodes.reset = document.getElementById('reset');
    nodes.openSite = document.getElementById('open-site');
    nodes.summary = document.getElementById('summary');
    nodes.summaryStats = document.getElementById('summary-stats');
    nodes.summaryLast = document.getElementById('summary-last');
    nodes.summaryEmpty = document.getElementById('summary-empty');
    nodes.summarySource = document.getElementById('summary-source');
    nodes.sections = document.getElementById('sections');
    nodes.sectionsBody = document.getElementById('sections-body');
  }

  async function main() {
    bindNodes();
    nodes.version.textContent = `v${EDP.VERSION} · non officiel`;
    wireSettings();
    await loadSettingsIntoUi();

    const snapshot = await request(MESSAGES.GET_SNAPSHOT);
    renderSummary(snapshot);
    renderSections(snapshot);
  }

  document.addEventListener('DOMContentLoaded', () => {
    main().catch((error) => {
      console.error('[ED+] popup en échec :', error);
    });
  });
})();
