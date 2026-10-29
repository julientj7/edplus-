/**
 * .web-ext-config.mjs — configuration de l'outillage web-ext (lint / run / build).
 *
 * Rôle : garder les outils de développement HORS du paquet livré. Sans ça,
 * `web-ext build` embarquerait scripts/self-check.mjs et le plan `structure`
 * dans le .xpi, et `web-ext lint` les analysait comme du code d'extension
 * (avertissements UNSAFE_VAR_ASSIGNMENT et FLAGGED_FILE_TYPE sans objet).
 *
 * Extension .mjs obligatoire : web-ext refuse désormais un fichier `.js` dont le
 * format est ambigu (« should be renamed to ".cjs" or ".mjs" »), et un fichier
 * CommonJS y est même rejeté comme une option mal nommée (`module.exports`).
 * Le format ESM est donc le seul qui fonctionne ici.
 */
export default {
  ignoreFiles: [
    'scripts/**',                  // générateur d'icônes et auto-vérifications (dev uniquement)
    'manifest.annotated.jsonc',    // documentation commentée : jamais livrée ni chargée
    'structure',                   // plan d'arborescence de départ, conservé comme note de conception
    '.gitignore',
    '.web-ext-config.mjs',         // le fichier de configuration lui-même
    'web-ext-artifacts/**'
  ]
};
