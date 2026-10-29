/**
 * scripts/check-manifest.mjs
 * --------------------------
 * Vérifie que manifest.annotated.jsonc décrit EXACTEMENT manifest.json.
 *
 *     node scripts/check-manifest.mjs
 *
 * Pourquoi un contrôle dédié : Firefox ne sait pas lire un manifeste commenté
 * (le JSON strict n'accepte pas de commentaires), donc la documentation vit dans
 * un fichier jumeau. Deux fichiers qui prétendent dire la même chose finissent
 * toujours par diverger — sauf si quelque chose le vérifie. Ici, c'est vérifié :
 * on retire les commentaires du .jsonc, on compare les deux structures, et on
 * échoue à la moindre différence de clé ou de valeur.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Retire les commentaires // et /* *​/ en respectant les chaînes de caractères. */
function stripJsonComments(text) {
  let out = '';
  let inString = false;
  let i = 0;

  while (i < text.length) {
    const char = text[i];

    if (inString) {
      out += char;
      if (char === '\\') {
        out += text[i + 1] ?? '';
        i += 2;
        continue;
      }
      if (char === '"') inString = false;
      i += 1;
      continue;
    }

    if (char === '"') {
      inString = true;
      out += char;
      i += 1;
      continue;
    }

    if (char === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      continue;
    }

    if (char === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }

    out += char;
    i += 1;
  }
  return out;
}

/**
 * Neutralise le contenu des chaînes (en conservant la longueur).
 *
 * Indispensable : le manifeste contient des motifs de correspondance d'hôtes du
type "*://*.ecoledirecte.com/*", qui comportent « // » sans être des
commentaires. Une recherche naïve les signale à tort — c'est exactement le faux
positif que ce contrôle a produit avant d'être écrit correctement.
 */
function blankStrings(text) {
  let out = '';
  let inString = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (char === '\\') {
        out += '  ';
        i += 1;
        continue;
      }
      if (char === '"') {
        inString = false;
        out += char;
        continue;
      }
      out += ' ';
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }
    out += char;
  }
  return out;
}

/** Chemins de clés en désaccord (préfixés par + pour un ajout, - pour un retrait). */
function diff(left, right, path = '') {
  if (left === right) return [];
  const bothObjects =
    left && right && typeof left === 'object' && typeof right === 'object' && !Array.isArray(left) && !Array.isArray(right);

  if (bothObjects) {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    return [...keys].flatMap((key) => {
      if (!(key in left)) return [`+ ${path}${key}`];
      if (!(key in right)) return [`- ${path}${key}`];
      return diff(left[key], right[key], `${path}${key}.`);
    });
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return [`${path} longueur ${left.length} ≠ ${right.length}`];
    return left.flatMap((value, index) => diff(value, right[index], `${path}[${index}].`));
  }

  return [`${path.slice(0, -1)} : ${JSON.stringify(left)} ≠ ${JSON.stringify(right)}`];
}

const rawManifest = readFileSync(resolve(root, 'manifest.json'), 'utf8');

// --- 1. Le manifeste réellement chargé doit être du JSON STRICT ------------
const skeleton = blankStrings(rawManifest);
const forbidden = [];
if (skeleton.includes('//')) forbidden.push('commentaire //');
if (skeleton.includes('/*')) forbidden.push('commentaire /* */');
if (/,\s*[}\]]/.test(skeleton)) forbidden.push('virgule finale');

if (forbidden.length) {
  console.error(`manifest.json contient des séquences que le JSON strict refuse : ${forbidden.join(', ')}`);
  console.error('Rappel : Firefox rejette alors le manifeste entier — ce n’est pas un simple avertissement.');
  process.exit(1);
}
console.log('ok   manifest.json est du JSON strict (aucun commentaire, aucune virgule finale)');

// --- 2. La version commentée doit décrire exactement le même contenu -------
const manifest = JSON.parse(rawManifest);
const annotated = JSON.parse(stripJsonComments(readFileSync(resolve(root, 'manifest.annotated.jsonc'), 'utf8')));

const differences = diff(annotated, manifest);

if (differences.length) {
  console.error('Le manifeste commenté a divergé de manifest.json :');
  differences.forEach((line) => console.error('  ' + line));
  process.exit(1);
}

console.log(`ok   manifest.annotated.jsonc décrit exactement manifest.json (${Object.keys(manifest).length} clés racine)`);
console.log(`ok   id=${manifest.browser_specific_settings.gecko.id} · min=${manifest.browser_specific_settings.gecko.strict_min_version} · permissions=${JSON.stringify(manifest.permissions)}`);
