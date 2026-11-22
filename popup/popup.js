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

  /** Derniers réglages connus : sert à composer les surcharges de thème. */
  let currentSettings = null;

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

    // Les vignettes de préréglage montrent la palette du mode EFFECTIF : elles
    // doivent donc être reconstruites quand le système bascule en sombre.
    if (nodes.presets && EDP.themePresets) buildPresetChoices();
    if (currentSettings) paintLookControls();
  }

  function wireTheme() {
    nodes.themeToggle.addEventListener('click', () => {
      // theme.toggle() applique immédiatement (pas d'attente du stockage), puis
      // enregistre. Les onglets ouverts suivent via storage.onChanged.
      EDP.theme.toggle().catch((error) => {
        console.warn('[ED+] bascule de thème en échec :', error);
      });
    });

    // Le sélecteur « Automatique » reste le seul moyen de revenir en auto : le
    // bouton, à deux états, force toujours clair ou sombre.
    nodes.theme.addEventListener('change', () => {
      saveLook({ theme: nodes.theme.value }).catch((error) => {
        console.warn('[ED+] thème non enregistré :', error);
      });
    });

    EDP.theme.onChange(paintTheme);
  }

  // ---------------------------------------------------------------------------
  // Apparence : préréglages, couleurs, formes, police
  // ---------------------------------------------------------------------------

  /**
   * Pastille de couleur d'une vignette de préréglage.
   *
   * C'est le seul endroit du popup qui pose une couleur en style inline, et
   * c'est assumé : le rôle même d'une vignette est de montrer une palette
   * arbitraire, qui n'existe pas encore dans tokens.css.
   */
  function swatchDot(color) {
    const dot = document.createElement('span');
    dot.className = 'edp-preset__dot';
    dot.style.background = color;
    return dot;
  }

  /** Construit les trois boutons de préréglage (un par thème prédéfini). */
  function buildPresetChoices() {
    nodes.presets.textContent = '';
    EDP.themePresets.THEME_PRESETS.forEach((preset) => {
      const palette = preset[EDP.theme.current.resolved] || preset.light;
      const button = el(
        'button',
        {
          type: 'button',
          class: 'edp-preset',
          role: 'radio',
          'aria-checked': 'false',
          'data-preset': preset.id,
          title: preset.hint || preset.label
        },
        [
          el('span', { class: 'edp-preset__swatch', 'aria-hidden': 'true' }, [
            swatchDot(palette.accent),
            swatchDot(palette.bg),
            swatchDot(palette.text)
          ]),
          el('span', { class: 'edp-preset__label', text: preset.label })
        ]
      );
      button.addEventListener('click', () => applyPreset(preset.id));
      nodes.presets.appendChild(button);
    });
  }

  function buildFontChoices() {
    nodes.font.textContent = '';
    EDP.themePresets.THEME_FONTS.forEach((font) => {
      const option = document.createElement('option');
      option.value = font.id;
      option.textContent = font.label;
      nodes.font.appendChild(option);
    });
  }

  /** Remplit la liste des densités (source : EDP.DENSITIES). */
  function buildDensityChoices() {
    nodes.density.textContent = '';
    (EDP.DENSITIES || []).forEach((density) => {
      const option = document.createElement('option');
      option.value = density.id;
      option.textContent = density.label;
      if (density.hint) option.title = density.hint;
      nodes.density.appendChild(option);
    });
  }

  /**
   * Construit les cases « masquer des éléments du site ».
   *
   * Les libellés viennent de EDP.HIDE_TARGETS (shared/constants.js), les
   * sélecteurs de content/data/source-dom.js : le popup n'a donc aucune
   * connaissance du balisage d'École Directe.
   */
  function buildHideChoices() {
    nodes.hideTargets.textContent = '';
    nodes.hideInputs = {};

    (EDP.HIDE_TARGETS || []).forEach((target) => {
      const input = el('input', { type: 'checkbox', id: `hide-${target.id}` });
      input.addEventListener('change', () => {
        saveHiddenElements().catch((error) =>
          console.warn('[ED+] masquage non enregistré :', error)
        );
      });

      const label = el('label', { class: 'edp-choice', for: `hide-${target.id}` }, [
        input,
        el('span', { class: 'edp-choice__label' }, [
          el('span', { text: target.label }),
          target.hint ? el('span', { class: 'edp-choice__hint', text: target.hint }) : null
        ])
      ]);

      nodes.hideInputs[target.id] = input;
      nodes.hideTargets.appendChild(label);
    });
  }

  /** Enregistre la liste des blocs masqués telle qu'elle est cochée. */
  async function saveHiddenElements() {
    const hiddenElements = Object.keys(nodes.hideInputs).filter(
      (id) => nodes.hideInputs[id].checked
    );
    const settings = await EDP.settings.set({ hiddenElements });
    currentSettings = settings;
    return settings;
  }

  /** Palette réellement affichée (préréglage du mode résolu + surcharges). */
  function effectivePalette(settings = currentSettings) {
    if (!settings) return null;
    return EDP.themePresets.paletteFor(
      settings.themePreset,
      EDP.theme.current.resolved,
      settings.themeOverrides
    );
  }

  /** Aligne les contrôles d'apparence sur l'état réel. */
  function paintLookControls(settings = currentSettings) {
    const palette = effectivePalette(settings);
    if (!palette) return;

    nodes.colors.accent.value = palette.accent;
    nodes.colors.bg.value = palette.bg;
    nodes.colors.text.value = palette.text;
    nodes.colors.surface.value = palette.surface;

    const radius = Number.parseInt(palette.radius, 10);
    nodes.radius.value = String(Number.isFinite(radius) ? radius : 10);
    nodes.radiusValue.textContent = `${nodes.radius.value} px`;

    nodes.font.value = palette.font;

    Array.from(nodes.presets.children).forEach((button) => {
      button.setAttribute('aria-checked', String(button.dataset.preset === settings.themePreset));
    });
  }

  /**
   * Enregistre un patch d'apparence et l'applique immédiatement.
   * Le stockage est la source de vérité : les onglets ouverts suivent ensuite
   * par storage.onChanged, comme pour n'importe quel autre réglage.
   */
  async function saveLook(patch) {
    const settings = await EDP.settings.set(patch);
    currentSettings = settings;
    EDP.theme.applyLook(settings);
    paintTheme();
    paintLookControls(settings);
    return settings;
  }

  /**
   * Choisir un préréglage repart de sa palette : les surcharges précédentes
   * sont effacées. Sans ça, « Contraste élevé » garderait le violet du thème
   * précédent et ne ressemblerait plus à ce qu'il annonce.
   *
   * Exception : « Personnalisé ». Ce thème n'est fait QUE de surcharges ; les
   * effacer reviendrait à cliquer sur un thème qui ne change rien. On part donc
   * de la palette actuellement affichée, que l'utilisateur ajuste ensuite.
   */
  function applyPreset(id) {
    const preset = EDP.themePresets.presetById(id);

    if (preset.id === 'personnalise') {
      const palette = effectivePalette();
      const overrides = palette
        ? {
            accent: palette.accent,
            bg: palette.bg,
            text: palette.text,
            surface: palette.surface,
            radius: palette.radius,
            font: palette.font
          }
        : {};
      saveLook({ themePreset: preset.id, themeOverrides: overrides })
        .then(() => toast('Thème personnalisé : ajustez les couleurs ci-dessous.'))
        .catch((error) => console.warn('[ED+] thème personnalisé non enregistré :', error));
      return;
    }

    saveLook({ themePreset: preset.id, themeOverrides: {}, theme: preset.mode || 'auto' })
      .then(() => toast(`Thème « ${preset.label} » appliqué.`))
      .catch((error) => console.warn('[ED+] préréglage non enregistré :', error));
  }

  /** Aperçu local pendant qu'on déplace un curseur : aucune écriture. */
  function previewLook(patch) {
    if (!currentSettings) return;
    EDP.theme.applyLook({
      ...currentSettings,
      themeOverrides: { ...currentSettings.themeOverrides, ...patch }
    });
  }

  /** Surcharges courantes + un changement, prêtes pour le stockage. */
  function withOverride(key, value) {
    const base = currentSettings ? currentSettings.themeOverrides : {};
    return { ...base, [key]: value };
  }

  function wireLook() {
    Object.entries(nodes.colors).forEach(([key, input]) => {
      input.addEventListener('input', () => previewLook({ [key]: input.value }));
      input.addEventListener('change', () => {
        saveLook({ themeOverrides: withOverride(key, input.value) }).catch((error) =>
          console.warn('[ED+] couleur non enregistrée :', error)
        );
      });
    });

    nodes.radius.addEventListener('input', () => {
      nodes.radiusValue.textContent = `${nodes.radius.value} px`;
      previewLook({ radius: `${nodes.radius.value}px` });
    });
    nodes.radius.addEventListener('change', () => {
      saveLook({ themeOverrides: withOverride('radius', `${nodes.radius.value}px`) }).catch((error) =>
        console.warn('[ED+] rayon non enregistré :', error)
      );
    });

    nodes.font.addEventListener('change', () => {
      saveLook({ themeOverrides: withOverride('font', nodes.font.value) }).catch((error) =>
        console.warn('[ED+] police non enregistrée :', error)
      );
    });

    // Densité : appliquée immédiatement au popup (applyLook pose l'attribut sur
    // <html>) et, par le stockage, à tous les onglets École Directe ouverts.
    nodes.density.addEventListener('change', () => {
      saveLook({ density: nodes.density.value }).catch((error) =>
        console.warn('[ED+] densité non enregistrée :', error)
      );
    });

    nodes.themeReset.addEventListener('click', () => {
      saveLook({ themeOverrides: {} })
        .then(() => toast('Couleurs et formes du préréglage restaurées.'))
        .catch((error) => console.warn('[ED+] réinitialisation du thème :', error));
    });
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

  // ---------------------------------------------------------------------------
  // Panneau de paramètres avancés
  // ---------------------------------------------------------------------------

  /**
   * Ouvre la seconde vue.
   *
   * On masque le contenu principal au lieu de le laisser au-dessus : le popup
   * ne fait que 360 px de large, et un panneau de réglages poussé sous la
   * moyenne demanderait un défilement long pour atteindre les premières cases.
   */
  function openAdvanced() {
    nodes.advanced.hidden = false;
    nodes.summary.hidden = true;
    nodes.actions.hidden = true;
    nodes.settings.hidden = true;
    nodes.privacy.hidden = true;

    if (nodes.main) nodes.main.scrollTop = 0;
    try {
      nodes.advancedBack.focus({ preventScroll: true });
    } catch (error) {
      nodes.advancedBack.focus();
    }
  }

  /** Referme la vue avancée et restitue le résumé. */
  function closeAdvanced() {
    nodes.advanced.hidden = true;
    nodes.summary.hidden = false;
    nodes.actions.hidden = false;
    nodes.settings.hidden = false;
    nodes.privacy.hidden = false;
    if (nodes.main) nodes.main.scrollTop = 0;
    try {
      nodes.openAdvanced.focus({ preventScroll: true });
    } catch (error) {
      nodes.openAdvanced.focus();
    }
  }

  // ---------------------------------------------------------------------------
  // Réglages
  // ---------------------------------------------------------------------------

  async function loadSettingsIntoUi() {
    const settings = await EDP.settings.get();
    currentSettings = settings;
    // applyLook() applique le mode ET la palette (préréglage + surcharges).
    EDP.theme.applyLook(settings);
    paintTheme();
    paintLookControls(settings);

    nodes.theme.value = settings.theme;
    nodes.enabled.checked = settings.enabled;
    nodes.modules.grades.checked = settings.modules.grades !== false;
    nodes.modules.sidebar.checked = settings.modules.sidebar !== false;
    nodes.modules.today.checked = settings.modules.today !== false;
    nodes.todayPlacement.value = settings.todayPlacement === 'panel' ? 'panel' : 'home';
    nodes.modules.simulator.checked = settings.modules.simulator !== false;
    nodes.modules.timetable.checked = settings.modules.timetable !== false;
    nodes.modules.homework.checked = settings.modules.homework !== false;
    nodes.modules.themeToggle.checked = settings.modules.themeToggle !== false;
    nodes.modules.averageHud.checked = settings.modules.averageHud !== false;
    nodes.badge.checked = settings.badgeNewGrades !== false;

    nodes.density.value = settings.density || 'normal';
    const hidden = Array.isArray(settings.hiddenElements) ? settings.hiddenElements : [];
    Object.entries(nodes.hideInputs).forEach(([id, input]) => {
      input.checked = hidden.includes(id);
    });

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

    nodes.todayPlacement.addEventListener('change', () =>
      EDP.settings.set({ todayPlacement: nodes.todayPlacement.value })
    );

    nodes.reset.addEventListener('click', async () => {
      await EDP.settings.reset();
      await loadSettingsIntoUi();
      toast('Réglages réinitialisés.');
      // loadSettingsIntoUi() vient de remettre le préréglage par défaut :
      // les contrôles d'apparence ont été repeints avec lui.
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

    // Vue avancée : le conteneur, son bouton de retour et les sections qu'elle
    // remplace. `hero` est la section du résumé (id="summary").
    nodes.main = document.querySelector('.edp-popup__main');
    nodes.summary = document.getElementById('summary');
    nodes.actions = document.querySelector('.edp-actions');
    nodes.privacy = document.querySelector('.edp-popup__privacy');
    nodes.advanced = document.getElementById('advanced');
    nodes.advancedBack = document.getElementById('advanced-back');
    nodes.openAdvanced = document.getElementById('advanced-open');
    nodes.density = document.getElementById('density');
    nodes.hideTargets = document.getElementById('hide-targets');
    nodes.hideInputs = {};

    nodes.enabled = document.getElementById('enabled');
    nodes.theme = document.getElementById('theme');
    nodes.presets = document.getElementById('presets');
    nodes.colors = {
      accent: document.getElementById('color-accent'),
      bg: document.getElementById('color-bg'),
      text: document.getElementById('color-text'),
      surface: document.getElementById('color-surface')
    };
    nodes.radius = document.getElementById('radius');
    nodes.radiusValue = document.getElementById('radius-value');
    nodes.font = document.getElementById('font');
    nodes.themeReset = document.getElementById('theme-reset');
    nodes.modules = {
      grades: document.getElementById('module-grades'),
      sidebar: document.getElementById('module-sidebar'),
      today: document.getElementById('module-today'),
      simulator: document.getElementById('module-simulator'),
      timetable: document.getElementById('module-timetable'),
      homework: document.getElementById('module-homework'),
      themeToggle: document.getElementById('module-theme-toggle'),
      averageHud: document.getElementById('module-average-hud')
    };
    nodes.todayPlacement = document.getElementById('today-placement');
    nodes.badge = document.getElementById('badge');
    nodes.reset = document.getElementById('reset');
  }

  async function main() {
    bindNodes();
    nodes.version.textContent = `v${EDP.VERSION} · non officiel`;

    buildFontChoices();
    buildDensityChoices();
    buildHideChoices();
    wireTheme();
    wireLook();
    wireSettings();
    nodes.openSite.addEventListener('click', openSite);
    nodes.openSimulator.addEventListener('click', openSimulator);
    nodes.openSettings.addEventListener('click', openAdvanced);
    nodes.openAdvanced.addEventListener('click', openAdvanced);
    nodes.advancedBack.addEventListener('click', closeAdvanced);

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
