'use strict';
/**
 * popup/popup.js
 * -------------
 * Le popup fait quatre choses, et rien d'autre :
 *   1. afficher le dernier « snapshot » calculé (moyenne, cours, devoirs) —
 *      il ne recalcule rien lui-même : il demande au background, qui relit le
 *      cache écrit par le content script ;
 *   2. basculer le mode sombre, avec exactement le même module de thème que la
 *      page (content/features/theme.js) ;
 *   3. ouvrir le simulateur dans le tiroir de la page ;
 *   4. modifier les réglages partagés.
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

  const nodes = {};
  let toastTimer = null;

  /** Envoie un message au background et renvoie la donnée utile (ou null). */
  async function request(type) {
    try {
      const response = await API.runtime.sendMessage({ type });
      return response && response.ok ? response.data : null;
    } catch (error) {
      // Cas normal : event page endormie, extension rechargée.
      console.debug('[ED+] popup : message sans réponse', type, error);
      return null;
    }
  }

  /** Onglet actif, sans demander la permission « tabs » (on n'a besoin que de l'id). */
  async function activeTab() {
    try {
      const tabs = await API.tabs.query({ active: true, currentWindow: true });
      return tabs && tabs.length ? tabs[0] : null;
    } catch (error) {
      console.debug('[ED+] popup : onglet actif illisible', error);
      return null;
    }
  }

  /** Petit créateur de nœuds : jamais d'innerHTML, même si le contenu est sûr. */
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

  function badge(text, tone = 'neutral') {
    return el('span', { class: `edp-badge edp-tone-${tone}`, text });
  }

  /** Message temporaire, sous les actions rapides. */
  function toast(message) {
    nodes.toast.textContent = message;
    nodes.toast.hidden = !message;
    clearTimeout(toastTimer);
    if (!message) return;
    toastTimer = setTimeout(() => {
      nodes.toast.hidden = true;
    }, 4000);
  }

  // ---------------------------------------------------------------------------
  // Thème
  // ---------------------------------------------------------------------------

  /**
   * Aligne l'apparence du bouton sur le thème EFFECTIF.
   *
   * Le bouton montre l'état (lune = sombre, soleil = clair) et son aria-label
   * annonce l'action. C'est la seule façon de rester compréhensible en mode
   * « auto », où l'utilisateur n'a pas explicitement choisi.
   *
   * L'ICÔNE est choisie par le CSS à partir de `aria-pressed` : on ne manipule
   * pas les SVG ici (l'attribut `hidden` n'existe pas sur un élément SVG, et un
   * `.hidden` posé par JS ne serait qu'une propriété fantôme).
   */
  function paintTheme() {
    const dark = EDP.theme.current.resolved === 'dark';
    const action = dark ? 'Passer en mode clair' : 'Passer en mode sombre';

    nodes.themeToggle.setAttribute('aria-pressed', dark ? 'true' : 'false');
    nodes.themeToggle.title = action;
    nodes.themeToggle.setAttribute('aria-label', action);
    nodes.themeToggleText.textContent = dark ? 'Sombre' : 'Clair';

    // Le sélecteur des réglages reflète la préférence (auto / clair / sombre),
    // qui n'est pas la même chose que la valeur effective ci-dessus.
    if (nodes.theme) nodes.theme.value = EDP.theme.current.preference;
  }

  function wireTheme() {
    nodes.themeToggle.addEventListener('click', () => {
      // theme.toggle() applique immédiatement (pas d'attente du stockage), puis
      // enregistre. Les onglets ouverts suivent via storage.onChanged.
      EDP.theme.toggle().catch((error) => {
        console.warn('[ED+] bascule de thème en échec :', error);
      });
    });

    // Le sélecteur « Suivre le système » reste le seul moyen de revenir en
    // auto : le bouton, à deux états, force toujours clair ou sombre.
    nodes.theme.addEventListener('change', () => {
      EDP.theme.set(nodes.theme.value).catch((error) => {
        console.warn('[ED+] thème non enregistré :', error);
      });
    });

    EDP.theme.onChange(paintTheme);
  }

  // ---------------------------------------------------------------------------
  // Affichage du résumé
  // ---------------------------------------------------------------------------

  function renderSummary(snapshot) {
    nodes.period.textContent = (snapshot && snapshot.period) || '';
    nodes.badges.textContent = '';
    nodes.last.hidden = true;
    nodes.day.hidden = true;
    nodes.openSite.hidden = false;

    const general = snapshot && snapshot.general;
    const average = general && Number.isFinite(general.average20) ? general.average20 : null;

    if (average === null) {
      nodes.average.textContent = '—';
      nodes.average.dataset.tone = 'empty';
      nodes.meta.textContent = 'Ouvrez École Directe dans un onglet pour voir vos moyennes calculées.';
      return;
    }

    nodes.openSite.hidden = true;
    nodes.average.textContent = formatFr(average);
    nodes.average.dataset.tone = average >= 15 ? 'positive' : average < 10 ? 'negative' : 'neutral';

    const counted = (snapshot.counts && snapshot.counts.counted) || 0;
    nodes.meta.textContent = `${general.subjectsUsed || 0} matière${
      general.subjectsUsed > 1 ? 's' : ''
    } · ${counted} note${counted > 1 ? 's' : ''}`;

    if (Number.isFinite(snapshot.classGeneral)) {
      const gap = average - snapshot.classGeneral;
      nodes.badges.appendChild(
        badge(
          `${formatDelta(gap)} vs classe (${formatFr(snapshot.classGeneral)})`,
          gap > 0 ? 'positive' : gap < 0 ? 'negative' : 'neutral'
        )
      );
    }
    if (snapshot.newGrades) {
      nodes.badges.appendChild(badge(`${snapshot.newGrades} nouvelle${snapshot.newGrades > 1 ? 's' : ''} note${snapshot.newGrades > 1 ? 's' : ''}`, 'accent'));
    }

    if (snapshot.lastGrade) {
      const grade = snapshot.lastGrade;
      const when = grade.date ? new Date(grade.date).toLocaleDateString('fr-FR') : 'date inconnue';
      nodes.last.textContent = `Dernière note : ${grade.subject} — ${formatFr(grade.value, 1)}/${formatFr(
        grade.outOf,
        0
      )} (${when})`;
      nodes.last.hidden = false;
    }

    renderDay(snapshot);
  }

  /** Cours en cours / devoirs du jour, sur une seule ligne, s'ils sont connus. */
  function renderDay(snapshot) {
    const sections = (snapshot && snapshot.sections) || {};
    const parts = [];

    const timetable = sections.timetable;
    if (timetable && timetable.current) {
      parts.push(`En cours : ${timetable.current.subject} (${timetable.current.time})`);
    } else if (timetable && timetable.next) {
      parts.push(`Prochain cours : ${timetable.next.subject} à ${timetable.next.time}`);
    }

    if (sections.homework) {
      parts.push(
        `${sections.homework.today} devoir${sections.homework.today > 1 ? 's' : ''} aujourd’hui · ${
          sections.homework.late
        } en retard`
      );
    }

    nodes.day.textContent = parts.join(' · ');
    nodes.day.hidden = parts.length === 0;
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  function openSite() {
    API.tabs.create({ url: 'https://www.ecoledirecte.com/' });
    window.close();
  }

  /**
   * Ouvre le simulateur DANS LA PAGE.
   *
   * Le popup ne peut pas simuler lui-même : les notes sont dans le DOM de
   * l'onglet. On demande donc au content script d'ouvrir son tiroir sur la
   * section « Simulateur de notes ». Trois cas possibles, traités dans l'ordre :
   *   - un onglet École Directe répond  -> le tiroir s'ouvre, le popup se ferme ;
   *   - l'onglet est École Directe mais muet (page en chargement, extension
   *     rechargée) -> on demande de recharger, plutôt que d'ouvrir un doublon ;
   *   - aucun onglet École Directe -> on ouvre le site.
   */
  async function openSimulator() {
    const tab = await activeTab();
    if (!tab || tab.id === undefined) {
      openSite();
      return;
    }

    try {
      const response = await API.tabs.sendMessage(tab.id, { type: MESSAGES.OPEN_SIMULATOR });
      const data = response && response.ok ? response.data : null;
      if (data && data.opened) {
        if (data.simulator) {
          window.close();
          return;
        }
        toast('Tiroir ouvert. Le simulateur apparaît sur la page des notes.');
        return;
      }
    } catch (error) {
      console.debug('[ED+] content script injoignable :', error);
    }

    if (typeof tab.url === 'string' && /ecoledirecte\.com/i.test(tab.url)) {
      toast('Rechargez la page École Directe, puis réessayez.');
      return;
    }
    openSite();
  }

  /** « Paramètres » : la carte est plus bas dans le popup, on y va. */
  function showSettings() {
    try {
      nodes.settings.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      // Firefox 109 sans options de défilement : saut direct, sans animation.
      nodes.settings.scrollIntoView();
    }
    try {
      nodes.theme.focus({ preventScroll: true });
    } catch (error) {
      nodes.theme.focus();
    }
  }

  // ---------------------------------------------------------------------------
  // Réglages
  // ---------------------------------------------------------------------------

  async function loadSettingsIntoUi() {
    const settings = await EDP.settings.get();
    EDP.theme.apply(settings.theme);
    paintTheme();

    nodes.theme.value = settings.theme;
    nodes.enabled.checked = settings.enabled;
    nodes.modules.grades.checked = settings.modules.grades !== false;
    nodes.modules.simulator.checked = settings.modules.simulator !== false;
    nodes.modules.timetable.checked = settings.modules.timetable !== false;
    nodes.modules.homework.checked = settings.modules.homework !== false;
    nodes.modules.themeToggle.checked = settings.modules.themeToggle !== false;
    nodes.modules.averageHud.checked = settings.modules.averageHud !== false;
    nodes.badge.checked = settings.badgeNewGrades !== false;
    return settings;
  }

  function wireSettings() {
    nodes.enabled.addEventListener('change', async () => {
      await EDP.settings.set({ enabled: nodes.enabled.checked });
      toast(nodes.enabled.checked ? '' : 'Extension désactivée : la page reste d’origine.');
    });

    Object.entries(nodes.modules).forEach(([key, input]) => {
      input.addEventListener('change', () => EDP.settings.set({ modules: { [key]: input.checked } }));
    });

    nodes.badge.addEventListener('change', () => EDP.settings.set({ badgeNewGrades: nodes.badge.checked }));

    nodes.reset.addEventListener('click', async () => {
      await EDP.settings.reset();
      await loadSettingsIntoUi();
      toast('Réglages réinitialisés.');
    });
  }

  // ---------------------------------------------------------------------------
  // Démarrage
  // ---------------------------------------------------------------------------

  function bindNodes() {
    nodes.version = document.getElementById('version');
    nodes.themeToggle = document.getElementById('theme-toggle');
    nodes.themeToggleText = document.getElementById('theme-toggle-text');

    nodes.average = document.getElementById('average');
    nodes.period = document.getElementById('period');
    nodes.meta = document.getElementById('average-meta');
    nodes.badges = document.getElementById('average-badges');
    nodes.last = document.getElementById('last-grade');
    nodes.day = document.getElementById('day');
    nodes.openSite = document.getElementById('open-site');

    nodes.openSimulator = document.getElementById('open-simulator');
    nodes.openSettings = document.getElementById('open-settings');
    nodes.toast = document.getElementById('toast');
    nodes.settings = document.getElementById('settings');

    nodes.enabled = document.getElementById('enabled');
    nodes.theme = document.getElementById('theme');
    nodes.modules = {
      grades: document.getElementById('module-grades'),
      simulator: document.getElementById('module-simulator'),
      timetable: document.getElementById('module-timetable'),
      homework: document.getElementById('module-homework'),
      themeToggle: document.getElementById('module-theme-toggle'),
      averageHud: document.getElementById('module-average-hud')
    };
    nodes.badge = document.getElementById('badge');
    nodes.reset = document.getElementById('reset');
  }

  async function main() {
    bindNodes();
    nodes.version.textContent = `v${EDP.VERSION} · non officiel`;

    wireTheme();
    wireSettings();
    nodes.openSite.addEventListener('click', openSite);
    nodes.openSimulator.addEventListener('click', openSimulator);
    nodes.openSettings.addEventListener('click', showSettings);

    const settings = await loadSettingsIntoUi();

    // Le résumé vient du background (cache écrit par le content script) : le
    // popup n'ouvre pas d'onglet et ne recalcule rien.
    const snapshot = await request(MESSAGES.GET_SNAPSHOT);
    renderSummary(snapshot);

    if (!settings.enabled) {
      toast('Extension désactivée : rien n’est calculé sur les pages.');
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    main().catch((error) => {
      console.error('[ED+] popup en échec :', error);
    });
  });
})();
