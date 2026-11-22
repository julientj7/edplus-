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
    seenGrades: 'edp.seenGrades',    // empreintes des notes déjà vues (pastille)
    lastAverage: 'edp.lastAverage'   // dernier relevé connu (panneau fixe de moyenne)
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
    /** Préréglage d'apparence (voir shared/theme-presets.js). */
    themePreset: 'clair-moderne',
    /**
     * Surcharges du préréglage, clé par clé : { accent, bg, text, surface,
     * radius, font }. Une clé absente ou invalide laisse le préréglage décider.
     */
    themeOverrides: {},
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
      /** Remplacement visuel de la barre latérale du site. */
      sidebar: true,
      /** Vue « Aujourd’hui » : cours, devoirs, notes, absences. */
      today: true,
      simulator: true,
      timetable: true,
      homework: true,
      /** Bouton flottant de bascule du mode sombre sur la page. */
      themeToggle: true,
      /** Panneau fixe affichant la moyenne générale en permanence. */
      averageHud: true
    },
    /** Pastille sur l'icône quand de nouvelles notes apparaissent. */
    badgeNewGrades: true,
    /** Barre latérale réduite (icônes seules). */
    sidebarCollapsed: false,
    /**
     * Densité de l'interface : 'compact' | 'normal' | 'spacious' (voir
     * EDP.DENSITIES et les blocs [data-edp-density] de styles/tokens.css).
     */
    density: 'normal',
    /**
     * Éléments du site d'origine masqués, par identifiant de EDP.HIDE_TARGETS.
     * Un tableau vide (défaut) ne masque rien : la page reste intacte tant que
     * l'utilisateur n'a pas coché quelque chose dans les paramètres avancés.
     */
    hiddenElements: [],
    /**
     * Graphiques d'évolution affichés sous le relevé de notes. Le bouton
     * « Masquer / Afficher les graphiques » écrit cette clé, ce qui la fait
     * retenir d'une visite à l'autre (voir content/features/charts.js).
     */
    chartsVisible: true,
    /**
     * Emplacement de la vue « Aujourd’hui » : 'home' remplace le contenu
     * principal de la page d'accueil, 'panel' l'affiche dans le tiroir avec un
     * bouton rapide (voir content/features/today.js).
     */
    todayPlacement: 'home'
  };

  /**
   * Densités proposées. Les valeurs numériques vivent dans tokens.css (elles
   * ne servent qu'au CSS) ; ici, uniquement les identifiants et les libellés,
   * pour que le popup et le content script parlent d'une seule liste.
   */
  EDP.DENSITIES = [
    { id: 'compact', label: 'Compact', hint: 'Marges et espacements réduits' },
    { id: 'normal', label: 'Normal', hint: 'La densité par défaut' },
    { id: 'spacious', label: 'Spacieux', hint: 'Plus d’air entre les blocs' }
  ];

  /**
   * Blocs du site d'origine que l'utilisateur peut masquer.
   *
   * Seuls les IDENTIFIANTS et les LIBELLÉS sont ici : les sélecteurs CSS, eux,
   * appartiennent à content/data/source-dom.js, le seul fichier qui connaisse le
   * balisage d'École Directe. Les deux listes se rejoignent par l'identifiant.
   */
  EDP.HIDE_TARGETS = [
    {
      id: 'ads',
      label: 'Encarts et bannières',
      hint: 'Blocs promotionnels, publicités, bannières' 
    },
    {
      id: 'news',
      label: 'Fil d’actualité',
      hint: 'Actualités et informations de l’établissement'
    },
    {
      id: 'help',
      label: 'Aides et tutoriels',
      hint: 'Encarts d’aide, tutoriels, messages d’assistance'
    },
    {
      id: 'footer',
      label: 'Pied de page',
      hint: 'Mentions légales et liens de bas de page'
    }
  ];

  /** Routes logiques détectées par content/core/router.js. */
  EDP.ROUTES = {
    HOME: 'home',
    NOTES: 'notes',
    TIMETABLE: 'timetable',
    HOMEWORK: 'homework',
    OTHER: 'other'
  };

  /** Types de messages échangés entre popup, background et content script. */
  EDP.MESSAGES = {
    GET_SNAPSHOT: 'edp:get-snapshot',
    RESCAN: 'edp:rescan',
    NEW_GRADES: 'edp:new-grades',
    /** Popup -> onglet : ouvrir le tiroir sur le simulateur de notes. */
    OPEN_SIMULATOR: 'edp:open-simulator'
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
