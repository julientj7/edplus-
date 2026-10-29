'use strict';
/**
 * content/core/messaging.js
 * ------------------------
 * Version content script du routeur de messages.
 *
 * Le module `background/messages.js` fournit le listener ; celui-ci fournit le
 * côté appelant. Les deux sont séparés parce qu'ils ne s'exécutent pas dans le
 * même contexte et que le content script doit, lui, pouvoir envoyer vers le
 * background sans risque d'erreur bruyante : si l'event page est déchargé, ou si
 * aucun récepteur n'écoute, on veut un `null` silencieux, pas une exception qui
 * remonte dans le calcul des moyennes.
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

  EDP.messaging = { send, notify };
})();
