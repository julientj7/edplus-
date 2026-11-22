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

  /**
   * Habillage courant : préréglage + surcharges utilisateur.
   *
   * Mémorisé ici, et non relu du stockage à chaque fois, parce que `apply()`
   * doit repeindre les VARIABLES quand le mode change tout seul (passage du
   * système en sombre, par exemple) : le préréglage possède une palette par
   * mode, il faut donc savoir lequel appliquer.
   */
  let look = { preset: 'clair-moderne', overrides: {} };

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
   * Écrit les variables du préréglage courant sur <html>.
   *
   * L'écriture est INLINE, donc elle l'emporte sur tokens.css sans que ce
   * fichier ait à connaître un seul préréglage. Les valeurs sont validées en
   * amont par shared/theme-presets.js : rien d'arbitraire n'arrive ici.
   */
  function paintVariables(resolved, root) {
    const presets = EDP.themePresets;
    if (!presets || !root || !root.style) return;
    const vars = presets.varsFor(look.preset, resolved, look.overrides);
    Object.keys(vars).forEach((name) => {
      if (vars[name]) root.style.setProperty(name, vars[name]);
      else root.style.removeProperty(name);
    });
    root.dataset.edpPreset = presets.presetById(look.preset).id;
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
    paintVariables(resolved, root);

    const changed = current.preference !== wanted || current.resolved !== resolved;
    current = { preference: wanted, resolved };
    if (changed) emit();
    return resolved;
  }

  /**
   * Pose la densité d'interface sur <html>.
   *
   * La densité ne change AUCUNE couleur : elle ne fait que sélectionner un bloc
   * de variables d'espacement dans tokens.css. Comme ces variables sont
   * héritées, le panneau, son shadow root et les écrans refondus suivent
   * immédiatement, sans une seule règle supplémentaire.
   * @param {string} value identifiant de EDP.DENSITIES
   */
  function paintDensity(value) {
    const root = document.documentElement;
    if (!root) return;
    const known = (EDP.DENSITIES || []).map((density) => density.id);
    root.dataset.edpDensity = known.includes(value) ? value : 'normal';
  }

  /**
   * Applique un habillage complet (mode + préréglage + surcharges + densité).
   *
   * C'est le point d'entrée à utiliser quand on dispose de l'objet de réglages
   * entier — content script et popup s'en servent. `apply()` reste disponible
   * pour le seul bouton de bascule, qui ne change que le mode.
   * @param {object} settings réglages complets (ou partiels)
   * @returns {'light'|'dark'} thème effectif
   */
  function applyLook(settings) {
    const source = settings || {};
    look = {
      preset: source.themePreset || 'clair-moderne',
      overrides: source.themeOverrides || {}
    };
    paintDensity(source.density);
    return apply(source.theme || 'auto');
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
    /** Préréglage et surcharges actuellement appliqués (diagnostic, popup). */
    get look() {
      return { preset: look.preset, overrides: { ...look.overrides } };
    },
    THEMES,
    EVENT,
    normalize,
    resolve,
    apply,
    applyLook,
    set,
    toggle,
    nextPreference,
    onChange,
    systemPrefersDark
  };
})();
