'use strict';
/**
 * content/core/messaging.js
 * ------------------------
 * Version content script du routeur de messages.
 *
 * Ce fichier fournit les deux côtés côté page : l'envoi (`send`/`notify`, qui
 * ne doit jamais lever — event page déchargée, onglet fermé) et la réception
 * (`register`), utilisée par main.js pour répondre au popup. Le background a
 * son propre routeur, `background/messages.js` : aucun fichier du background
 * n'est chargé comme content script, ce qui évite qu'un oubli dans le manifeste
 * fasse tomber toute l'extension.
 */
(() => {
  const EDP = globalThis.EDP;
  const { API } = EDP;

  /**
   * Envoie un message au background (ou à un onglet si `tabId` est fourni).
   * @returns {Promise<any|null>} la donnée utile, ou null si personne n'écoute
   */
  async function send(type, payload = null, { tabId = null } = {}) {
    const message = { type, ...(payload || {}) };
    try {
      const response = tabId === null
        ? await API.runtime.sendMessage(message)
        : await API.tabs.sendMessage(tabId, message);
      if (response && response.ok) return response.data;
      if (response && response.ok === false) {
        console.debug('[ED+] message refusé :', type, response.error);
      }
      return null;
    } catch (error) {
      // Cas normal : background endormi, onglet fermé, extension rechargée.
      console.debug('[ED+] message sans destinataire :', type, error);
      return null;
    }
  }

  /** Fire-and-forget : pour les signalements dont on n'attend pas de réponse. */
  function notify(type, payload = null) {
    send(type, payload).catch(() => {});
  }

  /**
   * Installe le routeur du content script : une table `type -> handler` et un
   * seul listener sur `runtime.onMessage`.
   *
   * Pourquoi ce routeur vit ICI et non dans `background/messages.js` : ce
   * dernier a un temps été listé dans `content_scripts.js` pour être réutilisé
   * côté page. Un oubli dans le manifeste suffisait alors à faire tomber tout le
   * content script (`EDP.messages` indéfini), donc plus aucune moyenne. Chaque
   * contexte a désormais son propre fichier, et le content script ne dépend
   * d'aucun fichier du background.
   */
  function register(api, table) {
    api.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!message || typeof message.type !== 'string') return false;
      const handler = table[message.type];
      if (typeof handler !== 'function') return false; // laisse passer aux autres

      Promise.resolve()
        .then(() => handler(message, sender))
        .then(
          (data) => sendResponse({ ok: true, data }),
          (error) => {
            console.warn('[ED+] handler en échec :', message.type, error);
            sendResponse({ ok: false, error: String((error && error.message) || error) });
          }
        );

      return true; // réponse asynchrone
    });
  }

  EDP.messaging = { send, notify, register };
})();
