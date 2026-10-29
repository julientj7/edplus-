'use strict';
/**
 * content/ui/panel.js
 * ------------------
 * Le panneau École Directe Plus+ : une pastille discrète en bas à droite qui
 * ouvre un tiroir contenant une carte par fonctionnalité.
 *
 * Deux décisions structurantes :
 *
 * 1. SHADOW DOM. Le site est une grosse application avec des styles agressifs
 *    (et des `!important`). Isole le panneau dans un shadow root fermé aux CSS
 *    extérieures ; on hérite malgré tout des variables CSS de la page, puisque
 *    les propriétés personnalisées traversent les frontières d'ombre — c'est
 *    ainsi que le thème clair/sombre s'applique au panneau.
 *
 * 2. AUCUNE insertion dans le DOM métier. Le panneau vit dans son propre hôte
 *    `#edp-panel-host`. Les fonctionnalités qui doivent toucher à la page
 *    (surlignage d'un cours) le font elles-mêmes, explicitement, et se nettoient
 *    au démontage.
 */
(() => {
  const EDP = globalThis.EDP;
  const { API } = EDP;
  const ui = () => EDP.ui;

  let instance = null;

  /**
   * Feuille de style du shadow root : adoptée si possible, sinon <style>.
   *
   * On charge DEUX fichiers : base.css (les primitives : .edp-stat, .edp-table,
   * .edp-button…) et panel.css (la pastille et le tiroir). base.css est aussi
   * injecté dans la page pour la bande de résumé — mais à l'intérieur du shadow
   * root, il faut le réadopter, car les CSS de la page n'y entrent pas.
   */
  async function buildStyle(shadow) {
    let css = '';
    try {
      const paths = ['styles/base.css', 'styles/components/panel.css'];
      const parts = await Promise.all(
        paths.map(async (path) => {
          const response = await fetch(API.runtime.getURL(path));
          return response.ok ? response.text() : '';
        })
      );
      css = parts.filter(Boolean).join('\n');
    } catch (error) {
      console.debug('[ED+] feuille du panneau illisible :', error);
    }
    if (!css) return; // le repli :host ci-dessous suffit à rester lisible

    try {
      if (typeof CSSStyleSheet === 'function' && 'adoptedStyleSheets' in shadow) {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(css);
        shadow.adoptedStyleSheets = [sheet];
        return;
      }
    } catch (error) {
      console.debug('[ED+] constructable stylesheets indisponibles :', error);
    }
    const style = document.createElement('style');
    style.textContent = css;
    shadow.appendChild(style);
  }

  /** Crée la pastille (bouton flottant) et le tiroir. */
  function buildChrome(shadow, { version }) {
    const launcher = document.createElement('button');
    launcher.type = 'button';
    launcher.className = 'edp-launcher';
    launcher.setAttribute('aria-expanded', 'false');
    launcher.title = 'École Directe Plus+';

    const launcherValue = document.createElement('span');
    launcherValue.className = 'edp-launcher__value';
    launcherValue.textContent = 'ED+';
    const launcherMark = document.createElement('span');
    launcherMark.className = 'edp-launcher__mark';
    launcherMark.textContent = '+';
    launcher.appendChild(launcherValue);
    launcher.appendChild(launcherMark);

    const drawer = document.createElement('aside');
    drawer.className = 'edp-drawer';
    drawer.hidden = true;
    drawer.setAttribute('role', 'dialog');
    drawer.setAttribute('aria-label', 'École Directe Plus+');

    const header = document.createElement('header');
    header.className = 'edp-drawer__header';
    const title = document.createElement('div');
    title.className = 'edp-drawer__title';
    title.textContent = 'École Directe Plus+';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'edp-drawer__close';
    close.textContent = '×';
    close.title = 'Fermer';
    header.appendChild(title);
    header.appendChild(close);

    const body = document.createElement('div');
    body.className = 'edp-drawer__body';

    const status = document.createElement('p');
    status.className = 'edp-drawer__status';
    status.hidden = true;

    const footer = document.createElement('footer');
    footer.className = 'edp-drawer__footer';
    footer.textContent = `v${version} · non officiel · aucune donnée transmise`;

    drawer.appendChild(header);
    drawer.appendChild(body);
    drawer.appendChild(status);
    drawer.appendChild(footer);

    // Barre de contrôles rapides : boutons ronds empilés juste au-dessus de la
    // pastille (bascule du mode sombre aujourd'hui, autre chose demain). Elle
    // est masquée quand le tiroir est ouvert, pour ne pas doubler les actions.
    const quick = document.createElement('div');
    quick.className = 'edp-quick-bar';

    shadow.appendChild(quick);
    shadow.appendChild(launcher);
    shadow.appendChild(drawer);

    return { launcher, launcherValue, drawer, body, status, close, quick };
  }

  /**
   * Crée (ou renvoie) le panneau.
   * @returns {Promise<object>} API du panneau : slot/clear/setStatus/setLauncher/destroy
   */
  async function create({ version = EDP.VERSION } = {}) {
    if (instance) return instance;

    const host = document.createElement('div');
    host.id = 'edp-panel-host';
    host.dataset.edpVersion = version;
    const shadow = host.attachShadow({ mode: 'open' });

    await buildStyle(shadow);
    const chrome = buildChrome(shadow, { version });

    /** Sections ouvertes par les fonctionnalités : nom -> { root, body }. */
    const sections = new Map();

    function setOpen(open) {
      chrome.drawer.hidden = !open;
      chrome.launcher.setAttribute('aria-expanded', open ? 'true' : 'false');
      host.dataset.edpOpen = open ? '1' : '0';
      document.removeEventListener('keydown', onKeyDown, true);
      if (open) document.addEventListener('keydown', onKeyDown, true);
    }

    function onKeyDown(event) {
      if (event.key === 'Escape') setOpen(false);
    }

    chrome.launcher.addEventListener('click', () => setOpen(chrome.drawer.hidden));
    chrome.close.addEventListener('click', () => setOpen(false));

    const panel = {
      host,
      shadow,
      /**
       * Récupère (ou crée) la zone d'une fonctionnalité.
       * @param {string} name  identifiant de la fonctionnalité
       * @param {string} title titre affiché au-dessus de la carte
       */
      slot(name, title = null) {
        if (sections.has(name)) return sections.get(name).body;
        const root = document.createElement('div');
        root.className = 'edp-section';
        if (title) {
          const heading = document.createElement('h2');
          heading.className = 'edp-section__title';
          heading.textContent = title;
          root.appendChild(heading);
        }
        const body = document.createElement('div');
        body.className = 'edp-section__body';
        root.appendChild(body);
        chrome.body.appendChild(root);
        sections.set(name, { root, body });
        return body;
      },
      /** Retire la section d'une fonctionnalité (démontage propre). */
      clear(name) {
        const section = sections.get(name);
        if (!section) return;
        section.root.remove();
        sections.delete(name);
      },
      /** Vide tout le tiroir (changement d'écran). */
      clearAll() {
        Array.from(sections.keys()).forEach((name) => panel.clear(name));
      },
      setStatus(text, tone = 'neutral') {
        chrome.status.textContent = text || '';
        chrome.status.hidden = !text;
        chrome.status.dataset.tone = tone;
      },
      /** Affiche la moyenne générale directement sur la pastille. */
      setLauncher(text) {
        chrome.launcherValue.textContent = text || 'ED+';
      },
      /**
       * Ajoute un bouton dans la barre de contrôles rapides.
       * Le retrait est rendu à l'appelant : chaque fonctionnalité nettoie ce
       * qu'elle a ajouté, donc aucun bouton fantôme quand on la désactive.
       * @param {Node} node élément déjà construit
       * @returns {() => void} fonction de retrait
       */
      addControl(node) {
        if (!node) return () => {};
        chrome.quick.appendChild(node);
        return () => {
          if (node.parentNode === chrome.quick) chrome.quick.removeChild(node);
        };
      },
      setOpen,
      mount() {
        (document.body || document.documentElement).appendChild(host);
        return panel;
      },
      destroy() {
        document.removeEventListener('keydown', onKeyDown, true);
        host.remove();
        sections.clear();
        instance = null;
      }
    };

    panel.mount();
    instance = panel;
    return panel;
  }

  /** Panneau courant, s'il existe (utilisé par le diagnostic). */
  function get() {
    return instance;
  }

  EDP.ui = EDP.ui || {};
  EDP.ui.panel = { create, get };
})();
