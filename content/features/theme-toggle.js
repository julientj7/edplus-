'use strict';
/**
 * content/features/theme-toggle.js
 * --------------------------------
 * Bouton flottant « mode sombre », au-dessus de la pastille École Directe Plus+.
 *
 * Trois décisions, chacune pour une raison précise :
 *
 * 1. DANS LE SHADOW ROOT DU PANNEAU (via panel.addControl). Le bouton hérite
 *    ainsi des variables de thème et surtout il est INATTEIGNABLE par les
 *    styles du site — un bouton flottant avec `!important` partout serait à la
 *    merci du premier `div { background: white }` un peu large.
 *
 * 2. IL MONTRE L'ÉTAT, PAS L'ACTION. Icône lune quand le sombre est actif,
 *    soleil quand le clair l'est, et `aria-pressed` suit. Le titre, lui, dit ce
 *    que le clic va faire (« Passer en mode clair »). C'est le seul moyen de
 *    rester compréhensible quand le thème suit le système.
 *
 * 3. IL ÉCRIT DANS LES RÉGLAGES, pas dans une variable locale. Le thème est donc
 *    le même dans le panneau, dans le popup et au prochain démarrage.
 */
(() => {
  const EDP = globalThis.EDP;

  const SVG_NS = 'http://www.w3.org/2000/svg';

  /** Crée un élément SVG (le namespace est obligatoire, sinon il reste inerte). */
  function svg(tag, attrs) {
    const node = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs).forEach(([name, value]) => node.setAttribute(name, String(value)));
    return node;
  }

  /**
   * Icône de l'état courant.
   * @param {boolean} dark thème effectif
   */
  function buildIcon(dark) {
    const root = svg('svg', {
      viewBox: '0 0 24 24',
      width: '17',
      height: '17',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '2',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
      focusable: 'false'
    });

    if (dark) {
      // Croissant : un seul tracé, lisible à 17 px.
      root.appendChild(svg('path', { d: 'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z' }));
      return root;
    }

    root.appendChild(svg('circle', { cx: '12', cy: '12', r: '4' }));
    [
      [12, 2, 12, 4.6],
      [12, 19.4, 12, 22],
      [2, 12, 4.6, 12],
      [19.4, 12, 22, 12],
      [4.9, 4.9, 6.8, 6.8],
      [17.2, 17.2, 19.1, 19.1],
      [4.9, 19.1, 6.8, 17.2],
      [17.2, 6.8, 19.1, 4.9]
    ].forEach(([x1, y1, x2, y2]) => root.appendChild(svg('line', { x1, y1, x2, y2 })));
    return root;
  }

  EDP.registry.registerFeature({
    id: 'theme-toggle',
    label: 'Bouton mode sombre',
    settingKey: 'themeToggle',

    // Le bouton vit dans le panneau : sans panneau (extension arrêtée), il n'a
    // nulle part où s'afficher, et on ne monte rien.
    detect: (ctx) => Boolean(ctx && ctx.panel && typeof ctx.panel.addControl === 'function'),

    mount(ctx) {
      const button = document.createElement('button');
      button.type = 'button';
      button.id = 'edp-theme-toggle';
      button.className = 'edp-quick edp-quick--theme';

      const iconSlot = document.createElement('span');
      iconSlot.className = 'edp-quick__icon';

      const label = document.createElement('span');
      label.className = 'edp-visually-hidden';
      label.textContent = 'Mode sombre';

      button.appendChild(iconSlot);
      button.appendChild(label);

      /** Aligne l'apparence du bouton sur le thème effectif courant. */
      function sync() {
        const dark = EDP.theme.current.resolved === 'dark';
        const action = dark ? 'Passer en mode clair' : 'Passer en mode sombre';

        button.setAttribute('aria-pressed', dark ? 'true' : 'false');
        button.title = `${action} (thème ${dark ? 'sombre' : 'clair'})`;
        button.setAttribute('aria-label', action);

        iconSlot.textContent = '';
        iconSlot.appendChild(buildIcon(dark));
      }

      function onClick() {
        // theme.set() applique immédiatement (aucune attente du stockage) puis
        // enregistre ; les autres onglets suivent via storage.onChanged.
        EDP.theme.set(EDP.theme.nextPreference(EDP.theme.current.resolved)).catch((error) => {
          console.warn('[ED+] bascule de thème en échec :', error);
        });
      }

      button.addEventListener('click', onClick);
      const removeControl = ctx.panel.addControl(button);
      const unsubscribe = EDP.theme.onChange(sync);
      sync();

      return {
        destroy() {
          unsubscribe();
          button.removeEventListener('click', onClick);
          removeControl();
        }
      };
    }
  });
})();
