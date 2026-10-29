'use strict';
/**
 * content/features/dark-mode.js
 * ----------------------------
 * Suivi du thème du système d'exploitation.
 *
 * Séparé de theme.js volontairement : theme.js sait *appliquer* un thème, ce
 * fichier sait *quand* le refaire. C'est la seule partie du module de thème qui
 * garde un écouteur vivant, et elle doit pouvoir être arrêtée proprement
 * (le content script peut être déchargé ou l'extension désactivée).
 */
(() => {
  const EDP = globalThis.EDP;

  let mediaQuery = null;
  let listener = null;

  /**
   * Réagit aux bascules clair/sombre du système.
   * @param {() => string} getPreference renvoie la préférence courante ('auto'…)
   * @returns {() => void} fonction d'arrêt
   */
  function start(getPreference) {
    stop();
    try {
      mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    } catch (error) {
      console.debug('[ED+] prefers-color-scheme indisponible :', error);
      return () => {};
    }

    listener = () => {
      // En mode explicite (clair ou sombre forcé), le système n'a pas voix au
      // chapitre : on ne réapplique rien.
      const preference = typeof getPreference === 'function' ? getPreference() : 'auto';
      if (preference !== 'auto') return;
      // theme.apply() diffuse lui-même « edp:theme-changed » quand le thème
      // effectif change : pas besoin de le refaire ici, sinon le bouton de
      // bascule recevrait deux fois l'événement pour un seul changement.
      EDP.theme.apply(preference);
    };

    // addEventListener est supporté par les navigateurs modernes ; le repli
    // addListener couvre d'anciennes versions de WebKit.
    if (mediaQuery.addEventListener) mediaQuery.addEventListener('change', listener);
    else if (mediaQuery.addListener) mediaQuery.addListener(listener);

    return stop;
  }

  function stop() {
    if (!mediaQuery || !listener) return;
    if (mediaQuery.removeEventListener) mediaQuery.removeEventListener('change', listener);
    else if (mediaQuery.removeListener) mediaQuery.removeListener(listener);
    mediaQuery = null;
    listener = null;
  }

  EDP.darkMode = { start, stop };
})();
