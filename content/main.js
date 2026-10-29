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
  const { formatFr } = EDP.utils;

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

  /** Écrit le snapshot lisible par le popup et met à jour la pastille. */
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
      const average = safe.general ? safe.general.average20 : null;
      panel.setLauncher(average === null ? 'ED+' : formatFr(average));
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
      EDP.theme.apply(settings.theme);
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
    EDP.theme.apply(settings.theme);
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
      EDP.theme.apply(next.theme);
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
  EDP.messages.register(API, {
    [MESSAGES.RESCAN]: async () => {
      if (!running) return null;
      return refresh('popup');
    }
  });

  EDP.debug = debug;
  EDP.start = start;
  EDP.stop = stop;

  EDP.dom.ready().then(start).catch((error) => {
    console.error('[ED+] démarrage impossible :', error);
  });
})();
