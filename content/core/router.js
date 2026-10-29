'use strict';
/**
 * content/core/router.js
 * ----------------------
 * Détecte l'écran courant d'École Directe : notes, emploi du temps, cahier de
 * textes, ou autre.
 *
 * Deux sources d'indices, dans cet ordre :
 *   1. les marqueurs déclarés dans content/data/source-dom.js (EDP.data.sourceDom.MARKERS)
 *      — c'est le seul fichier à adapter au site, cf. README ;
 *   2. l'URL (mot-clé dans le chemin ou le fragment), beaucoup plus stable.
 *
 * Ce routeur n'échoue jamais : s'il ne reconnaît rien, il renvoie OTHER et les
 * fonctionnalités qui ne dépendent pas d'un écran précis (le panneau, le
 * calculateur dès qu'une note est trouvée) continuent de fonctionner.
 */
(() => {
  const EDP = globalThis.EDP;
  const { $, $$, onDomChange } = EDP.dom;

  const URL_HINTS = [
    [EDP.ROUTES.NOTES, /notes?|evaluations?/i],
    [EDP.ROUTES.TIMETABLE, /emploi[-_ ]?du[-_ ]?temps|edt|timetable/i],
    [EDP.ROUTES.HOMEWORK, /cahier[-_ ]?(de[-_ ]?)?textes?|devoirs?|homework|agenda/i]
  ];

  let current = EDPSafe().detect();
  const listeners = new Set();

  function EDPSafe() {
    // Petit garde-fou de lecture : évite une ReferenceError si le module est
    // évalué avant que EDP ne soit complet (import partiel, tests…).
    return EDP.router || { detect: () => EDP.ROUTES.OTHER };
  }

  /** Marqueurs DOM du site, fournis par source-dom.js, sinon table vide. */
  function markers() {
    const source = EDP.data && EDP.data.sourceDom;
    return (source && source.MARKERS) || [];
  }

  /** Teste les marqueurs DOM en respectant l'ordre de priorité. */
  function detectFromDom() {
    for (const marker of markers()) {
      if (marker.selector && $(marker.selector)) return marker.route;
      if (marker.test && marker.test()) return marker.route;
    }
    return null;
  }

  /** Teste l'URL : fragment puis chemin (le fragment est plus spécifique). */
  function detectFromUrl() {
    const haystack = `${location.hash || ''} ${location.pathname || ''}`;
    for (const [route, pattern] of URL_HINTS) {
      if (pattern.test(haystack)) return route;
    }
    return null;
  }

  /**
   * Route courante. On croise les indices : l'URL d'abord (rapide), puis le DOM
   * (plus fiable quand le site ne change pas d'URL entre deux écrans).
   */
  function detect() {
    const fromUrl = detectFromUrl();
    const fromDom = detectFromDom();
    if (fromDom && (!fromUrl || fromUrl === fromDom)) return fromDom;
    return fromUrl || fromDom || EDP.ROUTES.OTHER;
  }

  /** Abonne un écouteur appelé uniquement quand la route change vraiment. */
  function subscribe(callback) {
    listeners.add(callback);
    return () => listeners.delete(callback);
  }

  function refresh(reason) {
    const next = detect();
    if (next === current) return current;
    const previous = current;
    current = next;
    listeners.forEach((callback) => {
      try {
        callback(next, previous, reason);
      } catch (error) {
        console.warn('[ED+] écouteur de route en échec :', error);
      }
    });
    return current;
  }

  /**
   * Démarre la surveillance : mutations du DOM (le site remplace ses écrans en
   * place) et changement de fragment (navigation interne).
   */
  function start() {
    const stopDom = onDomChange(() => refresh('dom'), { delay: 400 });
    const onHash = () => refresh('hash');
    window.addEventListener('hashchange', onHash);
    window.addEventListener('popstate', onHash);
    refresh('start');
    return () => {
      stopDom();
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('popstate', onHash);
    };
  }

  /** Diagnostic console : quels marqueurs répondent sur cet écran ? */
  function debug() {
    const table = markers().map((marker) => ({
      route: marker.route,
      selector: marker.selector || '(test)',
      present: marker.selector ? Boolean($(marker.selector)) : '(test)'
    }));
    console.groupCollapsed('[ED+] routeur');
    console.log('route détectée :', detect());
    console.log('URL :', location.href);
    console.table(table);
    console.groupEnd();
    return { route: detect(), url: location.href, markers: table };
  }

  EDP.router = {
    get current() {
      return current;
    },
    detect,
    start,
    refresh,
    subscribe,
    debug
  };
})();
