'use strict';
/**
 * shared/settings.js
 * ------------------
 * Point d'accès unique aux réglages, stockés dans `browser.storage.local`.
 *
 * Pourquoi `local` et pas `sync` : les réglages restent sur l'appareil de
 * l'utilisateur, aucune donnée scolaire ne part dans le cloud du navigateur.
 * C'est un argument de confiance central du projet, ne le changez pas sans
 * raison forte.
 *
 * Tous les contextes passent par ici : le popup écrit, le content script relit
 * et réagit via `subscribe()`, le background initialise les valeurs par défaut.
 */
(() => {
  const EDP = globalThis.EDP;
  const { API, STORAGE_KEYS, DEFAULTS } = EDP;

  /** Copie profonde d'une valeur simple (objets, tableaux, primitifs). */
  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function defaultSettings() {
    return clone(DEFAULTS);
  }

  /**
   * Fusionne un objet stocké avec les valeurs par défaut. Indispensable :
   * un utilisateur qui installe la v1.1 doit récupérer les nouvelles clés sans
   * perdre ses réglages, et un stockage corrompu ne doit jamais casser l'UI.
   */
  function merge(stored) {
    const base = defaultSettings();
    if (!stored || typeof stored !== 'object') return base;
    const merged = { ...base, ...stored };
    merged.modules = { ...base.modules, ...(stored.modules || {}) };
    merged.coefficientOverrides = { ...(stored.coefficientOverrides || {}) };
    merged.excludedSubjects = Array.isArray(stored.excludedSubjects)
      ? stored.excludedSubjects.slice()
      : [];
    return merged;
  }

  /** Lit les réglages courants (toujours un objet complet). */
  async function get() {
    const bag = await API.storage.local.get(STORAGE_KEYS.settings);
    return merge(bag[STORAGE_KEYS.settings]);
  }

  /** Met à jour partiellement les réglages et renvoie l'état final. */
  async function set(patch) {
    const current = await get();
    const next = merge({ ...current, ...patch });
    await API.storage.local.set({ [STORAGE_KEYS.settings]: next });
    return next;
  }

  /**
   * Écrit les valeurs par défaut UNIQUEMENT si rien n'est encore stocké.
   * Appelé par le background à l'installation : on ne veut pas écraser les
   * réglages d'un utilisateur qui met simplement à jour l'extension.
   */
  async function ensureDefaults() {
    const bag = await API.storage.local.get(STORAGE_KEYS.settings);
    if (bag[STORAGE_KEYS.settings]) return merge(bag[STORAGE_KEYS.settings]);
    const fresh = defaultSettings();
    await API.storage.local.set({ [STORAGE_KEYS.settings]: fresh });
    return fresh;
  }

  /** Remet tout à zéro (bouton « réinitialiser » du popup). */
  async function reset() {
    const fresh = defaultSettings();
    await API.storage.local.set({ [STORAGE_KEYS.settings]: fresh });
    return fresh;
  }

  /**
   * S'abonne aux changements de réglages. Le callback reçoit (nouveaux, anciens)
   * et n'est appelé que pour la clé des réglages, en zone `local`.
   * Renvoie une fonction de désabonnement.
   */
  function subscribe(callback) {
    const listener = (changes, area) => {
      if (area !== 'local') return;
      const change = changes[STORAGE_KEYS.settings];
      if (!change) return;
      callback(merge(change.newValue), merge(change.oldValue));
    };
    API.storage.onChanged.addListener(listener);
    return () => API.storage.onChanged.removeListener(listener);
  }

  /** Lecture/écriture d'une clé de stockage arbitraire (snapshot, simulation…). */
  async function readKey(key, fallback = null) {
    const bag = await API.storage.local.get(key);
    const value = bag[key];
    return value === undefined ? fallback : value;
  }

  async function writeKey(key, value) {
    await API.storage.local.set({ [key]: value });
    return value;
  }

  EDP.settings = {
    get,
    set,
    reset,
    merge,
    ensureDefaults,
    subscribe,
    readKey,
    writeKey,
    defaultSettings
  };
})();
