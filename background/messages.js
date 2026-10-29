'use strict';
/**
 * background/messages.js
 * ----------------------
 * Petit routeur de messages : une table `type -> handler`, un seul listener.
 *
 * Pourquoi un routeur plutôt qu'un addListener par fichier : dans une event page
 * MV3 (ou un service worker), chaque `onMessage.addListener` supplémentaire
 * empêche le navigateur de se contenter d'une réponse et complique le
 * raisonnement asynchrone. Un listener unique qui renvoie toujours une promesse
 * sérialisée est plus simple à débugger.
 *
 * Contrat de réponse : { ok: true, data } ou { ok: false, error }.
 * Ce même module est réutilisé par le content script (voir content/main.js),
 * avec la même table de handlers côté page.
 */
(() => {
  const EDP = globalThis.EDP;

  /**
   * @param {object} api   API navigateur du contexte appelant (EDP.API)
   * @param {Record<string, Function>} table type de message -> handler(message, sender)
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
            // Une erreur de handler ne doit jamais casser le canal : on la
            // renvoie au demandeur, qui décidera de l'afficher.
            console.warn('[ED+] handler en échec :', message.type, error);
            sendResponse({ ok: false, error: String((error && error.message) || error) });
          }
        );

      return true; // réponse asynchrone
    });
  }

  EDP.messages = { register };
})();
