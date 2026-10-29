'use strict';
/**
 * content/data/source-api.js
 * --------------------------
 * Emplacement réservé pour la seconde source de données : l'API interne du site
 * (POST /v3/login.awp, notes.awp, emploidutemps.awp…).
 *
 * EST VOLONTAIREMENT NON IMPLÉMENTÉE EN v1.0. Trois raisons, à connaître avant
 * de s'y attaquer :
 *   1. l'authentification passe par des cookies (GTK) + un en-tête X-Gtk + un
 *      jeton lié à l'user-agent, et souvent par un QCM de double authentification :
 *      hors de question de rejouer un login et de manipuler les identifiants de
 *      l'utilisateur ;
 *   2. la voie propre consiste à OBSERVER les réponses que la page authentifiée
 *      demande déjà pour son compte (hook de XHR/fetch dans le monde de la page),
 *      puis à récupérer le JSON sans jamais toucher aux identifiants ;
 *   3. ce hook demande un content script en `world: "MAIN"` (Firefox 128+) ou une
 *      ressource web-accessible injectée, donc un vrai changement de manifeste.
 *
 * L'interface ci-dessous existe pour que l'ajout se fasse SANS toucher au reste :
 * adapter.js interroge les sources dans l'ordre et prend la première disponible.
 * Quand vous l'implémenterez, gardez `available()` honnête : renvoyer true sans
 * données casse silencieusement toutes les moyennes.
 */
(() => {
  const EDP = globalThis.EDP;

  /**
   * @returns {boolean} toujours false en v1.0 : la source DOM est la seule active.
   */
  function available() {
    return false;
  }

  /**
   * @returns {Promise<{ grades: object[], period: string|null, warnings: string[] }>}
   */
  async function read() {
    return {
      grades: [],
      period: null,
      warnings: ['Source API non implémentée : voir content/data/source-api.js.']
    };
  }

  /** Documentation de la voie à suivre, affichée par EDP.debug(). */
  const HOWTO = [
    'Ajouter au manifeste un second content_scripts avec "world": "MAIN" et',
    'strict_min_version 128, chargé avant celui-ci sur la même page.',
    'Ce script enveloppe XMLHttpRequest.open/send et window.fetch, repère les',
    'réponses de notes.awp et les poste via window.postMessage (source "edp-page-hook").',
    'Le content script isolé valide event.source === window, lit le JSON et le passe',
    'à EDP.model.buildBundle(). Aucun identifiant n’est lu ni stocké.'
  ];

  EDP.data = EDP.data || {};
  EDP.data.sourceApi = { id: 'api', available, read, HOWTO };
})();
