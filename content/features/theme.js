'use strict';
/**
 * content/features/theme.js
 * ------------------------
 * Applique et persiste le thème choisi.
 *
 * Trois attributs, trois rôles distincts, posés sur <html> :
 *   data-edp-theme="light|dark"  -> valeur EFFECTIVE, lue par nos variables CSS
 *   data-edp-dark="1|0"          -> cible des surcharges du site (styles/dark.css)
 *   data-edp-theme-pref="auto|light|dark" -> ce que l'utilisateur a DEMANDÉ
 *
 * Pourquoi séparer la préférence de la valeur effective : en mode « auto », le
 * thème suit le système. Sans les deux, impossible de savoir si l'utilisateur a
 * volontairement choisi le clair ou s'il suit simplement son système — et donc
 * impossible de basculer correctement depuis le bouton.
 *
 * Aucune modification du DOM métier : uniquement des attributs et du CSS.
 */
(() => {
  const EDP = globalThis.EDP;

  const THEMES = ['auto', 'light', 'dark'];

  /** Événement émis quand le thème effectif change (bouton, popup, système). */
  const EVENT = 'edp:theme-changed';

  let current = { preference: 'auto', resolved: 'light' };

  /** Le système est-il en sombre ? (jamais d'exception qui remonte) */
  function systemPrefersDark() {
    try {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch (error) {
      return false;
    }
  }

  /** Ramène une valeur inconnue à 'auto' : un stockage abîmé ne casse rien. */
  function normalize(preference) {
    return THEMES.includes(preference) ? preference : 'auto';
  }

  /** Résout 'auto' en 'light'/'dark' selon le système. */
  function resolve(preference) {
    const wanted = normalize(preference);
    if (wanted !== 'auto') return wanted;
    return systemPrefersDark() ? 'dark' : 'light';
  }

  /**
   * Préférence à enregistrer quand on clique sur le bouton.
   *
   * Le bouton n'a que deux états, donc il FORCE explicitement l'inverse de ce
   * qui est affiché. Conséquence assumée : un premier clic en mode « auto »
   * quitte le suivi du système. C'est le comportement attendu d'un interrupteur
   * — et « Suivre le système » reste disponible dans le popup, avec l'état
   * visible dans le bouton (lune = sombre, soleil = clair).
   *
   * Fonction pure (aucun accès au DOM) : testée par scripts/self-check.mjs.
   */
  function nextPreference(resolved) {
    return resolved === 'dark' ? 'light' : 'dark';
  }

  /** Prévient qui écoute (bouton, panneau, popup ouvert sur la page). */
  function emit() {
    try {
      window.dispatchEvent(new CustomEvent(EVENT, { detail: { ...current } }));
    } catch (error) {
      console.debug('[ED+] diffusion du thème impossible :', error);
    }
  }

  /**
   * Applique une préférence et renvoie le thème effectif.
   * N'émet l'événement QUE si quelque chose change : le contenu du content
   * script appelle apply() à chaque recalcul, et un événement par recalcul
   * ferait clignoter le bouton pour rien.
   */
  function apply(preference) {
    const wanted = normalize(preference);
    const resolved = resolve(wanted);
    const root = document.documentElement;
    if (!root) return resolved;

    root.dataset.edpTheme = resolved;
    root.dataset.edpDark = resolved === 'dark' ? '1' : '0';
    root.dataset.edpThemePref = wanted;

    const changed = current.preference !== wanted || current.resolved !== resolved;
    current = { preference: wanted, resolved };
    if (changed) emit();
    return resolved;
  }

  /** Applique ET enregistre (le stockage est la source de vérité des réglages). */
  async function set(preference) {
    const wanted = normalize(preference);
    const resolved = apply(wanted);
    try {
      await EDP.settings.set({ theme: wanted });
    } catch (error) {
      // L'application visuelle reste valable pour la session en cours.
      console.warn('[ED+] thème non enregistré :', error);
    }
    return resolved;
  }

  /** Bascule clair <-> sombre, en enregistrant le choix. */
  async function toggle() {
    return set(nextPreference(current.resolved));
  }

  /**
   * S'abonne aux changements de thème effectif.
   * @param {(state: {preference: string, resolved: string}) => void} callback
   * @returns {() => void} désabonnement
   */
  function onChange(callback) {
    const listener = (event) => {
      try {
        callback(event.detail || { ...current });
      } catch (error) {
        console.warn('[ED+] écouteur de thème en échec :', error);
      }
    };
    window.addEventListener(EVENT, listener);
    return () => window.removeEventListener(EVENT, listener);
  }

  EDP.theme = {
    get current() {
      return { ...current };
    },
    THEMES,
    EVENT,
    normalize,
    resolve,
    apply,
    set,
    toggle,
    nextPreference,
    onChange,
    systemPrefersDark
  };
})();
