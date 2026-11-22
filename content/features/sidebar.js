'use strict';
/**
 * content/features/sidebar.js
 * --------------------------
 * Remplace VISUELLEMENT la barre latérale d'École Directe par un rail moderne.
 *
 * La règle qui rend la chose sûre : on ne reconstruit PAS la navigation. On lit
 * les liens déjà présents dans la page, on en déduit un libellé et une icône, et
 * chaque entrée du rail délègue son clic au <a> d'origine (`original.click()`),
 * qui reste dans le DOM. Conséquences :
 *   - les gestionnaires du site (SPA, cibles, paramètres) continuent de courir ;
 *   - un lien inconnu n'est jamais inventé : on n'affiche que ce que le site
 *     propose réellement ;
 *   - si le rail ne peut pas être construit (moins de 3 liens), la barre
 *     d'origine n'est PAS masquée.
 *
 * La barre d'origine est seulement cachée (`display: none` via
 * styles/features/sidebar.css), jamais supprimée. Un clic programmé sur un
 * élément caché fonctionne toujours.
 *
 * Le rail vit dans un shadow root : les styles du site ne peuvent pas le
 * déformer, et il hérite des variables de thème (--edp-*, posées sur <html>),
 * donc clair/sombre, accent, rayon et police s'appliquent sans une ligne de
 * plus.
 *
 * Réduction : un bouton bascule entre libellés et icônes seules. L'état est
 * enregistré (`sidebarCollapsed`) et partagé entre les onglets.
 */
(() => {
  const EDP = globalThis.EDP;
  const { $, $$, text } = EDP.dom;

  const HOST_ID = 'edp-sidebar-host';
  const NATIVE_ATTR = 'data-edp-native-nav';

  /** En dessous, on considère qu'on ne sait pas reconstruire la navigation. */
  const MIN_ITEMS = 3;
  const MAX_ITEMS = 12;

  const SVG_NS = 'http://www.w3.org/2000/svg';

  /** Libellé -> icône. L'ordre compte : le premier motif qui correspond gagne. */
  const ICON_RULES = [
    ['collapse', /réduire|replier|déplier/i],
    ['notes', /note|moyenne|bulletin|résultat|resultat|évaluation|evaluation/i],
    ['calendar', /emploi|edt|agenda|planning|cours|horaire/i],
    ['homework', /devoir|cahier|travail|exercice/i],
    ['messages', /message|messagerie|discussion|mail|chat/i],
    ['documents', /document|fichier|ressource|biblioth|stockage/i],
    ['life', /vie scolaire|absence|retard|sanction|punition|discipline/i],
    ['settings', /param|réglage|reglage|compte|profil|configuration/i],
    ['home', /accueil|tableau de bord|dashboard|\bhome\b/i]
  ];

  /** Tracés SVG, dans une grille 24 × 24, dessinés au trait. */
  const ICON_PATHS = {
    notes: ['M4 19V5', 'M4 19h16', 'M8 15l3-4 3 3 4-6'],
    calendar: ['M4 7h16', 'M8 4v4', 'M16 4v4', 'M4 7v13h16V7'],
    homework: ['M6 3h8l4 4v14H6z', 'M14 3v4h4', 'M9 12h6', 'M9 16h6'],
    messages: ['M4 5h16v11H9l-5 4z'],
    documents: ['M3 7h6l2 3h10v10H3z'],
    life: ['M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z'],
    settings: [
      'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
      'M12 3v2',
      'M12 19v2',
      'M3 12h2',
      'M19 12h2',
      'M5.6 5.6l1.5 1.5',
      'M16.9 16.9l1.5 1.5',
      'M18.4 5.6l-1.5 1.5',
      'M7.1 16.9l-1.5 1.5'
    ],
    home: ['M4 11l8-7 8 7', 'M6 10v10h12V10'],
    collapse: ['M15 6l-6 6 6 6'],
    generic: ['M6 4h9l3 3v13H6z', 'M9 11h7', 'M9 15h7']
  };

  /** Raccourci paresseux : components.js est chargé après ce fichier. */
  const el = (...args) => EDP.ui.el(...args);

  function iconNode(name) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    [
      ['viewBox', '0 0 24 24'],
      ['width', '18'],
      ['height', '18'],
      ['fill', 'none'],
      ['stroke', 'currentColor'],
      ['stroke-width', '1.8'],
      ['stroke-linecap', 'round'],
      ['stroke-linejoin', 'round'],
      ['aria-hidden', 'true'],
      ['focusable', 'false']
    ].forEach(([key, value]) => svg.setAttribute(key, value));

    (ICON_PATHS[name] || ICON_PATHS.generic).forEach((d) => {
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', d);
      svg.appendChild(path);
    });
    return svg;
  }

  function iconFor(label) {
    const found = ICON_RULES.find(([, pattern]) => pattern.test(label));
    return iconNode(found ? found[0] : 'generic');
  }

  // ---------------------------------------------------------------------------
  // Lecture de la navigation d'origine
  // ---------------------------------------------------------------------------

  const ACTIVE_PATTERN = /(^|[\s_-])(active|current|selected|actif|encours|ouvert)([\s_-]|$)/i;

  function isActive(link) {
    const classes = typeof link.className === 'string' ? link.className : '';
    if (ACTIVE_PATTERN.test(classes)) return true;
    if (link.getAttribute('aria-current')) return true;

    try {
      const there = new URL(link.href, location.href);
      const here = location.origin + location.pathname;
      const target = there.origin + there.pathname.replace(/\/+$/, '');
      // La racine du site est un cas à part : elle ne doit pas absorber tout.
      return target === here.replace(/\/+$/, '') && target !== there.origin;
    } catch (error) {
      return false;
    }
  }

  /** Étiquette lisible d'un lien : texte propre, préfixe d'icône retiré. */
  function labelOf(link) {
    const raw = text(link);
    return raw.replace(/\s+/g, ' ').slice(0, 48);
  }

  function collectItems(root) {
    const seen = new Set();
    const items = [];

    $$('a[href]', root).forEach((link) => {
      const label = labelOf(link);
      if (!label) return;

      const key = label.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);

      // Un href réel sert de repli si l'élément d'origine disparaît (le site
      // remplace parfois son menu après un changement d'écran). Les liens
      // « # » et « javascript: » sont des déclencheurs pilotés par le site :
      // on les rend en bouton et on délègue le clic, jamais en navigation.
      const rawHref = (link.getAttribute('href') || '').trim();
      const absolute = link.href;
      const navigable = !/^(#|javascript:)/i.test(rawHref) && /^https?:/i.test(absolute);
      items.push({
        link,
        href: navigable ? absolute : '',
        label,
        active: isActive(link)
      });
    });

    return items.slice(0, MAX_ITEMS);
  }

  /**
   * Trouve la barre latérale du site.
   *
   * Pas de sélecteur magique : on note tous les conteneurs plausibles qui
   * contiennent au moins trois liens internes, puis on garde le mieux noté
   * (nombre de liens, position à gauche, hauteur, balise nav/aside).
   * Un bloc déjà marqué (remontage après changement d'écran) est repris tel
   * quel, même s'il est devenu invisible.
   */
  function findNativeNav() {
    if (!document.body) return null;

    const candidates = $$(
      'nav, aside, [role="navigation"], [class*="menu" i], [class*="sidebar" i], [id*="menu" i]'
    ).filter((node) => node.isConnected && node.id !== HOST_ID);

    let best = null;
    let bestScore = 0;

    candidates.forEach((node) => {
      let links;
      try {
        links = $$('a[href]', node).filter((link) => {
          const label = labelOf(link);
          if (!label) return false;
          try {
            return new URL(link.href, location.href).origin === location.origin;
          } catch (error) {
            return false;
          }
        });
      } catch (error) {
        return;
      }
      if (links.length < MIN_ITEMS) return;

      const alreadyMine = node.hasAttribute(NATIVE_ATTR);
      let score = links.length * 10;

      if (!alreadyMine) {
        const rect = node.getBoundingClientRect();
        if (rect.left < 80) score += 25;
        else if (rect.left < window.innerWidth * 0.4) score += 10;
        if (rect.height > window.innerHeight * 0.5) score += 15;
        else if (rect.height > window.innerHeight * 0.35) score += 8;
        if (rect.width > 40 && rect.width < 360) score += 10;
        // Une barre horizontale (en-tête) traverse l'écran : elle ne doit
        // jamais gagner contre la vraie navigation latérale.
        if (rect.width > window.innerWidth * 0.6) score -= 30;
      } else {
        score += 25; // la barre déjà adoptée reste la référence
      }
      if (/^(NAV|ASIDE)$/.test(node.tagName)) score += 5;

      if (score > bestScore) {
        best = { root: node, links };
        bestScore = score;
      }
    });

    return best;
  }

  // ---------------------------------------------------------------------------
  // Construction du rail
  // ---------------------------------------------------------------------------

  /** Charge la feuille du rail dans le shadow root (adoptée si possible). */
  async function adoptStyles(shadow) {
    try {
      const response = await fetch(EDP.API.runtime.getURL('styles/components/sidebar.css'));
      if (!response.ok) return;
      const css = await response.text();
      if (!css) return;

      if (typeof CSSStyleSheet === 'function' && 'adoptedStyleSheets' in shadow) {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(css);
        shadow.adoptedStyleSheets = [sheet];
        return;
      }
      const style = document.createElement('style');
      style.textContent = css;
      shadow.appendChild(style);
    } catch (error) {
      console.debug('[ED+] feuille de la barre latérale illisible :', error);
    }
  }

  /**
   * Clic sur une entrée : on laisse faire le navigateur pour un nouvel onglet
   * (Ctrl/Cmd/maj/clic du milieu), sinon on rejoue le clic sur le lien d'origine
   * pour conserver le comportement du site.
   */
  function onItemClick(event, item) {
    if (event.defaultPrevented) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (typeof event.button === 'number' && event.button !== 0) return;

    if (item.link && item.link.isConnected) {
      event.preventDefault();
      item.link.click();
      return;
    }
    // Lien périmé : notre propre href fait la navigation. S'il n'y en a pas,
    // mieux vaut ne rien faire que recharger la page pour rien.
    if (!item.href) event.preventDefault();
  }

  function buildItem(item) {
    const node = el(
      item.href ? 'a' : 'button',
      {
        class: 'edp-rail__item',
        href: item.href || null,
        type: item.href ? null : 'button',
        title: item.label,
        'data-active': item.active ? '1' : '0',
        'aria-current': item.active ? 'page' : null
      },
      [
        el('span', { class: 'edp-rail__icon', 'aria-hidden': 'true' }, [iconFor(item.label)]),
        el('span', { class: 'edp-rail__label', text: item.label })
      ]
    );
    node.addEventListener('click', (event) => onItemClick(event, item));
    return node;
  }

  async function mount(ctx) {
    const native = findNativeNav();
    if (!native) return null;

    const items = collectItems(native.root);
    if (items.length < MIN_ITEMS) return null;

    const host = document.createElement('div');
    host.id = HOST_ID;
    const shadow = host.attachShadow({ mode: 'open' });
    await adoptStyles(shadow);

    let collapsed = Boolean(ctx.settings && ctx.settings.sidebarCollapsed);

    const brand = el('div', { class: 'edp-rail__brand' }, [
      el('span', { class: 'edp-rail__mark', 'aria-hidden': 'true', text: 'ED' }),
      el('span', { class: 'edp-rail__brand-text', text: 'École Directe' })
    ]);

    const nav = el('nav', { class: 'edp-rail__nav' }, items.map(buildItem));

    const collapseLabel = el('span', { class: 'edp-rail__label', text: 'Réduire' });
    const collapseButton = el(
      'button',
      {
        type: 'button',
        class: 'edp-rail__collapse',
        'aria-pressed': 'false',
        title: 'Réduire la barre latérale'
      },
      [el('span', { class: 'edp-rail__icon', 'aria-hidden': 'true' }, [iconFor('réduire')]), collapseLabel]
    );

    const rail = el('aside', { class: 'edp-rail', 'aria-label': 'Navigation École Directe' }, [
      brand,
      nav,
      el('div', { class: 'edp-rail__footer' }, [collapseButton])
    ]);

    shadow.appendChild(rail);
    (document.body || document.documentElement).appendChild(host);

    // À partir d'ici seulement on masque la barre d'origine : si quoi que ce
    // soit échouait avant, la page resterait intacte.
    native.root.setAttribute(NATIVE_ATTR, '1');
    document.documentElement.dataset.edpSidebar = '1';

    /**
     * État réduit. `persist: false` sert à refléter un réglage venu d'un autre
     * onglet sans réécrire le stockage en boucle.
     */
    function setCollapsed(next, { persist = true } = {}) {
      collapsed = Boolean(next);
      host.setAttribute('data-collapsed', collapsed ? '1' : '0');
      document.documentElement.dataset.edpSidebarCollapsed = collapsed ? '1' : '0';
      collapseButton.setAttribute('aria-pressed', collapsed ? 'true' : 'false');
      collapseButton.title = collapsed ? 'Déplier la barre latérale' : 'Réduire la barre latérale';
      collapseLabel.textContent = collapsed ? 'Déplier' : 'Réduire';

      if (persist) {
        EDP.settings.set({ sidebarCollapsed: collapsed }).catch((error) => {
          console.warn('[ED+] état de la barre latérale non enregistré :', error);
        });
      }
    }

    collapseButton.addEventListener('click', () => setCollapsed(!collapsed));
    setCollapsed(collapsed, { persist: false });

    // Autre onglet (ou popup) : on suit le réglage sans le réécrire.
    const offSettings = EDP.settings.subscribe((next) => {
      const wanted = Boolean(next.sidebarCollapsed);
      if (wanted !== collapsed) setCollapsed(wanted, { persist: false });
    });

    /**
     * Le site remplace parfois son menu après un changement d'écran. Sans ce
     * guet, la nouvelle barre resterait visible à côté du rail. On ré-adopte
     * alors la barre fraîche et on reconstruit les entrées.
     */
    let currentNative = native;
    const stopWatch = EDP.dom.onDomChange(
      () => {
        try {
          if (currentNative.root.isConnected) return;
          const fresh = findNativeNav();
          if (!fresh) return;
          currentNative = fresh;
          fresh.root.setAttribute(NATIVE_ATTR, '1');
          const refreshed = collectItems(fresh.root);
          if (refreshed.length < MIN_ITEMS) return;
          nav.textContent = '';
          refreshed.map(buildItem).forEach((node) => nav.appendChild(node));
        } catch (error) {
          console.debug('[ED+] barre latérale : reprise du menu impossible', error);
        }
      },
      { delay: 800 }
    );

    /**
     * Décalage du contenu, mesuré APRÈS le masquage de la barre d'origine.
     * Dans une mise en page où la barre occupait une place dans le flux, la
     * masquer libère exactement l'espace du rail : rien à ajouter. Si le
     * contenu commence collé au bord gauche (barre en position fixe), il
     * passerait sous le rail : là seulement, on décale le <body>.
     */
    const offsetFrame = window.requestAnimationFrame(() => {
      try {
        const marker = $('main, #conteneur, #container, #main, #page, .content');
        if (!marker) return;
        if (marker.getBoundingClientRect().left < 8) {
          document.documentElement.dataset.edpSidebarOffset = '1';
        }
      } catch (error) {
        console.debug('[ED+] mesure de la barre latérale impossible :', error);
      }
    });

    return {
      destroy() {
        offSettings();
        stopWatch();
        window.cancelAnimationFrame(offsetFrame);
        host.remove();
        currentNative.root.removeAttribute(NATIVE_ATTR);
        delete document.documentElement.dataset.edpSidebar;
        delete document.documentElement.dataset.edpSidebarCollapsed;
        delete document.documentElement.dataset.edpSidebarOffset;
      }
    };
  }

  EDP.registry.registerFeature({
    id: 'sidebar',
    label: 'Barre latérale moderne',
    settingKey: 'sidebar',
    detect: () => Boolean(findNativeNav()),
    mount
  });
})();
