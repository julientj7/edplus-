'use strict';
/**
 * content/features/cleanup.js
 * ---------------------------
 * Masque certains blocs du site d'origine (encarts, fil d'actualité, aides,
 * pied de page), au choix de l'utilisateur.
 *
 * Trois principes, identiques à ceux de la refonte des notes :
 *
 * 1. ON MASQUE, ON NE SUPPRIME PAS. Chaque nœud reçoit `data-edp-hidden="1"`,
 *    et c'est styles/features/cleanup.css qui le retire de l'affichage. Décocher
 *    la case suffit donc à tout restaurer, même sans recharger la page.
 *
 * 2. AUCUN SÉLECTEUR ICI. La connaissance du balisage d'École Directe vit dans
 *    content/data/source-dom.js (hideTargets), le seul fichier à adapter quand
 *    le site change. Ce module ne connaît que des identifiants.
 *
 * 3. LA DÉTECTION EST PRUDENTE. source-dom refuse de masquer un bloc qui
 *    contient les notes, l'emploi du temps, le cahier de textes ou nos propres
 *    interfaces : un sélecteur trop large ne peut pas vider l'écran.
 *
 * Le module n'a pas de clé dans `modules` : il est piloté par la liste
 * `hiddenElements`. Une liste vide (valeur par défaut) ne masque rien.
 */
(() => {
  const EDP = globalThis.EDP;

  /** Attribut posé sur les nœuds masqués ; lu par cleanup.css. */
  const MARK = 'data-edp-hidden';

  /** Marque les nœuds visés et démarque les anciens. */
  function apply(settings) {
    const source = EDP.data && EDP.data.sourceDom;
    if (!source || typeof source.hideTargets !== 'function') return;

    const wanted = settings && Array.isArray(settings.hiddenElements)
      ? settings.hiddenElements
      : [];

    const keep = new Set(source.hideTargets(wanted));

    keep.forEach((node) => {
      try {
        node.setAttribute(MARK, '1');
      } catch (error) {
        /* nœud protégé : ignoré */
      }
    });

    // Ce qui n'est plus demandé est restauré : on ne laisse jamais un bloc
    // masqué par un réglage que l'utilisateur a depuis décoché.
    EDP.dom.$$(`[${MARK}="1"]`).forEach((node) => {
      if (keep.has(node)) return;
      try {
        node.removeAttribute(MARK);
      } catch (error) {
        /* rien à faire */
      }
    });
  }

  EDP.registry.registerFeature({
    id: 'cleanup',
    label: 'Nettoyage de la page',

    // Monté dès qu'une collecte a eu lieu (donc tant que l'extension tourne) :
    // c'est la liste `hiddenElements` qui décide, et elle peut devenir non vide
    // à tout moment depuis les paramètres avancés. À l'arrêt, `ctx.data` vaut
    // null et le module est démonté — la page est alors rendue telle quelle.
    detect: (ctx) => Boolean(ctx && ctx.data),

    mount(ctx) {
      apply(ctx && ctx.settings);

      return {
        destroy() {
          // Restitution complète : la page redevient exactement celle d'origine.
          EDP.dom.$$(`[${MARK}="1"]`).forEach((node) => {
            try {
              node.removeAttribute(MARK);
            } catch (error) {
              /* rien à faire */
            }
          });
        }
      };
    },

    /**
     * Appelé à chaque synchronisation (changement de réglages, de route, de
     * DOM). C'est ce qui rend le masquage « vivant » : décocher une case
     * restaure immédiatement, et un bloc qui apparaît après un rechargement
     * Ajax est marqué au passage suivant.
     */
    update(ctx) {
      apply(ctx && ctx.settings);
    }
  });
})();
