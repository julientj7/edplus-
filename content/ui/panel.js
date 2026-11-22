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
  const { formatFr, formatDelta } = EDP.utils;
  const ui = () => EDP.ui;

  let instance = null;

  /**
   * Feuille de style du shadow root : adoptée si possible, sinon <style>.
   *
   * On charge CINQ fichiers : base.css (les primitives : .edp-stat,
   * .edp-table, .edp-button…), panel.css (la pastille et le tiroir),
   * agenda.css (agenda de la journée et liste de devoirs), simulator.css et
   * today.css (vue « Aujourd’hui » en mode panneau).
   * base.css est aussi injecté dans la page pour la bande de résumé — mais à
   * l'intérieur du shadow root, il faut le réadopter, car les CSS de la page
   * n'y entrent pas.
   */
  async function buildStyle(shadow) {
    let css = '';
    try {
      const paths = [
        'styles/base.css',
        'styles/components/panel.css',
        'styles/components/agenda.css',
        'styles/components/simulator.css',
        'styles/components/today.css'
      ];
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

  /**
   * Panneau fixe de moyenne : la seule information que l'élève veut voir sans
   * rien ouvrir. Volontairement minuscule (une valeur, un écart, deux compteurs)
   * et dépliable d'un clic pour le détail par matière.
   *
   * Il vit dans le shadow root, comme le reste du panneau : les styles du site
   * ne peuvent ni le déformer ni le masquer.
   */
  function buildAverageHud() {
    const root = document.createElement('section');
    root.className = 'edp-hud';
    root.hidden = true;
    root.dataset.tone = 'neutral';

    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'edp-hud__head';
    head.setAttribute('aria-expanded', 'false');
    head.title = 'Détail des moyennes par matière';

    const label = document.createElement('span');
    label.className = 'edp-hud__label';
    label.textContent = 'Moyenne générale';

    const line = document.createElement('span');
    line.className = 'edp-hud__line';
    const value = document.createElement('strong');
    value.className = 'edp-hud__value';
    value.textContent = '—';
    const scale = document.createElement('span');
    scale.className = 'edp-hud__scale';
    scale.textContent = '/20';
    const delta = document.createElement('span');
    delta.className = 'edp-hud__delta';
    line.appendChild(value);
    line.appendChild(scale);
    line.appendChild(delta);

    const meta = document.createElement('span');
    meta.className = 'edp-hud__meta';

    head.appendChild(label);
    head.appendChild(line);
    head.appendChild(meta);

    // Chevron purement décoratif : l'état réel est porté par aria-expanded.
    const chevron = document.createElement('span');
    chevron.className = 'edp-hud__chevron';
    chevron.textContent = '▾';

    const detail = document.createElement('div');
    detail.className = 'edp-hud__detail';
    detail.hidden = true;

    const list = document.createElement('ul');
    list.className = 'edp-hud__list';
    const note = document.createElement('p');
    note.className = 'edp-hud__note';

    detail.appendChild(list);
    detail.appendChild(note);

    root.appendChild(head);
    root.appendChild(chevron);
    root.appendChild(detail);

    return { root, head, value, delta, meta, list, note, detail };
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

    // Le panneau de moyenne et la barre de contrôles partagent une seule pile
    // verticale (`.edp-dock`) : ils ne peuvent donc pas se chevaucher, même
    // quand l'un des deux grandit.
    const hud = buildAverageHud();
    const dock = document.createElement('div');
    dock.className = 'edp-dock';
    dock.appendChild(hud.root);
    dock.appendChild(quick);

    shadow.appendChild(dock);
    shadow.appendChild(launcher);
    shadow.appendChild(drawer);

    return { launcher, launcherValue, drawer, body, status, close, quick, hud, dock };
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

    /** Repli du détail par matière. */
    function setHudOpen(open) {
      chrome.hud.detail.hidden = !open;
      chrome.hud.head.setAttribute('aria-expanded', open ? 'true' : 'false');
      chrome.hud.root.dataset.open = open ? '1' : '0';
    }

    chrome.hud.head.addEventListener('click', () => setHudOpen(chrome.hud.detail.hidden));

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
      /**
       * Ouvre le tiroir sur une section precise.
       *
       * Utilise par le popup (« Simuler une note ») : il ne peut pas construire
       * le simulateur lui-meme, il demande donc a la page de montrer le sien.
       * Renvoie false si la section n'est pas montee ici — l'appelant peut alors
       * expliquer pourquoi au lieu de laisser un tiroir ouvert sur du vide.
       */
      reveal(name) {
        setOpen(true);
        const section = sections.get(name);
        if (!section) return false;
        try {
          section.root.scrollIntoView({ block: 'start', behavior: 'smooth' });
        } catch (error) {
          // Firefox sans options de defilement : saut direct, sans animation.
          try {
            section.root.scrollIntoView();
          } catch (ignored) {
            /* rien a faire : le tiroir est deja ouvert */
          }
        }
        return true;
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
      /** Affiche un texte sur la pastille (retour au libellé par défaut si null). */
      setLauncher(text) {
        chrome.launcherValue.textContent = text || 'ED+';
      },
      /**
       * Met à jour le panneau fixe de moyenne.
       * @param {object|null} info { average20, classAverage, subjectsUsed,
       *   gradeCount, subjects: [{ name, average20 }], stale }
       *   null (ou sans moyenne) masque le panneau : mieux vaut rien qu'un « — »
       *   permanent en bas de l'écran.
       */
      setAverage(info) {
        const view = chrome.hud;
        const average = info && Number.isFinite(info.average20) ? info.average20 : null;
        if (average === null) {
          view.root.hidden = true;
          return;
        }

        view.root.hidden = false;
        view.root.dataset.tone = average >= 15 ? 'positive' : average < 10 ? 'negative' : 'neutral';
        view.value.textContent = formatFr(average);

        view.delta.textContent = '';
        view.delta.dataset.tone = 'neutral';
        if (Number.isFinite(info.classAverage)) {
          const gap = average - info.classAverage;
          view.delta.textContent = formatDelta(gap);
          view.delta.dataset.tone = gap > 0 ? 'positive' : gap < 0 ? 'negative' : 'neutral';
          view.delta.title = `Moyenne de la classe : ${formatFr(info.classAverage)}`;
        }

        const parts = [];
        if (info.subjectsUsed) parts.push(`${info.subjectsUsed} matière${info.subjectsUsed > 1 ? 's' : ''}`);
        if (info.gradeCount) parts.push(`${info.gradeCount} note${info.gradeCount > 1 ? 's' : ''}`);
        if (info.stale) parts.push('dernier relevé');
        view.meta.textContent = parts.join(' · ');

        // Détail par matière : reconstruit à chaque mise à jour. Une quinzaine
        // de lignes au maximum, donc le coût est négligeable.
        view.list.textContent = '';
        (info.subjects || []).forEach((subject) => {
          if (!subject || !Number.isFinite(subject.average20)) return;
          const item = document.createElement('li');
          item.className = 'edp-hud__item';
          if (subject.average20 >= 15) item.classList.add('edp-hud__item--high');
          else if (subject.average20 < 10) item.classList.add('edp-hud__item--low');

          const name = document.createElement('span');
          name.className = 'edp-hud__item-name';
          name.textContent = subject.name;
          const number = document.createElement('span');
          number.className = 'edp-hud__item-value';
          number.textContent = formatFr(subject.average20);

          item.appendChild(name);
          item.appendChild(number);
          view.list.appendChild(item);
        });
        view.list.hidden = view.list.children.length === 0;
        view.note.textContent = info.stale
          ? 'Dernier relevé connu : ouvrez la page Notes pour actualiser.'
          : 'Calcul local, coefficients appliqués.';
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
