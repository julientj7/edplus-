'use strict';
/**
 * content/main.js
 * --------------
 * Orchestrateur du content script. Chargé en dernier : tout le reste est déjà
 * enregistré (fonctionnalités, sources, panneau…).
 *
 * Séquence de démarrage :
 *   1. réglages -> thème appliqué avant toute chose (évite un flash clair) ;
 *   2. panneau créé ;
 *   3. collecte des données + calcul des moyennes ;
 *   4. montage des fonctionnalités (registry.sync) ;
 *   5. publication du « snapshot » lisible par le popup ;
 *   6. surveillance : route, DOM, réglages.
 *
 * Garde-fous importants :
 *   - on ignore les mutations du DOM provoquées par nos propres nœuds, sinon
 *     l'insertion du résumé relance une collecte qui relance une insertion… ;
 *   - un seul recalcul à la fois, les demandes concurrentes sont fusionnées ;
 *   - l'arrêt (extension désactivée) démonte tout proprement.
 */
(() => {
  const EDP = globalThis.EDP;
  const { API, MESSAGES, STORAGE_KEYS, ROUTES } = EDP;

  let ctx = null;
  let panel = null;
  let running = false;
  let refreshing = false;
  let pendingReason = null;
  const teardown = [];

  /** Nos nœuds : à exclure de la surveillance du DOM. */
  function isOurNode(node) {
    if (!node || typeof node.closest !== 'function') return false;
    try {
      return Boolean(node.closest('#edp-panel-host, [id^="edp-"], [class*="edp-"]'));
    } catch (error) {
      return false;
    }
  }

  /** Pastille « nouvelles notes » : compare les empreintes vues et actuelles. */
  async function computeNewGrades(data) {
    const settings = data.settings;
    if (!settings.badgeNewGrades) return null;
    const fingerprints = data.grades
      .filter((grade) => grade.counted)
      .map((grade) => grade.id);
    const previous = (await EDP.settings.readKey(STORAGE_KEYS.seenGrades, null)) || null;

    // Premier passage : on mémorise sans rien annoncer (sinon la pastille
    // afficherait « 12 » au premier chargement, ce qui n'informe personne).
    if (!Array.isArray(previous)) {
      await EDP.settings.writeKey(STORAGE_KEYS.seenGrades, fingerprints.slice(-500));
      return null;
    }
    const known = new Set(previous);
    const fresh = fingerprints.filter((id) => !known.has(id));
    await EDP.settings.writeKey(
      STORAGE_KEYS.seenGrades,
      previous.concat(fresh.filter((id) => !previous.includes(id))).slice(-500)
    );
    return fresh.length ? fresh.length : 0;
  }

  /**
   * Résumé destiné au panneau fixe de moyenne.
   *
   * Sur un écran sans note (emploi du temps, messagerie…), la collecte est vide
   * et il n'y a rien à calculer : on relit alors le dernier relevé enregistré et
   * on le marque `stale`, pour que l'affichage ne fasse jamais passer une valeur
   * ancienne pour une valeur à jour.
   */
  let lastSavedSignature = '';

  async function averageSummary(snapshot) {
    const general = snapshot.general || {};
    const average = Number.isFinite(general.average20) ? general.average20 : null;

    if (average !== null) {
      const summary = {
        average20: average,
        classAverage: Number.isFinite(snapshot.classGeneral) ? snapshot.classGeneral : null,
        subjectsUsed: general.subjectsUsed || 0,
        gradeCount: (snapshot.counts && snapshot.counts.counted) || 0,
        period: snapshot.period || null,
        subjects: (snapshot.subjects || []).slice(0, 16),
        stale: false,
        at: Date.now()
      };

      // Le recalcul est déclenché à chaque mutation du DOM (toutes les 700 ms
      // au plus) : on n'écrit que si le contenu a réellement changé, sinon on
      // réveillerait le stockage pour rien.
      const signature = JSON.stringify([
        summary.average20,
        summary.classAverage,
        summary.gradeCount,
        summary.subjects
      ]);
      if (signature !== lastSavedSignature) {
        lastSavedSignature = signature;
        await EDP.settings.writeKey(STORAGE_KEYS.lastAverage, summary);
      }
      return summary;
    }

    // Des notes sont présentes mais aucune n'entre dans la moyenne (toutes
    // exclues par les réglages) : on n'affiche rien, un ancien relevé serait
    // trompeur.
    if (!snapshot.empty) return null;

    const last = await EDP.settings.readKey(STORAGE_KEYS.lastAverage, null);
    if (!last || !Number.isFinite(last.average20)) return null;
    return { ...last, stale: true };
  }

  /** Écrit le snapshot lisible par le popup et met à jour le panneau de moyenne. */
  async function publish() {
    if (!ctx) return null;
    const snapshot = EDP.data.toSnapshot();
    if (!snapshot) return null;

    snapshot.sections = EDP.registry.collect(ctx);
    const newGrades = await computeNewGrades(ctx.data);
    snapshot.newGrades = newGrades;

    const safe = JSON.parse(JSON.stringify(snapshot));
    await EDP.settings.writeKey(STORAGE_KEYS.snapshot, safe);
    if (newGrades !== null) EDP.messaging.notify(MESSAGES.NEW_GRADES, { count: newGrades });

    if (panel) {
      const hud = ctx.settings.modules.averageHud === false ? null : await averageSummary(safe);
      panel.setAverage(hud);
      if (safe.empty) panel.setStatus('Aucune note lisible sur cet écran.', 'muted');
      else if (safe.warnings && safe.warnings.length) panel.setStatus(safe.warnings[0], 'warning');
      else panel.setStatus('');
    }
    return safe;
  }

  /** Collecte + montage. Fusionne les demandes concurrentes. */
  async function refresh(reason = 'manual') {
    if (!running) return null;
    if (refreshing) {
      pendingReason = reason;
      return null;
    }
    refreshing = true;
    try {
      const settings = await EDP.settings.get();
      EDP.theme.applyLook(settings);
      const data = await EDP.data.collect({ settings });
      ctx = { settings, data, route: EDP.router.current, panel };
      await EDP.registry.sync(ctx);
      return await publish();
    } catch (error) {
      console.error('[ED+] recalcul en échec :', error);
      if (panel) panel.setStatus('Erreur interne, voir la console.', 'negative');
      return null;
    } finally {
      refreshing = false;
      if (pendingReason) {
        const next = pendingReason;
        pendingReason = null;
        Promise.resolve().then(() => refresh(next));
      }
    }
  }

  /** Montée initiale complète. */
  async function start() {
    const settings = await EDP.settings.get();
    EDP.theme.applyLook(settings);
    teardown.push(EDP.darkMode.start(() => (ctx && ctx.settings ? ctx.settings.theme : 'auto')));

    if (!settings.enabled) {
      console.info('[ED+] désactivée par les réglages.');
      return;
    }

    running = true;
    panel = await EDP.ui.panel.create({ version: EDP.VERSION });
    refresh('start');

    teardown.push(EDP.router.start(() => refresh('route')));
    teardown.push(
      EDP.dom.onDomChange(() => refresh('dom'), { delay: 700, ignore: (node) => isOurNode(node) })
    );
    teardown.push(EDP.darkMode.stop);

    EDP.settings.subscribe(async (next) => {
      if (!next.enabled) return stop();
      if (!running) return start();
      EDP.theme.applyLook(next);
      return refresh('settings');
    });
  }

  /** Arrêt propre : tout est démonté, la page redevient celle d'origine. */
  function stop() {
    running = false;
    EDP.registry.sync({ settings: { modules: {} }, data: null, route: ROUTES.OTHER, panel: null });
    if (panel) {
      panel.destroy();
      panel = null;
    }
    while (teardown.length) {
      const off = teardown.pop();
      try {
        if (typeof off === 'function') off();
      } catch (error) {
        console.debug('[ED+] arrêt partiel :', error);
      }
    }
    ctx = null;
    console.info('[ED+] désactivée, page rendue à son état d’origine.');
  }

  /** Diagnostic complet à lancer depuis la console de la page. */
  function debug() {
    console.groupCollapsed('[ED+] diagnostic');
    console.log('version :', EDP.VERSION, '| route :', EDP.router.current, '| source :', ctx && ctx.data ? ctx.data.source : '(aucune)');
    console.log('moyenne :', ctx && ctx.data ? ctx.data.general : '(pas de données)');
    console.table(EDP.registry.status());
    if (ctx && ctx.data) console.table(ctx.data.warnings.map((warning) => ({ avertissement: warning })));
    console.log('aide : EDP.data.sourceDom.debug() pour la lecture du site, EDP.router.debug() pour la route.');
    console.groupEnd();
    return { version: EDP.VERSION, route: EDP.router.current, state: ctx && ctx.data };
  }

  // Le content script répond au background, qui lui demande le snapshot à
  // l'ouverture du popup (voir background/background.js).
  //
  // Ce bloc est le SEUL point de démarrage qui dépend du routeur : il est donc
  // isolé dans un try/catch. Une erreur ici (routeur absent, API partielle) ne
  // doit jamais empêcher les moyennes, le thème et le panneau de fonctionner —
  // c'est exactement ce qui arrivait quand `EDP.messages` manquait : le script
  // mourait avant d'arriver à `EDP.dom.ready().then(start)`.
  try {
    EDP.messaging.register(API, {
    [MESSAGES.RESCAN]: async () => {
      if (!running) return null;
      return refresh('popup');
    },

    /**
     * Le popup demande l'ouverture du simulateur sur CETTE page.
     *
     * On répond `simulator: false` quand aucune note n'est lisible ici (emploi
     * du temps, messagerie…) : le popup explique alors quoi faire au lieu de se
     * fermer sans rien montrer. C'est la différence entre « ça n'a pas marché »
     * et « voici pourquoi ».
     */
    [MESSAGES.OPEN_SIMULATOR]: async () => {
      if (!running || !panel) return { opened: false, simulator: false };
      const mounted = EDP.registry
        .status()
        .some((feature) => feature.id === 'simulator' && feature.mounted);
      panel.reveal('simulator');
      return { opened: true, simulator: mounted };
    }
  });
  } catch (error) {
    console.error(
      '[ED+] routeur de messages indisponible : le popup ne pourra pas piloter cette page, ' +
        'mais le calcul des moyennes continue.',
      error
    );
  }

  EDP.debug = debug;
  EDP.start = start;
  EDP.stop = stop;

  /**
   * Diagnostic accessible depuis la console DE LA PAGE.
   *
   * Un content script vit dans un monde isolé : `EDP` n'existe pas pour les
   * scripts du site, donc `EDP.debug()` tapé dans la console de la page renvoie
   * « EDP is not defined » même quand tout fonctionne. On expose donc une seule
   * fonction, `edpStatus()`, via `wrappedJSObject` + `exportFunction` /
   * `cloneInto` (API propre à Firefox, absente ailleurs — d'où les gardes).
   *
   * Elle ne renvoie que des valeurs sérialisables et ne modifie rien : pas de
   * notes brutes, pas de réglages, aucune action possible. Sans ce point
   * d'entrée, diagnostiquer demanderait d'ouvrir « Inspecter » dans
   * about:debugging, ce qui n'a rien d'évident.
   */
  function exposeStatusToPage() {
    try {
      const pageWindow = window.wrappedJSObject;
      if (!pageWindow || typeof exportFunction !== 'function' || typeof cloneInto !== 'function') return;

      const snapshot = () => ({
        version: EDP.VERSION,
        running,
        route: EDP.router.current,
        source: ctx && ctx.data ? ctx.data.source : null,
        average: ctx && ctx.data && ctx.data.general ? ctx.data.general.average20 : null,
        warnings:
          ctx && ctx.data && Array.isArray(ctx.data.warnings) ? ctx.data.warnings.slice(0, 5) : [],
        theme: { ...EDP.theme.current, ...EDP.theme.look },
        modules: EDP.registry.status(),
        panel: Boolean(panel)
      });

      pageWindow.edpStatus = exportFunction(() => cloneInto(snapshot(), pageWindow), pageWindow);
    } catch (error) {
      console.debug('[ED+] diagnostic page indisponible :', error);
    }
  }

  exposeStatusToPage();

  EDP.dom.ready().then(start).catch((error) => {
    console.error('[ED+] démarrage impossible :', error);
  });
})();
