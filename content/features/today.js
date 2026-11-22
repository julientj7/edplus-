'use strict';
/**
 * content/features/today.js
 * ------------------------
 * Vue « Aujourd’hui » : en un seul écran, les cours du jour, les devoirs à
 * rendre aujourd’hui ou demain, les dernières notes et les absences/retards.
 *
 * DEUX EMPLACEMENTS, un seul rendu :
 *   - `todayPlacement: 'home'`  -> remplace le contenu principal de la page
 *     d’accueil (comme le faisait l’ancien tableau de bord) ;
 *   - `todayPlacement: 'panel'` -> s’affiche dans le tiroir École Directe Plus+,
 *     avec un bouton « Auj. » dans la barre de contrôles rapides pour l’ouvrir
 *     depuis n’importe quel écran du site.
 *
 * Règles de sûreté (identiques au reste du projet) :
 *   - on ne SUPPRIME rien : le contenu d’origine est seulement masqué
 *     (`data-edp-native-main`, voir styles/features/today.css) et rendu tel
 *     quel au démontage ;
 *   - si le conteneur principal n’est pas identifié avec certitude, on ne
 *     touche à rien (`mount` renvoie null) : mieux vaut la page d’origine
 *     qu’un écran vide ;
 *   - aucune donnée n’est inventée : chaque carte affiche un état vide
 *     explicite quand la page ne montre rien.
 *
 * Données : elles sont relues depuis la page (content/data/source-dom.js),
 * jamais par le réseau. La moyenne vient du moteur de calcul quand des notes
 * sont lisibles ; sinon elle n’est pas affichée.
 *
 * Tout vit dans un shadow root (mode « accueil ») ou dans celui du panneau
 * (mode « panneau ») : les styles du site ne peuvent pas déformer la vue, et
 * elle hérite des variables de thème posées sur <html>.
 */
(() => {
  const EDP = globalThis.EDP;
  const { $, $$ } = EDP.dom;
  const { formatFr, daysUntil } = EDP.utils;
  /** Accès paresseux : ui/components.js est chargé après ce fichier. */
  const ui = () => EDP.ui;

  const HOST_ID = 'edp-today-host';
  const NATIVE_ATTR = 'data-edp-native-main';

  /** Une minute : le créneau « en cours » doit suivre l’horloge. */
  const TICK_MS = 60_000;

  const MAX_SLOTS = 8;
  const MAX_HOMEWORK = 6;
  const MAX_GRADES = 5;
  const MAX_ABSENCES = 4;

  /**
   * Conteneurs principaux plausibles. Ils ne servent qu’à MASQUER (jamais à
   * supprimer) : une erreur de choix reste donc réversible et sans perte.
   * C’est aussi la liste à ajuster si la vue ne remplace pas le bon bloc.
   */
  const MAIN_SELECTORS = [
    '#mainContent',
    '#main-content',
    'main',
    '#contenu',
    '#content',
    '#page',
    '.page-content',
    '[class*="main-content" i]'
  ];

  // ---------------------------------------------------------------------------
  // Emplacement choisi dans les réglages
  // ---------------------------------------------------------------------------

  /** 'home' (défaut) ou 'panel'. Toute valeur inconnue retombe sur l’accueil. */
  function placement(ctx) {
    const value = ctx && ctx.settings && ctx.settings.todayPlacement;
    return value === 'panel' ? 'panel' : 'home';
  }

  // ---------------------------------------------------------------------------
  // Repérage du contenu d’origine
  // ---------------------------------------------------------------------------

  /** Nos propres nœuds : exclus de la surveillance du DOM. */
  function isOurs(node) {
    if (!node || typeof node.closest !== 'function') return false;
    try {
      return Boolean(
        node.closest(`#${HOST_ID}, #edp-panel-host, #edp-sidebar-host, [class*="edp-"]`)
      );
    } catch (error) {
      return false;
    }
  }

  /**
   * Trouve le bloc à remplacer.
   *
   * Pas de sélecteur magique : on note tous les candidats (ceux qui contiennent
   * le conteneur d’accueil repéré par source-dom, les balises <main>, les gros
   * blocs de contenu) puis on garde le mieux noté. Un bloc vide ou de la taille
   * d’un lien de menu est écarté : remplacer un fil d’Ariane n’a aucun intérêt.
   */
  function findNativeMain() {
    const marked = $(`[${NATIVE_ATTR}="1"]`);
    if (marked && marked.isConnected && marked.id !== HOST_ID) return marked;

    const source = EDP.data && EDP.data.sourceDom;
    const home = source && typeof source.homeRoot === 'function' ? source.homeRoot() : null;

    const seen = new Set();
    let best = null;
    let bestScore = 0;

    function consider(node, bonus) {
      if (!node || seen.has(node) || !node.isConnected) return;
      if (node === document.body || node === document.documentElement) return;
      if (node.id === HOST_ID || node.querySelector(`#${HOST_ID}`)) return;
      seen.add(node);

      let rect;
      try {
        rect = node.getBoundingClientRect();
      } catch (error) {
        return;
      }
      // Bloc vide ou minuscule : ce n’est pas le contenu principal.
      if (rect.width < 320 || rect.height < 160) return;

      let score = bonus;
      if (home && (node === home || node.contains(home))) score += 40;
      if (node.tagName === 'MAIN') score += 20;
      if (node.getAttribute('role') === 'main') score += 15;
      if (rect.width >= window.innerWidth * 0.45) score += 15;
      if (rect.height >= 240) score += 10;

      if (score > bestScore) {
        best = node;
        bestScore = score;
      }
    }

    MAIN_SELECTORS.forEach((selector) => consider($(selector), 10));
    if (home) consider(home, 25);

    return best;
  }

  /** Charge une feuille dans un shadow root (adoptée si possible, sinon <style>). */
  async function adoptStyles(shadow, path) {
    try {
      const response = await fetch(EDP.API.runtime.getURL(path));
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
      console.debug('[ED+] feuille de la vue Aujourd’hui illisible :', error);
    }
  }

  // ---------------------------------------------------------------------------
  // Collecte de la vue
  // ---------------------------------------------------------------------------

  function collectView(ctx) {
    const source = EDP.data && EDP.data.sourceDom;
    // `ctx.data` date du dernier passage du registre ; `EDP.data.get()` peut
    // être plus frais quand la page a été relue entre-temps.
    const data = EDP.data.get() || ctx.data || {};
    const grades = Array.isArray(data.grades) ? data.grades : [];

    const counted = grades.filter((grade) => grade.counted);
    const ordered = counted.length ? counted : grades;
    const recent = EDP.model.sortByDateDesc(ordered).slice(0, MAX_GRADES);

    return {
      average:
        data.general && Number.isFinite(data.general.average20) ? data.general.average20 : null,
      classAverage: Number.isFinite(data.classGeneral) ? data.classGeneral : null,
      recent,
      homework: source && typeof source.homeworkRows === 'function' ? source.homeworkRows() : [],
      timetable: source && typeof source.timetableRows === 'function' ? source.timetableRows() : [],
      absences: source && typeof source.absences === 'function' ? source.absences() : [],
      period: data.period || null
    };
  }

  // ---------------------------------------------------------------------------
  // Petits utilitaires d’affichage
  // ---------------------------------------------------------------------------

  function nowMinutes() {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  }

  function pad(value) {
    return String(value).padStart(2, '0');
  }

  function formatTime(minutes) {
    const wrapped = ((minutes % 1440) + 1440) % 1440;
    return `${pad(Math.floor(wrapped / 60))}h${pad(wrapped % 60)}`;
  }

  function capitalized(value) {
    return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
  }

  function el(tag, props, children) {
    return ui().el(tag, props, children);
  }

  function chip(label, tone = 'neutral') {
    return el('span', { class: 'edp-today__chip', dataset: { tone }, text: label });
  }

  function empty(text) {
    return el('p', { class: 'edp-today__empty', text });
  }

  function card(title, { hint = null, children = [] } = {}) {
    const head = el('div', { class: 'edp-today__card-head' }, [
      el('h2', { class: 'edp-today__card-title', text: title }),
      hint ? el('span', { class: 'edp-today__count', text: hint }) : null
    ]);
    return el('section', { class: 'edp-today__card' }, [head].concat(children));
  }

  function list(items, renderItem) {
    return el('ul', { class: 'edp-today__list' }, items.map(renderItem));
  }

  // ---------------------------------------------------------------------------
  // Cartes
  // ---------------------------------------------------------------------------

  function buildHeader(view) {
    const now = new Date();
    const dateText = capitalized(
      now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
    );

    const aside = [];
    if (view.average !== null) {
      const tone = view.average >= 15 ? 'positive' : view.average < 10 ? 'negative' : 'neutral';
      aside.push(
        el('span', { class: 'edp-today__average', dataset: { tone } }, [
          el('span', { class: 'edp-today__average-label', text: 'Moyenne' }),
          el('strong', { class: 'edp-today__average-value', text: formatFr(view.average) }),
          el('span', { class: 'edp-today__average-scale', text: '/20' })
        ])
      );
    }
    if (view.period) aside.push(el('span', { class: 'edp-today__period', text: view.period }));

    return el('header', { class: 'edp-today__head' }, [
      el('div', { class: 'edp-today__head-main' }, [
        el('p', { class: 'edp-today__eyebrow', text: 'École Directe Plus+' }),
        el('h1', { class: 'edp-today__title', text: 'Aujourd’hui' }),
        el('p', { class: 'edp-today__date', text: dateText })
      ]),
      aside.length ? el('div', { class: 'edp-today__aside' }, aside) : null
    ]);
  }

  /** Bandeau « en cours / prochain cours » : la réponse immédiate. */
  function buildNowBar(slots, now) {
    const active = slots.find(
      (slot) => !slot.cancelled && slot.start <= now && slot.end > now
    );
    const next = slots.find((slot) => !slot.cancelled && slot.start > now);
    const entry = active || next;

    if (!entry) {
      return el('section', { class: 'edp-today__now', dataset: { state: 'idle' } }, [
        el('span', {
          class: 'edp-today__now-label',
          text: slots.length ? 'Journée terminée' : 'Aujourd’hui'
        }),
        el('span', {
          class: 'edp-today__now-text',
          text: slots.length
            ? 'Tous les cours de la journée sont passés.'
            : 'Aucun cours affiché sur cette page.'
        })
      ]);
    }

    return el('section', { class: 'edp-today__now', dataset: { state: active ? 'now' : 'next' } }, [
      el('span', {
        class: 'edp-today__now-label',
        text: active ? 'En cours' : 'Prochain cours'
      }),
      el('span', {
        class: 'edp-today__now-text',
        text: entry.room ? `${entry.subject} · ${entry.room}` : entry.subject
      }),
      el('span', {
        class: 'edp-today__now-time',
        text: `${formatTime(entry.start)}–${formatTime(entry.end)}`
      })
    ]);
  }

  function slotState(entry, now) {
    if (entry.cancelled) return 'cancelled';
    if (entry.start <= now && entry.end > now) return 'now';
    if (entry.end <= now) return 'past';
    return 'later';
  }

  function slotItem(entry, state) {
    const badge =
      state === 'now'
        ? chip('en cours', 'accent')
        : state === 'cancelled'
          ? chip('annulé', 'neutral')
          : null;

    return el('li', { class: 'edp-today__item edp-today__slot', dataset: { state } }, [
      el('span', {
        class: 'edp-today__slot-time',
        text: `${formatTime(entry.start)}–${formatTime(entry.end)}`
      }),
      el('span', { class: 'edp-today__item-main' }, [
        el('span', { class: 'edp-today__item-title', text: entry.subject }),
        entry.room ? el('span', { class: 'edp-today__item-sub', text: entry.room }) : null
      ]),
      badge
    ]);
  }

  /**
   * Devoirs non faits à rendre aujourd’hui ou demain.
   * Les devoirs en retard restent visibles (ils sont plus urgents que demain) ;
   * les devoirs sans date ne peuvent pas être situés et sont seulement comptés.
   */
  function dueHomework(entries) {
    const now = new Date();
    const open = entries
      .filter((entry) => !entry.done)
      .map((entry) => ({ ...entry, days: entry.due ? daysUntil(entry.due, now) : null }));

    const dated = open
      .filter((entry) => entry.days !== null && entry.days <= 1)
      .sort((left, right) => left.days - right.days)
      .slice(0, MAX_HOMEWORK);

    return { dated, undated: open.filter((entry) => entry.days === null).length };
  }

  function dueChip(entry) {
    if (entry.days < 0) {
      return chip(entry.days === -1 ? 'en retard (hier)' : `en retard (${-entry.days} j)`, 'negative');
    }
    if (entry.days === 0) return chip('aujourd’hui', 'accent');
    return chip('demain', 'warning');
  }

  function homeworkItem(entry) {
    return el('li', { class: 'edp-today__item' }, [
      el('span', { class: 'edp-today__item-main' }, [
        el('span', { class: 'edp-today__item-title', text: entry.subject }),
        el('span', { class: 'edp-today__item-sub', text: entry.label.slice(0, 80) })
      ]),
      dueChip(entry)
    ]);
  }

  function gradeTone(grade) {
    const value20 = Number.isFinite(grade.value20)
      ? grade.value20
      : Number.isFinite(grade.value) && grade.outOf
        ? (grade.value / grade.outOf) * 20
        : null;
    if (value20 === null) return 'neutral';
    if (value20 >= 15) return 'positive';
    if (value20 < 10) return 'negative';
    return 'neutral';
  }

  function gradeItem(grade) {
    const date = grade.date
      ? grade.date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
      : '';
    return el('li', { class: 'edp-today__item' }, [
      el('span', { class: 'edp-today__item-main' }, [
        el('span', { class: 'edp-today__item-title', text: grade.subject }),
        el('span', {
          class: 'edp-today__item-sub',
          text: [grade.label, date].filter(Boolean).join(' · ')
        })
      ]),
      el('span', {
        class: 'edp-today__grade-value',
        dataset: { tone: gradeTone(grade) },
        text: ui().gradeLabel(grade)
      })
    ]);
  }

  function absenceKind(entry) {
    if (entry.kind === 'latency') return 'Retard';
    if (entry.kind === 'exclusion') return 'Exclusion';
    return 'Absence';
  }

  function absenceMeta(entry) {
    const parts = [];
    if (entry.date) {
      parts.push(entry.date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }));
    }
    if (entry.duration) parts.push(entry.duration);
    return parts.join(' · ');
  }

  function absenceItem(entry) {
    const justified =
      entry.justified === true
        ? chip('justifié', 'positive')
        : entry.justified === false
          ? chip('non justifié', 'negative')
          : null;

    return el('li', { class: 'edp-today__item' }, [
      el('span', { class: 'edp-today__item-main' }, [
        el('span', { class: 'edp-today__item-title', text: absenceKind(entry) }),
        el('span', {
          class: 'edp-today__item-sub',
          text: absenceMeta(entry) || entry.label
        })
      ]),
      justified
    ]);
  }

  /** Assemble la vue entière. Le mode ne change que les textes secondaires. */
  function buildView(view, mode) {
    const fragment = document.createDocumentFragment();
    fragment.appendChild(buildHeader(view));

    const now = nowMinutes();
    const slots = view.timetable
      .slice()
      .sort((left, right) => left.start - right.start)
      .slice(0, MAX_SLOTS);
    const shownSlots = slots;
    const homework = dueHomework(view.homework);
    const absences = view.absences
      .slice()
      .sort((left, right) => {
        const leftTime = left.date ? left.date.getTime() : -Infinity;
        const rightTime = right.date ? right.date.getTime() : -Infinity;
        return rightTime - leftTime;
      })
      .slice(0, MAX_ABSENCES);

    fragment.appendChild(buildNowBar(view.timetable, now));

    const grid = el('div', { class: 'edp-today__grid' }, [
      card('Cours du jour', {
        hint: shownSlots.length ? `${shownSlots.length}` : null,
        children: [
          shownSlots.length
            ? list(shownSlots, (entry) => slotItem(entry, slotState(entry, now)))
            : empty('Aucun cours affiché pour aujourd’hui.')
        ]
      }),
      card('À rendre aujourd’hui ou demain', {
        hint: homework.dated.length ? `${homework.dated.length}` : null,
        children: [
          homework.dated.length
            ? list(homework.dated, homeworkItem)
            : empty('Rien à rendre aujourd’hui ni demain.')
        ]
      }),
      card('Dernières notes', {
        hint: view.recent.length ? `${view.recent.length}` : null,
        children: [
          view.recent.length
            ? list(view.recent, gradeItem)
            : empty('Aucune note récente lisible sur cet écran.')
        ]
      }),
      card('Absences et retards', {
        hint: absences.length ? `${absences.length}` : null,
        children: [
          absences.length
            ? list(absences, absenceItem)
            : empty('Aucune absence ou retard affiché.')
        ]
      })
    ]);

    fragment.appendChild(grid);

    if (homework.undated > 0) {
      fragment.appendChild(
        el('p', {
          class: 'edp-today__note',
          text: `${homework.undated} devoir${homework.undated > 1 ? 's' : ''} sans date dans le cahier de textes : ouvrez-le pour les situer.`
        })
      );
    }

    if (mode === 'home' && view.timetable.length > shownSlots.length) {
      const hidden = view.timetable.length - shownSlots.length;
      fragment.appendChild(
        el('p', {
          class: 'edp-today__note',
          text: `${hidden} créneau${hidden > 1 ? 'x' : ''} supplémentaire${hidden > 1 ? 's' : ''} dans l’emploi du temps complet.`
        })
      );
    }

    fragment.appendChild(
      el('p', {
        class: 'edp-today__note',
        text: 'Données lues sur la page · rien n’est transmis.'
      })
    );

    return fragment;
  }

  /** Remplit un conteneur avec la vue, sans innerHTML. */
  function paint(root, view, mode) {
    root.textContent = '';
    try {
      root.appendChild(buildView(view, mode));
    } catch (error) {
      console.error('[ED+] vue Aujourd’hui : rendu en échec', error);
      root.textContent = '';
      root.appendChild(empty('Vue indisponible, voir la console.'));
    }
  }

  // ---------------------------------------------------------------------------
  // Montage : page d’accueil remplacée
  // ---------------------------------------------------------------------------

  async function mountHome(ctx) {
    const native = findNativeMain();
    if (!native) return null;

    const host = document.createElement('div');
    host.id = HOST_ID;
    const shadow = host.attachShadow({ mode: 'open' });
    await adoptStyles(shadow, 'styles/components/today.css');

    const root = document.createElement('div');
    root.className = 'edp-today';
    shadow.appendChild(root);

    let currentNative = native;

    function render() {
      paint(root, collectView(ctx), 'home');
    }

    render();

    // À partir d’ici seulement on masque le contenu d’origine : si quoi que ce
    // soit échouait avant, la page resterait intacte.
    try {
      currentNative.parentNode.insertBefore(host, currentNative);
    } catch (error) {
      console.debug('[ED+] insertion de la vue Aujourd’hui impossible :', error);
      return null;
    }
    currentNative.setAttribute(NATIVE_ATTR, '1');
    document.documentElement.dataset.edpToday = '1';

    const timer = setInterval(render, TICK_MS);

    /**
     * Le site remplace parfois son contenu principal après un changement
     * d’écran. Sans ce guet, notre hôte resterait orphelin et le nouveau bloc
     * d’origine apparaîtrait à côté. On se replace alors devant le bloc frais.
     */
    const stopWatch = EDP.dom.onDomChange(
      () => {
        try {
          if (host.isConnected && currentNative.isConnected) return;
          const fresh = findNativeMain();
          if (!fresh || !fresh.parentNode) return;
          fresh.parentNode.insertBefore(host, fresh);
          fresh.setAttribute(NATIVE_ATTR, '1');
          currentNative = fresh;
          render();
        } catch (error) {
          console.debug('[ED+] vue Aujourd’hui : repositionnement impossible', error);
        }
      },
      { delay: 900, ignore: (node) => isOurs(node) }
    );

    return {
      destroy() {
        clearInterval(timer);
        stopWatch();
        host.remove();
        $$(`[${NATIVE_ATTR}="1"]`).forEach((node) => node.removeAttribute(NATIVE_ATTR));
        delete document.documentElement.dataset.edpToday;
      }
    };
  }

  // ---------------------------------------------------------------------------
  // Montage : panneau dédié
  // ---------------------------------------------------------------------------

  function mountPanel(ctx) {
    const panel = ctx.panel;
    if (!panel) return null;

    const slot = panel.slot('today', 'Aujourd’hui');
    if (!slot) return null;

    const root = document.createElement('div');
    root.className = 'edp-today edp-today--panel';
    slot.appendChild(root);

    function render() {
      paint(root, collectView(ctx), 'panel');
    }

    render();
    const timer = setInterval(render, TICK_MS);

    // Bouton rapide : ouvre le tiroir directement sur cette section, depuis
    // n’importe quel écran du site.
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'edp-quick edp-quick--today';
    button.title = 'Vue Aujourd’hui';
    button.setAttribute('aria-label', 'Ouvrir la vue Aujourd’hui');
    const icon = document.createElement('span');
    icon.className = 'edp-quick__icon edp-quick__icon--text';
    icon.textContent = 'Auj.';
    button.appendChild(icon);
    button.addEventListener('click', () => panel.reveal('today'));
    const removeControl = panel.addControl(button);

    const stopWatch = EDP.dom.onDomChange(render, {
      delay: 1200,
      ignore: (node) => isOurs(node)
    });

    return {
      destroy() {
        clearInterval(timer);
        stopWatch();
        removeControl();
        panel.clear('today');
      }
    };
  }

  // ---------------------------------------------------------------------------
  // Enregistrement
  // ---------------------------------------------------------------------------

  EDP.registry.registerFeature({
    id: 'today',
    label: 'Vue Aujourd’hui',
    settingKey: 'today',
    detect(ctx) {
      if (placement(ctx) === 'panel') return Boolean(ctx && ctx.panel);
      return ctx.route === EDP.ROUTES.HOME && Boolean(findNativeMain());
    },
    mount(ctx) {
      return placement(ctx) === 'panel' ? mountPanel(ctx) : mountHome(ctx);
    }
  });
})();
