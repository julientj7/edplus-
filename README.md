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
background/
  background.js               Event page : init des réglages, cache du résumé, pastille
  messages.js                 Routeur de messages (une table type → handler)
  badge.js                    Pastille « N nouvelles notes » sur l'icône
content/
  main.js                     Orchestrateur : démarrage, recalcul, diffusion, arrêt
  core/
    dom.js                    Helpers DOM tolérants ($, $$, waitFor, onDomChange)
    messaging.js              Client de messagerie côté page (jamais d'exception)
    registry.js               Registre des fonctionnalités (mount/unmount idempotent)
    router.js                 Détection de l'écran courant (notes / EDT / devoirs)
  data/
    model.js                  Modèle normalisé : c'est le contrat stable du projet
    adapter.js                Façade de données + vue « snapshot » pour le popup
    source-dom.js             ⚠️ SEUL FICHIER À ADAPTER AU SITE (lecture de la page)
    source-api.js             Source API réservée — non implémentée en v1.0 (et pourquoi)
  features/
    averages.js               Moteur de calcul pur (moyennes, simulation, objectif)
    theme.js                  Thème : préférence, résolution « auto », bascule, événement
    dark-mode.js              Suivi du thème du système d'exploitation
    theme-toggle.js           Bouton flottant lune/soleil (dans le shadow root du panneau)
    grades.js                 Carte des moyennes + bande de résumé dans la page
    simulator.js              « Et si j'avais 17 ? » et « il me faut combien ? »
    timetable.js              Cours en cours / suivant, surlignage des lignes
    homework.js               Devoirs en retard, aujourd'hui, sous 48 h
  ui/
    components.js             Composants (carte, tableau, champ…) sans innerHTML
    panel.js                  Pastille + tiroir en Shadow DOM
styles/
  tokens.css                  Variables de design (clair et sombre)
  base.css                    Primitives d'interface + hôte du panneau  (2 usages)
  dark.css                    Surcharges du SITE en sombre — partie fragile
  components/panel.css        Mise en page de la pastille et du tiroir
  features/grades.css         Lisibilité du tableau de notes du site
  features/timetable.css      Surlignage « en cours » / « suivant »
  features/homework.css       Marquage retard / imminent / fait
popup/
  popup.html                  Résumé (moyenne, dernière note, cours, devoirs)
  popup.css                   Mise en page du popup
  popup.js                    Liaison aux réglages partagés et au résumé
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
| `styles/base.css` + `styles/components/panel.css` | Nos propres éléments (panneau, bouton de thème) | Mise en page de l'extension |

Trois attributs sont posés sur `<html>` par `content/features/theme.js` :
`data-edp-theme` (valeur effective), `data-edp-dark` (`1`/`0`, cible de
`dark.css`) et `data-edp-theme-pref` (ce que l'utilisateur a demandé).

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

## Limites connues de la v1.0

- **Firefox 109 à 126** : l'accès au site doit être activé manuellement après
  l'installation (`about:addons` → Permissions). Voir la section Permissions.
- **La lecture du DOM est fragile** : une refonte du site casse les sélecteurs.
  Le mode dégradé est volontairement silencieux (pas de panneau, pas d'erreur
  visible), et `EDP.debug()` dit précisément quoi corriger.
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
