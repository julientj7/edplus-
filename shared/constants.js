'use strict';
/**
 * shared/constants.js
 * -------------------
 * Crée l'espace de noms global `EDP` et y déclare tout ce qui est partagé entre
 * les trois contextes de l'extension :
 *   - content script  (isolated world de la page ecoledirecte.com)
 *   - event page      (background, voir manifest.json -> background.scripts)
 *   - popup           (popup/popup.html)
 *
 * IMPORTANT : ce fichier doit être chargé EN PREMIER dans chacun des trois
 * contextes (il est listé en tête de `content_scripts.js`, `background.scripts`
 * et dans les <script> de popup.html). Les scripts sont « classic » (pas des
 * modules ES) : ils partagent la même portée globale et communiquent donc
 * uniquement par `globalThis.EDP`.
 */
(() => {
  /** Espace de noms unique, créé une seule fois même si le script est réévalué. */
  const EDP = (globalThis.EDP = globalThis.EDP || {});

  /** Version affichée dans le popup. Doit rester alignée avec manifest.version. */
  EDP.VERSION = '1.0.0';

  /** Préfixe de tous les attributs `data-edp-*`, classes `.edp-*` et messages. */
  EDP.NS = 'edp';

  /**
   * Pont d'API : Firefox expose `browser` (basé sur les promesses),
   * Chromium expose `chrome`. On garde `browser` en priorité pour Firefox.
   */
  EDP.API = globalThis.browser ?? globalThis.chrome;

  /** Clés de stockage. Préfixées pour rester lisibles dans l'inspecteur. */
  EDP.STORAGE_KEYS = {
    settings: 'edp.settings',        // réglages utilisateur (voir DEFAULTS)
    snapshot: 'edp.snapshot',        // dernier état calculé, écrit par le content script
    simulation: 'edp.simulation',    // notes fictives du simulateur (jamais envoyées)
    seenGrades: 'edp.seenGrades'     // empreintes des notes déjà vues (pastille)
  };

  /**
   * Réglages par défaut. `shared/settings.js` fusionne toujours ce socle avec
   * ce qui est réellement stocké, donc ajouter une clé ici suffit : les
   * utilisateurs existants la reçoivent automatiquement.
   */
  EDP.DEFAULTS = {
    enabled: true,
    /** 'auto' suit prefers-color-scheme, sinon 'light' / 'dark'. */
    theme: 'auto',
    /** Utiliser les coefficients de matière pour la moyenne générale. */
    useSubjectCoefficients: true,
    /** Utiliser les coefficients de devoir à l'intérieur d'une matière. */
    useGradeCoefficients: true,
    /** Exclure du calcul les notes marquées « non significative » par le site. */
    excludeNonSignificant: true,
    /** Matières ignorées dans la moyenne générale (ex. EPS, options). */
    excludedSubjects: [],
    /** Coefficients corrigés à la main : { "Mathématiques": 6 }. */
    coefficientOverrides: {},
    /** Activation module par module. */
    modules: {
      grades: true,
      simulator: true,
      timetable: true,
      homework: true,
      /** Bouton flottant de bascule du mode sombre sur la page. */
      themeToggle: true
    },
    /** Pastille sur l'icône quand de nouvelles notes apparaissent. */
    badgeNewGrades: true
  };

  /** Routes logiques détectées par content/core/router.js. */
  EDP.ROUTES = {
    NOTES: 'notes',
    TIMETABLE: 'timetable',
    HOMEWORK: 'homework',
    OTHER: 'other'
  };

  /** Types de messages échangés entre popup, background et content script. */
  EDP.MESSAGES = {
    GET_SNAPSHOT: 'edp:get-snapshot',
    RESCAN: 'edp:rescan',
    NEW_GRADES: 'edp:new-grades'
  };

  /**
   * Statut d'une note, tel que compris depuis la page :
   *   COUNTED         : compte normalement dans la moyenne
   *   NOT_COUNTED     : affichée mais hors moyenne (note éliminée, rattrapage…)
   *   NON_SIGNIFICANT : « non significative » au sens École Directe
   *   ABSENT          : l'élève était absent, aucune valeur exploitable
   */
  EDP.GRADE_STATUS = {
    COUNTED: 'counted',
    NOT_COUNTED: 'notCounted',
    NON_SIGNIFICANT: 'nonSignificant',
    ABSENT: 'absent'
  };
})();
