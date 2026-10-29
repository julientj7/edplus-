'use strict';
/**
 * background/badge.js
 * -------------------
 * Pastille affichée sur l'icône de la barre d'outils.
 *
 * Usage unique et volontairement limité : signaler « N nouvelles notes depuis ta
 * dernière visite ». On n'affiche ni la moyenne ni la dernière note, pour ne pas
 * exposer de donnée scolaire sur un écran partagé (salle de classe, bureau…).
 */
(() => {
  const EDP = globalThis.EDP;
  const { API } = EDP;

  const COLOR = '#1f6feb';

  /** @param {number} count nombre de notes nouvelles (0 = pastille effacée) */
  async function set(count) {
    try {
      if (!count || count <= 0) return clear();
      await API.action.setBadgeText({ text: count > 99 ? '99+' : String(count) });
      await API.action.setBadgeBackgroundColor({ color: COLOR });
      return undefined;
    } catch (error) {
      // Certaines configurations (icône épinglée masquée) refusent la pastille :
      // ce n'est jamais une raison de faire échouer le reste.
      console.debug('[ED+] pastille indisponible :', error);
      return undefined;
    }
  }

  async function clear() {
    try {
      await API.action.setBadgeText({ text: '' });
    } catch (error) {
      console.debug('[ED+] effacement de la pastille impossible :', error);
    }
  }

  EDP.badge = { set, clear };
})();
