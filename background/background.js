'use strict';
/**
 * background/background.js
 * ------------------------
 * Event page (Firefox) / service worker (Chromium) — voir `background` dans le
 * manifeste.
 *
 * Est-il vraiment nécessaire ? Oui, mais pour trois choses seulement :
 *   1. initialiser les réglages par défaut à l'installation ;
 *   2. servir de cache partagé pour le popup (le « snapshot » calculé par le
 *      content script), ce qui évite d'ouvrir un onglet École Directe juste
 *      pour afficher la moyenne ;
 *   3. mettre à jour la pastille de l'icône.
 *
 * Ce fichier ne contient AUCUN état persistant en mémoire : il peut être
 * déchargé à tout moment par le navigateur. Tout vit dans storage.local.
 */
(() => {
  const EDP = globalThis.EDP;
  const { API, MESSAGES, STORAGE_KEYS } = EDP;

  /** Durée pendant laquelle un snapshot est considéré comme frais. */
  const SNAPSHOT_TTL = 5 * 60 * 1000;

  /** Onglet actif, sans demander la permission "tabs" (on n'a besoin que de l'id). */
  async function getActiveTab() {
    const tabs = await API.tabs.query({ active: true, currentWindow: true });
    return tabs && tabs.length ? tabs[0] : null;
  }

  /**
   * Renvoie le snapshot au popup. S'il est absent ou périmé, on demande d'abord
   * au content script de l'onglet actif de recalculer — mais on ne bloque jamais
   * la réponse plus longtemps que nécessaire : une page non ouverte sur École
   * Directe renvoie simplement « rien ».
   */
  async function handleGetSnapshot() {
    const stored = await EDP.settings.readKey(STORAGE_KEYS.snapshot, null);
    const fresh = stored && Date.now() - (stored.at || 0) < SNAPSHOT_TTL;
    if (fresh) return stored;

    const tab = await getActiveTab();
    if (!tab || tab.id === undefined) return stored;

    try {
      const response = await API.tabs.sendMessage(tab.id, { type: MESSAGES.RESCAN });
      if (response && response.ok && response.data) return response.data;
    } catch (error) {
      // Aucun content script dans cet onglet (page non École Directe, onglet
      // en cours de chargement…) : ce n'est pas une erreur pour l'utilisateur.
      console.debug('[ED+] aucun content script joignable :', error);
    }
    return stored;
  }

  /** Notes nouvelles signalées par le content script -> pastille. */
  async function handleNewGrades(message) {
    const settings = await EDP.settings.get();
    if (!settings.badgeNewGrades) return EDP.badge.clear();
    return EDP.badge.set(Number(message.count) || 0);
  }

  /** À l'installation : réglages par défaut + pastille propre. */
  API.runtime.onInstalled.addListener(async () => {
    try {
      await EDP.settings.ensureDefaults();
      await EDP.badge.clear();
      // On invalide le snapshot : après une mise à jour, l'ancien format de
      // données ne doit pas être réutilisé par le popup.
      await EDP.settings.writeKey(STORAGE_KEYS.snapshot, null);
    } catch (error) {
      console.warn('[ED+] initialisation incomplète :', error);
    }
  });

  EDP.messages.register(API, {
    [MESSAGES.GET_SNAPSHOT]: handleGetSnapshot,
    [MESSAGES.NEW_GRADES]: handleNewGrades
  });
})();
