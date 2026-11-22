'use strict';
/**
 * shared/theme-presets.js
 * ----------------------
 * Les palettes prédéfinies, la liste des polices, et la résolution
 * « préréglage + surcharges utilisateur -> variables CSS ».
 *
 * Pourquoi un fichier séparé : ces données sont utilisées par le popup ET par
 * le content script (qui applique le thème sur la page). Les dupliquer, c'est
 * garantir qu'un jour les deux listes divergeront.
 *
 * Aucun accès au DOM, aucun accès au stockage : uniquement des données et des
 * fonctions pures. C'est ce qui permet de les tester hors navigateur et de les
 * charger dans n'importe quel contexte.
 *
 * Vocabulaire :
 *   - un PRÉRÉGLAGE (`preset`) porte deux palettes, une claire et une sombre,
 *     pour que « Suivre le système » fonctionne quel que soit le style choisi ;
 *   - une SURCHARGE (`override`) est une valeur choisie par l'utilisateur pour
 *     une clé précise (accent, bg, text, surface, radius, font). Elle est
 *     validée avant d'atteindre le CSS : une valeur bricolée à la main dans le
 *     stockage ne doit jamais finir dans `style.setProperty`.
 */
(() => {
  const EDP = globalThis.EDP;

  /** Polices proposées. `stack` est la valeur exacte de --edp-font. */
  const THEME_FONTS = [
    {
      id: 'system',
      label: 'Système',
      stack: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif'
    },
    {
      id: 'serif',
      label: 'Serif (lisible)',
      stack: 'Georgia, "Iowan Old Style", "Times New Roman", serif'
    },
    {
      id: 'mono',
      label: 'Chasse fixe',
      stack: 'ui-monospace, "SF Mono", "Cascadia Mono", Menlo, monospace'
    }
  ];

  /**
   * Les trois thèmes demandés. `mode` est la préférence appliquée quand on
   * clique le préréglage : un thème à fond noir n'a aucun sens en mode clair.
   * `hint` sert d'infobulle, jamais de texte principal.
   */
  const THEME_PRESETS = [
    {
      id: 'clair-moderne',
      label: 'Clair moderne',
      hint: 'Bleu franc, surfaces très douces',
      mode: 'light',
      light: {
        accent: '#2563eb',
        bg: '#ffffff',
        text: '#141821',
        surface: '#f7f9fc',
        radius: '10px',
        font: 'system'
      },
      dark: {
        accent: '#6ea8fe',
        bg: '#0f131a',
        text: '#e8ecf3',
        surface: '#151b24',
        radius: '10px',
        font: 'system'
      }
    },
    {
      id: 'sombre-elegant',
      label: 'Sombre élégant',
      hint: 'Violet profond, angles plus doux',
      mode: 'dark',
      light: {
        accent: '#4f46e5',
        bg: '#f7f5ff',
        text: '#171627',
        surface: '#efecfb',
        radius: '14px',
        font: 'system'
      },
      dark: {
        accent: '#a78bfa',
        bg: '#12101a',
        text: '#ece9f7',
        surface: '#1b1826',
        radius: '14px',
        font: 'system'
      }
    },
    {
      id: 'contraste-eleve',
      label: 'Contraste élevé',
      hint: 'Noir, blanc, jaune — angles nets',
      mode: 'dark',
      light: {
        accent: '#0033cc',
        bg: '#ffffff',
        text: '#000000',
        surface: '#f2f2f2',
        radius: '2px',
        font: 'system'
      },
      dark: {
        accent: '#ffdd00',
        bg: '#000000',
        text: '#ffffff',
        surface: '#111111',
        radius: '2px',
        font: 'system'
      }
    },
    {
      /**
       * Thème créé par l'utilisateur.
       *
       * Ses palettes de base sont neutres (celles du thème clair moderne) :
       * tout ce qui distingue « Personnalisé », ce sont les SURCHARGES. Le
       * popup les préremplit avec la palette affichée au moment du clic, pour
       * que partir de zéro ne fasse jamais sauter l'apparence d'un coup.
       * `mode: 'auto'` parce qu'un thème personnel doit suivre le système
       * comme les autres, sauf si l'utilisateur en décide autrement.
       */
      id: 'personnalise',
      label: 'Personnalisé',
      hint: 'Votre palette : partez du thème courant puis ajustez',
      mode: 'auto',
      light: {
        accent: '#2563eb',
        bg: '#ffffff',
        text: '#141821',
        surface: '#f7f9fc',
        radius: '10px',
        font: 'system'
      },
      dark: {
        accent: '#6ea8fe',
        bg: '#0f131a',
        text: '#e8ecf3',
        surface: '#151b24',
        radius: '10px',
        font: 'system'
      }
    }
  ];

  /** Clé de surcharge -> variable CSS qu'elle remplit. */
  const VARIABLES = {
    accent: '--edp-accent',
    bg: '--edp-bg',
    text: '--edp-text',
    surface: '--edp-surface',
    radius: '--edp-radius'
  };

  const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
  const RADIUS = /^(?:[0-9]|1[0-9]|2[0-4])px$/;

  /**
   * Normalise une couleur en #rrggbb.
   * Les inputs type="color" refusent la forme courte : sans cette conversion,
   * une valeur #0af saisie à la main s'afficherait comme du noir dans le popup
   * alors qu'elle serait bien appliquée sur la page.
   */
  function normalizeHex(value) {
    if (typeof value !== 'string') return null;
    const hex = value.trim().toLowerCase();
    if (!HEX.test(hex)) return null;
    if (hex.length === 4) return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
    return hex;
  }

  function presetById(id) {
    return THEME_PRESETS.find((preset) => preset.id === id) || THEME_PRESETS[0];
  }

  function fontById(id) {
    return THEME_FONTS.find((font) => font.id === id) || THEME_FONTS[0];
  }

  /**
   * Ne garde que les surcharges exploitables. Toute valeur refusée est
   * simplement ignorée : le préréglage reprend la main, sans erreur visible.
   */
  function sanitizeOverrides(overrides) {
    const clean = {};
    if (!overrides || typeof overrides !== 'object') return clean;

    Object.keys(VARIABLES).forEach((key) => {
      const value = overrides[key];
      if (typeof value !== 'string') return;
      if (key === 'radius') {
        if (RADIUS.test(value)) clean.radius = value;
        return;
      }
      const hex = normalizeHex(value);
      if (hex) clean[key] = hex;
    });

    if (THEME_FONTS.some((font) => font.id === overrides.font)) clean.font = overrides.font;
    return clean;
  }

  /**
   * Palette effective : celle du préréglage pour le mode RÉSOLU (clair/sombre),
   * recouverte par les surcharges valides.
   * @param {string} presetId identifiant de préréglage (inconnu -> défaut)
   * @param {'light'|'dark'} resolved thème effectif
   * @param {object} overrides surcharges utilisateur
   */
  function paletteFor(presetId, resolved, overrides) {
    const preset = presetById(presetId);
    const base = resolved === 'dark' ? preset.dark : preset.light;
    return { ...base, ...sanitizeOverrides(overrides) };
  }

  /**
   * Variables CSS à écrire sur <html> pour une palette donnée.
   * Les valeurs vides sont absentes : l'appelant retire alors la variable, et
   * le préréglage de tokens.css reprend la main.
   */
  function varsFor(presetId, resolved, overrides) {
    const palette = paletteFor(presetId, resolved, overrides);
    const vars = {};
    Object.keys(VARIABLES).forEach((key) => {
      if (palette[key]) vars[VARIABLES[key]] = palette[key];
    });
    vars['--edp-font'] = fontById(palette.font).stack;
    return vars;
  }

  EDP.themePresets = {
    THEME_FONTS,
    THEME_PRESETS,
    VARIABLES,
    presetById,
    fontById,
    normalizeHex,
    sanitizeOverrides,
    paletteFor,
    varsFor
  };
})();
