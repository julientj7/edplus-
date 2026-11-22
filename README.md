# École Directe Plus+

Extension Firefox (Manifest V3) qui rend École Directe plus lisible et plus
utile : **moyennes recalculées**, **simulateur de notes**, **emploi du temps** et
**cahier de textes** repensés, **mode sombre**.

> Projet **non officiel**, sans aucun lien avec Aplim / École Directe.
> Tout le calcul se fait dans votre navigateur : **aucun identifiant, aucune note
> ne quitte votre machine**. Il n'y a ni serveur, ni compte, ni télémétrie — c'est
> déclaré dans le manifeste (`data_collection_permissions: ["none"]`) et vérifiable
> dans le code. Cette clé est lue par Firefox 140+ ; les versions antérieures
> l'ignorent simplement (elles n'ont pas d'écran de consentement à afficher).

---

## Arborescence, fichier par fichier

```
manifest.json                 Manifeste MV3 : permissions, event page, content scripts
manifest.annotated.jsonc      Le même manifeste commenté clé par clé (documentation :
                              le JSON strict n'accepte pas de commentaires)
README.md                     Ce document
.gitignore                    node_modules, paquets web-ext, artefacts d'éditeur
_locales/fr/messages.json     Nom et description localisés (référencés par __MSG_…__)
icons/                        icon.svg + icon-16/32/48/96/128.png (générés)
shared/
  constants.js                Espace de noms EDP, clés de stockage, réglages par défaut
  utils.js                    Lecture des notes françaises, dates, arrondis, formatage
  settings.js                 Couche de réglages partagée : get/set/reset/subscribe
  theme-presets.js            Palettes prédéfinies + validation des surcharges de thème
background/
  background.js               Event page : init des réglages, cache du résumé, pastille
  messages.js                 Routeur de messages du background (le content script a le sien)
  badge.js                    Pastille « N nouvelles notes » sur l'icône
content/
  main.js                     Orchestrateur : démarrage, recalcul, diffusion, arrêt
  core/
    dom.js                    Helpers DOM tolérants ($, $$, waitFor, onDomChange)
    messaging.js              Messagerie côté page : envoi sans exception + routeur (register)
    registry.js               Registre des fonctionnalités (mount/unmount idempotent)
    router.js                 Détection de l'écran courant (accueil / notes / EDT / devoirs)
  data/
    model.js                  Modèle normalisé : c'est le contrat stable du projet
    adapter.js                Façade de données + vue « snapshot » pour le popup
    source-dom.js             ⚠️ SEUL FICHIER À ADAPTER AU SITE (lecture de la page)
    source-api.js             Source API réservée — non implémentée en v1.0 (et pourquoi)
  features/
    averages.js               Moteur de calcul pur (moyennes, simulation, objectif)
    progress.js               Séries chronologiques pures pour les graphiques (périodes, moyenne générale, par matière)
    theme.js                  Thème : préférence, résolution « auto », bascule, événement
    dark-mode.js              Suivi du thème du système d'exploitation
    theme-toggle.js           Bouton flottant lune/soleil (dans le shadow root du panneau)
    sidebar.js                Rails de navigation : reprise des liens du site, réduction, page active
    grades.js                 Relevé de notes refondu (tri, filtres, pastilles) + carte du panneau
    charts.js                 Graphiques d'évolution en SVG (moyenne générale, par matière, période, bouton afficher/masquer)
    simulator.js              Liste de notes fictives + question inverse (« il me faut combien ? »)
    timetable.js              Cours en cours / suivant, surlignage des lignes
    homework.js               Devoirs en retard, aujourd'hui, sous 48 h
    today.js                  Vue « Aujourd'hui » : cours du jour, devoirs, notes, absences (accueil ou panneau)
    cleanup.js                Masque des blocs d'origine choisis (encarts, actus, aides, pied de page)
  ui/
    components.js             Composants (carte, tableau, champ…) sans innerHTML
    panel.js                  Pastille, tiroir et panneau de moyenne (Shadow DOM)
styles/
  tokens.css                  Variables de design (clair et sombre)
  base.css                    Primitives d'interface + hôte du panneau  (2 usages)
  dark.css                    Surcharges du SITE en sombre — partie fragile
  components/panel.css        Mise en page de la pastille et du tiroir
  components/sidebar.css      Rail de navigation (shadow root)
  components/today.css        Vue « Aujourd'hui » (shadow root, page ou panneau)
  components/grades.css       Relevé de notes refondu (shadow root)
  components/charts.css       Graphiques d'évolution (shadow root)
  components/agenda.css       Agenda de la journée, tâches, barre segmentée (shadow root)
  components/simulator.css    Simulateur : liste des hypothèses (shadow root)
  features/grades.css         Masque les tableaux de notes d'origine (relevé refondu)
  features/timetable.css      « En cours » / « suivant » + étiquette et jauge d'avancement
  features/homework.css       Retard / aujourd'hui / 48 h / fait, avec étiquettes texte
  features/sidebar.css        Masque la barre d'origine et fixe les largeurs du rail
  features/today.css          Masque le contenu principal remplacé par la vue « Aujourd'hui »
  features/cleanup.css        Masque les blocs marqués par cleanup.js (jamais supprimés)
popup/
  popup.html                  Résumé (moyenne, dernière note, cours, devoirs) + panneau avancé
  popup.css                   Mise en page du popup
  popup.js                    Résumé, bascule du thème, accès simulateur, réglages et panneau avancé
scripts/
  make-icons.py               Régénère les icônes (bibliothèque standard, sans Pillow)
  self-check.mjs              Vérifie le moteur de calcul hors navigateur
```

### Pourquoi cette organisation

Trois principes, et tout le reste en découle.

**1. Un seul fichier connaît le site.** `content/data/source-dom.js` est le seul
endroit qui cite un sélecteur CSS ou une classe d'École Directe. Le jour où le
site change, c'est le seul fichier à rouvrir. C'est aussi lui qui expose
`debug()`, l'outil de calibration.

**2. Un modèle de données stable.** `content/data/model.js` convertit la lecture
fragile du site en objets `Grade` normalisés (valeur, barème, /=20, coefficient,
statut, date). Aucune fonctionnalité ne lit le DOM du site : elles ne connaissent
que ce modèle. `features/averages.js` ne fait que du calcul pur, sans DOM ni
stockage, donc vérifiable hors navigateur.

**3. Un panneau isolé.** Le site est une grosse application avec des styles
agressifs. Le panneau vit dans un **Shadow DOM** (`content/ui/panel.js`) et
n'insère rien dans le contenu métier. Les fonctionnalités qui touchent à la page
(surlignage d'un cours) le font explicitement et se nettoient au démontage.

---

## Installation et essai

### Essai à chaud (développement)

```bash
npx web-ext run --source-dir .            # ouvre un Firefox avec l'extension chargée
```

### Chargement temporaire, sans web-ext

1. `about:debugging#/runtime/this-firefox`
2. « Charger un module complémentaire temporaire… »
3. Choisir `manifest.json` à la racine du dépôt.

### Vérification et paquet

```bash
npx web-ext lint --source-dir .           # validation AMO (manifeste, permissions, i18n)
npx web-ext build --source-dir . --overwrite-dest
```

`.web-ext-config.mjs` tient les outils de développement hors du paquet livré
(`scripts/`, le plan `structure`, `.gitignore`).

Sortie attendue de `web-ext lint` : **aucune erreur**, et un seul type
d'avertissement restant :

| Avertissement | Origine | Décision |
|---|---|---|
| `UNSUPPORTED_API` sur `appendChild`, `setAttribute`, `textContent`, `hidden`, `dataset`… | faux positifs de l'analyse statique : ce sont des API DOM parfaitement supportées par Firefox, présentes dans `content/ui/panel.js` | ignorés |

`background` ne déclare donc que `scripts`, sans `service_worker`. Ce n'est pas un
oubli : Firefox n'implémente pas les service workers d'arrière-plan, et **avant
Firefox 120 la simple présence de `background.service_worker` empêchait l'event
page de démarrer** — incompatible avec l'objectif Firefox 109+. Pour produire un
paquet Chromium plus tard, cette clé devra être ajoutée dans le manifeste du
paquet Chromium, pas dans celui-ci.

### Vérifier que la documentation du manifeste ne dérive pas

```bash
node scripts/check-manifest.mjs
```

Ce contrôle fait deux choses :

1. il vérifie que `manifest.json` est bien du **JSON strict** — aucun commentaire,
aucune virgule finale, car Firefox rejette alors le manifeste entier (et pas
seulement la ligne fautive) ;
2. il compare `manifest.annotated.jsonc`, la version commentée, avec le manifeste
réel, **clé par clé**, et échoue à la moindre divergence.

La documentation ne peut donc pas mentir sur le manifeste, et le manifeste ne
peut pas se mettre à contenir des commentaires par accident.

---

## Vérifier que le calcul est juste

```bash
node scripts/self-check.mjs
```

Ce script charge `constants.js`, `utils.js`, `model.js`, `averages.js` et
`theme.js` dans Node et contrôle les cas qui piègent les calculateurs naïfs :
barèmes autres que `/20`, notes « non significatives », notes hors moyenne, note
sans valeur, matière exclue, coefficients de devoir et de matière, arrondis,
simulateur, question inverse, page sans aucune note — plus la logique de bascule
du thème (`nextPreference`, `resolve`, `normalize`), dont dépend le bouton
lune/soleil. **À relancer après toute modification de `averages.js`, `model.js`
ou `theme.js`.**

---

## Calibrer la lecture du site

La lecture du site est heuristique, parce que le balisage d'École Directe n'est
pas public. Concrètement, `source-dom.js` ne cherche pas un sélecteur magique : il
détecte les **tableaux contenant des notes** (une cellule du type « 15,5/20 »),
puis les lit **par leurs en-têtes** (Date / Note / Coefficient / Moyenne de la
classe) plutôt que par des positions fixes.

Si une matière ou une note manque, ouvrez la console de la page et lancez :

```js
edpStatus()   // version, état, route, moyenne, avertissements, modules, panneau
```

Un content script vit dans un **monde isolé** : `EDP` n'est pas visible depuis la
console de la page, et `EDP is not defined` y est donc normal même quand tout
fonctionne. Le content script expose pour cela `edpStatus()` en lecture seule
(valeurs sérialisables, aucune action possible) via `wrappedJSObject`.

Pour les diagnostics détaillés, il faut la console de l'extension :
`about:debugging` → « Inspecter ».

```js
EDP.debug()                    // vue d'ensemble : route, source, réglages, avertissements
EDP.data.sourceDom.debug()     // ce qui a été lu : tableaux, matières, en-têtes, exemple
EDP.router.debug()             // quelle route est détectée et par quel marqueur
```

`EDP.data.sourceDom.debug()` affiche un tableau où chaque ligne correspond à un
tableau détecté, avec la matière reconnue, les en-têtes lus et un exemple de
ligne. Vous ajustez alors, dans le même fichier :

- `SELECTORS.notesHeading` — si la matière n'est pas identifiée (`⚠️ non identifiée`) ;
- `HEADER_RULES` — si une colonne n'est pas reconnue (coefficient, moyenne de la
  classe, min/max) ;
- `SELECTORS.notesContainers`, `timetableRoots`, `homeworkRoots` — si un écran
  entier est manqué.

Ces réglages se font en minutes, sans toucher au reste du code.

---

## Mode sombre et lisibilité

Le thème est construit en trois couches, et il faut savoir laquelle ouvrir :

| Fichier | Rôle | Quand y toucher |
|---|---|---|
| `styles/tokens.css` | Les couleurs, sous forme de variables. Deux blocs : clair, puis `[data-edp-theme="dark"]` | Pour changer la palette, jamais ailleurs |
| `styles/dark.css` | Surcharges du **site** quand le sombre est actif (`html[data-edp-dark="1"]`) | Quand un bloc du site reste blanc à l'inspection |
| `styles/base.css` + `styles/components/panel.css` + `styles/components/agenda.css` | Nos propres éléments (panneau, bouton de thème, agenda et devoirs du tiroir) | Mise en page de l'extension |

Quatre attributs sont posés sur `<html>` par `content/features/theme.js` :
`data-edp-theme` (valeur effective), `data-edp-dark` (`1`/`0`, cible de
`dark.css`), `data-edp-theme-pref` (ce que l'utilisateur a demandé) et
`data-edp-density` (`compact` / `normal` / `spacious`). Un cinquième,
`data-edp-preset`, nomme le préréglage courant (diagnostic).

### Apparence personnalisable (popup > Paramètres avancés)

Un préréglage (`shared/theme-presets.js`) porte **deux** palettes, claire et
sombre, pour que le mode « Automatique » reste cohérent quel que soit le style
choisi : Clair moderne, Sombre élégant, Contraste élevé. L'utilisateur peut
ensuite surcharger six valeurs — accent, fond, texte, cartes, rayon, police —
stockées dans `settings.themeOverrides` et **validées** avant d'atteindre le CSS
(hexadécimal `#rrggbb`, rayon 0 à 24 px, police dans la liste).

Ces six valeurs sont les seules écrites en inline sur `<html>` ; tout le reste
— bordures, survols, fonds teintés, rayons dérivés — est calculé par
`color-mix()` dans `styles/tokens.css`. Ajouter un préréglage ne demande donc
aucune règle CSS : une entrée de plus dans `THEME_PRESETS` suffit. Les
navigateurs sans `color-mix()` (Firefox 109-112) reçoivent un repli à valeurs
fixes, en fin de fichier de jetons.

Un quatrième choix, **« Personnalisé »**, ne porte pas de palette propre : il
reprend celle qui est affichée au moment du clic, la stocke dans
`themeOverrides`, puis laisse les quatre sélecteurs de couleur et le curseur de
rayon faire le reste. Créer son thème ne fait donc jamais sauter l'apparence
actuelle, et « Revenir au préréglage » retrouve la palette de base.

### Paramètres avancés (bouton « Paramètres avancés » du popup)

Le popup garde une carte courte (activation générale, pastille) et délègue le
reste à une **seconde vue**, ouverte par « Paramètres avancés » ou par l'action
du même nom. Elle se ferme par « Retour », sans rien perdre : chaque contrôle
écrit dans `storage.local` immédiatement, et les onglets École Directe ouverts
suivent par `storage.onChanged` — aucun rechargement n'est nécessaire.

- **Apparence** — mode (auto / clair / sombre), thèmes prédéfinis ou
  personnalisé, couleurs, rayon, police, réinitialisation du préréglage.
- **Densité de l'interface** — `compact`, `normal` ou `spacious`. Les trois
  échelles ne touchent qu'aux variables `--edp-space-*` (`styles/tokens.css`) :
  le panneau, son shadow root, les écrans refondus et le popup se resserrent ou
  s'aèrent ensemble, sans reconstruire une seule vue.
- **Modifications d'interface** — une case par grande refonte : relevé de notes,
  barre latérale, vue « Aujourd'hui », simulateur, emploi du temps, cahier de
  textes, bouton de thème, moyenne toujours visible. Décocher démonte le module
  et rend la page d'origine sur cet aspect uniquement.
- **Masquer des éléments du site** — encarts et bannières, fil d'actualité,
  aides et tutoriels, pied de page. Le choix est une liste d'identifiants
  (`settings.hiddenElements`) ; `content/features/cleanup.js` pose
  `data-edp-hidden="1"` sur les nœuds correspondants et
  `styles/features/cleanup.css` les masque. **Rien n'est supprimé** : décocher
  restaure immédiatement, et `source-dom.js` refuse de masquer un bloc qui
  contient les notes, l'emploi du temps, le cahier de textes ou nos interfaces.
  Les sélecteurs à ajuster sont dans `HIDE_SELECTORS` (`source-dom.js`).

Un module monté peut désormais recevoir `update(ctx)` à chaque synchronisation
(`content/core/registry.js`) : c'est ce qui applique le masquage en direct,
sans démonter puis remonter l'interface.

Le mode `auto` suit `prefers-color-scheme`. Le bouton flottant, lui, n'a que deux
états : il **force** l'inverse de ce qui est affiché et quitte donc `auto` au
premier clic. L'état est enregistré (`storage.local`) et partagé avec le popup.
Il se désactive comme les autres modules (« Bouton mode sombre » dans le popup).

Calibrer `dark.css` : ouvrir une page du site, inspecter un élément resté clair,
et ajouter **son** sélecteur dans la section correspondante (conteneurs, tableaux,
formulaires, modales). Une règle par symptôme constaté — jamais une règle plus
large « au cas où ». `EDP.debug()` confirme que le thème est actif avant de
chercher plus loin.

Deux détails qui coûtent une ligne et changent tout : `color-scheme: dark`
(barres de défilement et champs natifs sombres, gratuitement) et `accent-color`
sur les cases à cocher. Les `color-mix()` sont doublés d'un repli `@supports not
(...)` pour les Firefox 109 à 112, où la fonction n'existe pas encore.

---

## Permissions, et ce qu'elles ne permettent pas

| Permission | Usage exact |
|---|---|
| `storage` | Réglages, brouillon du simulateur et résumé destiné au popup, en local |
| `*://*.ecoledirecte.com/*` | Lire la page **déjà ouverte et connectée par vous** |

`web_accessible_resources` n'ajoute aucune permission : il autorise seulement la
page École Directe à lire nos **feuilles de style**, que `panel.js` injecte dans
le shadow root. Sans cette déclaration, le navigateur bloque la requête et le
panneau s'affiche sans mise en page. Seul du CSS est exposé, et uniquement sur
le domaine déjà autorisé ci-dessus.

Le manifeste ne demande **ni `tabs`, ni `webRequest`, ni `<all_urls>`**, et
`background.scripts` ne contient qu'une soixantaine de lignes sans état
persistant. Aucun accès réseau n'est effectué par l'extension : elle ne connaît
que le DOM de la page.

**Conséquence de la compatibilité Firefox 109+** : c'est à partir de Firefox 127
seulement que les permissions d'hôte déclarées dans `host_permissions` et
`content_scripts` sont affichées à l'installation et **accordées d'emblée**. Sur
Firefox 109 à 126, Manifest V3 les traite comme optionnelles : l'extension
s'installe, mais les scripts ne s'exécutent pas tant que l'utilisateur ne les a
pas activées dans `about:addons` → l'extension → **Permissions**. Le code
fonctionne sans modification ; c'est une étape manuelle de plus à expliquer dans
la fiche AMO et dans le README utilisateur. Si vous préférez zéro friction,
remplacez `strict_min_version` par `"127.0"` : plus aucune installation
antérieure ne sera possible, mais l'accès au site est accordé automatiquement.

---

## La moyenne toujours visible

Un petit panneau fixe, en bas à droite au-dessus de la pastille, affiche la
moyenne générale recalculée en permanence : la valeur, l'écart à la moyenne de
la classe et le nombre de matières et de notes prises en compte. Un clic déplie
le détail par matière ; le réglage `Modules → Moyenne toujours visible` du popup
le masque si vous préférez l'écran nu.

Sur un écran qui ne contient aucune note (emploi du temps, messagerie), le
panneau conserve **le dernier relevé connu** et l'annonce explicitement
(« dernier relevé ») : il ne présente jamais une valeur ancienne comme si elle
était à jour. Ce relevé est stocké dans `storage.local` sous `edp.lastAverage`
et disparaît avec les autres réglages (« Réinitialiser les réglages »).

---

## Simulateur de notes

Deux entrées : le tiroir du panneau (pastille « ED+ ») → **Simulateur de notes**,
ou le bouton **« Simuler une note »** du popup, qui ouvre le tiroir de l'onglet
École Directe déjà ouvert. Il ne modifie jamais le relevé : il travaille sur une
copie, dans la page.

- **Ajouter une hypothèse** : matière, note, barème (sur 10, 20, 30, 40) et
  coefficient. La note fictive apparaît dans une liste, avec `Entrée` ou le
  bouton « Ajouter » ; le champ se vide pour enchaîner.
- **Recalcul immédiat** : à chaque ajout ou retrait, la moyenne de la matière et
  la moyenne générale sont recalculées, avec l'écart par rapport au relevé réel
  et un tableau matière par matière. Plusieurs hypothèses peuvent coexister et
  se cumuler, y compris dans une même matière.
- **Retirer** une hypothèse : le `×` de sa ligne. **Tout effacer** :
  « Réinitialiser ».
- **Question inverse** (section repliable) : « il me faut combien pour atteindre
  15 dans cette matière ? », résolue sur le barème choisi.

Deux points de rigueur, faciles à rater :

1. **Le coefficient de matière est recalculé** quand une note fictive est
   ajoutée. Sinon une note à gros coefficient changerait la moyenne de la
   matière sans changer son poids dans la générale — et le résultat affiché ne
   correspondrait pas à ce qui se passera quand la note arrivera vraiment. Une
   surcharge manuelle de coefficient reste prioritaire.
2. **Aucune écriture côté site** : le calcul passe par
   `EDP.averages.simulateAll()`, qui construit un bundle copié. Le brouillon
   (hypothèses comprises) est conservé dans `storage.local`, clé
   `edp.simulation`, et « Réinitialiser les réglages » du popup l'efface aussi.

---

## Le relevé de notes

Sur l'écran Notes, `content/features/grades.js` masque les tableaux du site
(attribut `data-edp-native-grades`, masqué par `styles/features/grades.css`) et
les remplace par un relevé unique dans `#edp-grades-host` (shadow root, feuille
`styles/components/grades.css`). Rien n'est supprimé : au démontage, les
attributs sont retirés et les tableaux d'origine réapparaissent intacts.

| Élément | Contenu |
| --- | --- |
| En-tête | moyenne générale (moteur de calcul), jauge, moyenne de la classe et écart, notes retenues |
| Filtres | toutes / comptées / hors moyenne / absences, plus un filtre par matière et une recherche |
| Tris | plus récentes, plus anciennes, meilleures, plus basses, par matière, coefficient |
| Pastilles | trois paliers depuis `tokens.css` (≥ 15, 10 à 15, < 10) ; gris pour hors moyenne et absences |
| Note | valeur brute `/barème`, et équivalent `/20` quand le barème diffère |

Deux points de rigueur :

1. **Tri et filtres ne touchent qu'à l'affichage** : ils travaillent sur des
   copies des notes normalisées, donc la moyenne affichée reste celle du moteur
   de calcul, quels que soient les filtres actifs.
2. **Le simulateur reste la seule source des hypothèses** : `grades.js` relit
   `edp.simulation` et le passe à `EDP.averages.simulateAll()`. La moyenne
   simulée apparaît dans l'en-tête et sous chaque matière concernée ; elle se
   met à jour dès que le simulateur enregistre (écoute de `storage.onChanged`).

Si les notes ne sont pas remplacées, vérifier d'abord la route
(`EDP.router.debug()`) puis `EDP.data.sourceDom.debug()` : la détection exige
l'écran Notes et au moins un tableau reconnu. Décocher « Moyennes calculées »
dans le popup suffit à revenir à l'affichage d'origine.

## Graphiques d'évolution des notes

Sous le relevé (et donc sur le même écran), `content/features/charts.js` insère
`#edp-charts-host` **après le dernier tableau de notes du site** — pas avant :
le relevé refondu s'ancre juste avant le premier tableau et se replace à chaque
mutation, se disputer la même ancre ferait danser les deux blocs.

| Élément | Contenu |
| --- | --- |
| Courbe de la moyenne générale | moyenne de toutes les notes reçues à chaque date, aire teintée |
| Courbes par matière | une ligne par matière, légende cliquable (6 matières affichées d'emblée, les plus notées) |
| Période | trimestre, année scolaire, ou deux dates personnalisées (`<input type="date">`) |
| Bouton | « Masquer / Afficher les graphiques », mémorisé dans `chartsVisible` |

Aucune librairie : les courbes sont un `<svg>` construit avec
`createElementNS`. Le CSP de MV3 interdit tout script distant, donc Chart.js
devrait être embarqué (~200 ko) pour deux courbes ; le SVG tient en quelques
dizaines de lignes, reste net à toutes les tailles, hérite des variables de
thème et n'ajoute aucune dépendance à auditer. Les six teintes viennent de
`tokens.css` (`--edp-chart-1` à `--edp-chart-6`, dérivées de l'accent et des
couleurs sémantiques) : le mode sombre et un préréglage personnalisé suivent
sans qu'une règle bouge, et la densité s'applique puisqu'aucun espacement n'est
écrit en dur.

Les calculs sont dans `content/features/progress.js` (code pur, vérifié par
`scripts/self-check.mjs`) :

1. Seules les notes **comptées et datées** entrent dans une courbe. Les notes
   sans date sont ignorées et le pied du bloc l'indique.
2. Une moyenne « à une date » est la moyenne de toutes les notes **jusqu'à cette
   date incluse**. La courbe générale rejoue `EDP.averages.computeBundle()`, donc
   elle ne peut pas contredire l'en-tête du relevé.
3. Les coefficients de matière sont ceux de la période entière : les faire
   varier à chaque note ferait sauter la courbe sans explication lisible.
4. Le découpage des trimestres est **estimé** (septembre → décembre, décembre →
   mars, mars → août) : École Directe n'expose pas ses bornes dans la page, et
   l'interface le dit. Si le trimestre courant ne contient aucune note (vacances,
   rentrée), les graphiques basculent sur le dernier trimestre noté.

Le tracé ne répond à aucun événement réseau : il relit `EDP.data.get()` et se
redessine quand l'empreinte des notes change (le site charge ses notes en Ajax).

## Vue « Aujourd'hui »

`content/features/today.js` réunit sur un seul écran ce qui compte dans la
journée : un bandeau « en cours / prochain cours », les cours du jour, les
devoirs à rendre aujourd'hui ou demain (les retards restent visibles), les
dernières notes et les absences/retards. La moyenne générale reste affichée en
petit dans l'en-tête quand le moteur a pu la calculer.

Deux emplacements, réglables dans le popup (`todayPlacement`) :

| Emplacement | Comportement |
| --- | --- |
| `home` (défaut) | sur la page d'accueil, le contenu principal est masqué et remplacé par la vue |
| `panel` | la vue vit dans le tiroir École Directe Plus+, sous une section « Aujourd'hui », avec un bouton rapide « Auj. » pour l'ouvrir depuis n'importe quel écran ; la page reste intacte |

En mode `home`, le contenu d'origine n'est **jamais supprimé** : il est repéré
par `findNativeMain()` (balise `<main>`, `#mainContent`, conteneur d'accueil…),
marqué `data-edp-native-main` puis masqué par `styles/features/today.css`. Au
démontage (changement d'écran, module décoché, passage en mode panneau),
l'attribut est retiré et la page redevient intacte. Si aucun conteneur crédible
n'est trouvé, rien n'est masqué du tout.

Données, toutes lues sur la page :

| Carte | Source |
| --- | --- |
| Cours du jour | `timetableRows()` (horaire, salle, cours annulé) |
| À rendre aujourd'hui ou demain | `homeworkRows()` (échéance à J ou J+1, retards, état « fait ») |
| Dernières notes | notes normalisées du dernier relevé des tableaux |
| Absences / retards | `absences()` (type, date, durée, justification) |
| Moyenne | moteur de calcul local (`data.general.average20`), masquée si aucune note n'est lisible |

Les devoirs sans date ne peuvent pas être situés : ils ne sont pas listés mais
comptés sous la grille, avec un renvoi vers le cahier de textes. La lecture de
l'accueil est groupée dans `SELECTORS.homeRoots` et `SELECTORS.absenceRoots` :
c'est là qu'on ajuste si la vue ne s'affiche pas ou si une carte reste vide. La
détection de l'écran repose sur l'URL (`accueil`, `dashboard`, `home`) et sur le
conteneur d'`accueil`. En cas de mauvais remplacement, décocher « Vue
« Aujourd'hui » » dans le popup suffit à revenir à la page d'origine.

## Le popup

Le popup est volontairement court, parce qu'un popup se consulte en dix
secondes :

- **en-tête** — logo, nom, version et bouton de thème (lune/soleil). Le bouton
  montre l'état effectif et son titre annonce l'action ; il écrit dans les
  réglages, donc la page et le popup restent d'accord. Le mode « Suivre le
  système » reste disponible dans les paramètres, puisque le bouton, à deux
  états, force toujours clair ou sombre ;
- **moyenne** — le chiffre en grand, l'écart à la classe et les nouvelles notes
  en pastilles, la dernière note et le cours en cours sur une ligne ;
- **actions** — « Simuler une note » ouvre le simulateur dans la page (le popup
  n'a pas accès à son DOM, il envoie un message au content script) ;
  « Paramètres » ouvre le panneau de paramètres avancés du popup.

Le popup ne calcule **rien** : il lit le résumé écrit par le content script via
le background. Deux moteurs de calcul donneraient deux moyennes différentes à
deux endroits — c'est exactement ce qu'on veut éviter.

Si l'onglet actif n'est pas École Directe, « Simuler une note » ouvre le site. Si
l'onglet l'est mais ne répond pas (page en chargement, extension rechargée), le
popup le dit et demande de recharger, au lieu d'ouvrir un second onglet.

---

## Limites connues de la v1.0

- **Firefox 109 à 126** : l'accès au site doit être activé manuellement après
  l'installation (`about:addons` → Permissions). Voir la section Permissions.
- **La lecture du DOM est fragile** : une refonte du site casse les sélecteurs.
  Le mode dégradé est volontairement silencieux (pas de panneau, pas d'erreur
  visible), et `edpStatus()` (console de la page) ou `EDP.debug()` (console de
  l'extension) dit précisément quoi corriger.
- **Source API non implémentée** : voir `content/data/source-api.js`, qui
  documente la voie à suivre (observateur de XHR/fetch dans le monde de la page,
  sans jamais manipuler les identifiants).
- **Emploi du temps sur plusieurs jours** : seule la première journée contenant
  des horaires est exploitée.
- **Coefficients** : ceux du site sont parfois absents ou erronés. L'édition
  manuelle (surcharges par matière) existe dans les réglages
  (`coefficientOverrides`), et c'est souvent indispensable pour retrouver la
  moyenne officielle.
- **Notes masquées par l'établissement** : l'extension ne force **jamais**
  l'affichage d'une note que le collège ou le lycée a choisi de ne pas publier.
  Ce n'est pas un oubli, c'est une décision de conception.

---

## Feuille de route

1. `source-api.js` : seconde source de données, plus riche, sans identifiants.
2. Notifications de nouvelle note hors navigateur (optionnelles).
3. Vue « bilan » : points forts, points faibles, objectif de moyenne.
4. Calcul de moyenne pour le bac (spécialités, contrôle continu, grand oral).
5. Export `.ics` des devoirs et export JSON/CSV des notes.
6. Version Chromium/Edge depuis la même base : il reste à déclarer
   `background.service_worker` dans un manifeste propre au paquet Chromium, à
   produire le paquet et à le tester.

---

## Confidentialité

- Aucun serveur, aucune requête sortante, aucune analytique.
- Les seules données stockées sont des réglages et des agrégats calculés
  (moyennes, empreintes de notes), dans `storage.local`, effaçables en un clic
  (« Réinitialiser les réglages »).
- Le simulateur ne modifie jamais les données réelles : il travaille sur une
  copie. Rien n'est écrit côté site.
