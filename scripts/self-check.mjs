/**
 * scripts/self-check.mjs
 * ----------------------
 * Vérification du moteur de calcul, hors navigateur :
 *
 *     node scripts/self-check.mjs
 *
 * Pourquoi c'est indispensable : les moyennes sont la seule chose que cette
 * extension affirme. Un moteur de calcul faux ne se voit pas à l'œil nu, mais se
 * voit tout de suite dans le bulletin d'un élève. Ces vérifications couvrent les
 * cas qui font échouer les calculateurs naïfs : barèmes autres que /20, notes
 * non significatives, matières exclues, coefficients, matière sans note.
 *
 * Les fichiers de l'extension sont des scripts classiques (pas des modules ES) :
 * ils sont chargés ici via import() dynamique, dans l'ordre du manifeste, en
 * s'appuyant sur `globalThis.EDP` exactement comme dans le navigateur.
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const checks = [];
let failures = 0;

/** Enregistre et exécute un contrôle. */
function check(label, condition, detail = '') {
  const passed = Boolean(condition);
  checks.push({ label, passed, detail });
  if (!passed) failures += 1;
}

function close(label, actual, expected, tolerance = 0.02) {
  const ok = typeof actual === 'number' && Math.abs(actual - expected) <= tolerance;
  check(label, ok, ok ? '' : `attendu ≈ ${expected}, obtenu ${actual}`);
}

const modules = [
  'shared/constants.js',
  'shared/utils.js',
  'content/data/model.js',
  'content/features/averages.js',
  // theme.js n'accède au DOM que dans apply() : il se charge sans navigateur,
  // ce qui permet de tester la logique de bascule (le bouton repose dessus).
  'content/features/theme.js'
];

for (const path of modules) {
  await import(new URL(`file://${resolve(root, path)}`));
}

const { EDP } = globalThis;
const { utils, model, averages, GRADE_STATUS } = EDP;

// --- 1. Lecture des notes telles qu'École Directe les écrit ----------------
const plain = utils.parseGradeText('15,5/20');
check('« 15,5/20 » -> 15.5 sur 20', plain.value === 15.5 && plain.outOf === 20);
check('« 15,5/20 » compte dans la moyenne', plain.status === GRADE_STATUS.COUNTED);

const otherScale = utils.parseGradeText('7,5 /10');
check('« 7,5 /10 » -> barème 10', otherScale.value === 7.5 && otherScale.outOf === 10);

const bare = utils.parseGradeText('12');
check('« 12 » sans barème -> 20 par défaut', bare.value === 12 && bare.outOf === 20);

const notSignificant = utils.parseGradeText('Non significative');
check(
  '« Non significative » -> exclue',
  notSignificant.value === null && notSignificant.status === GRADE_STATUS.NON_SIGNIFICANT
);

const absent = utils.parseGradeText('Absent');
check('« Absent » -> inexploitable', absent.value === null && absent.status === GRADE_STATUS.ABSENT);

const horsMoyenne = utils.parseGradeText('8/20 hors moyenne');
check('« hors moyenne » -> non comptée', horsMoyenne.status === GRADE_STATUS.NOT_COUNTED);

check('conversion /10 -> /20', utils.toOutOf20(7.5, 10) === 15);
check('arrondi à 2 décimales', utils.round2(13.333333) === 13.33);
close('moyenne pondérée vide -> null', averages.weightedMean([]).average === null ? 0 : 1, 0, 0);

// --- 2. Construction du bundle --------------------------------------------
const settings = { ...EDP.DEFAULTS };
const raw = [
  { subject: 'Mathématiques', label: 'Devoir 1', value: 12, outOf: 20, coefficient: 2, date: new Date(2026, 2, 1) },
  { subject: 'Mathématiques', label: 'Devoir 2', value: 16, outOf: 20, coefficient: 1, date: new Date(2026, 2, 10) },
  { subject: 'Français', label: 'Dissertation', value: 10, outOf: 20, coefficient: 1 },
  { subject: 'Français', label: 'Lecture', value: null, status: GRADE_STATUS.NON_SIGNIFICANT, outOf: 20 },
  { subject: 'EPS', label: 'Natation', value: 14, outOf: 20, coefficient: 1 },
  // Barème différent (/10) et coefficient de devoir 2 : c'est ce cas qui
  // distingue une vraie moyenne pondérée d'une simple moyenne de moyennes.
  { subject: 'Histoire', label: 'Contrôle', value: 8, outOf: 10, coefficient: 2 }
];

const bundle = model.buildBundle(raw, settings);
check('6 notes brutes -> 6 notes normalisées', bundle.grades.length === 6);
check('4 matières détectées', bundle.subjects.length === 4);

const math = bundle.subjects.find((subject) => subject.name === 'Mathématiques');
check('coefficient de matière = somme des devoirs (3)', math && math.coefficient === 3);

const computed = averages.computeBundle(bundle, settings);
const computedMath = computed.subjects.find((subject) => subject.key === math.key);
close('moyenne Mathématiques (12×2 + 16) / 3', computedMath.average20, 13.33);
// (13,33×3 + 10×1 + 14×1 + 16×2) / 7 = 13,71
close('moyenne générale pondérée par matière', computed.general.average20, 13.71, 0.05);

const litterature = computed.subjects.find((subject) => subject.name === 'Français');
close('Français : note non significative ignorée', litterature.average20, 10);
check('Français compte 1 note sur 2', litterature.gradeCount === 1);

const history = computed.subjects.find((subject) => subject.name === 'Histoire');
close('barème /10 ramené sur 20 (8/10 -> 16/20)', history.average20, 16);
check('coefficient de devoir cumulé dans la matière (2)', history.coefficient === 2);
check('conversion d’un barème inattendu (15/10 -> 30/20)', utils.toOutOf20(15, 10) === 30);

// --- 3. Matière exclue ----------------------------------------------------
// Le point sensible : l'exclusion doit être décidée au calcul, à partir des
// réglages reçus, et non héritée du bundle construit plus haut.
const withoutEps = averages.computeBundle(bundle, { ...settings, excludedSubjects: ['EPS'] });
check('EPS exclue : 3 matières utilisées', withoutEps.general.subjectsUsed === 3, `obtenu ${withoutEps.general.subjectsUsed}`);
check(
  'EPS exclue : moyenne générale recalculée',
  withoutEps.general.average20 !== computed.general.average20,
  `obtenu ${withoutEps.general.average20}`
);
const withoutFrench = averages.computeBundle(bundle, { ...settings, excludedSubjects: ['français'] });
check('exclusion insensible à la casse et aux accents', withoutFrench.general.subjectsUsed === 3, `obtenu ${withoutFrench.general.subjectsUsed}`);

// --- 4. Sans coefficients de matière --------------------------------------
// (13,33 + 10 + 14 + 16) / 4 = 13,33 : sans pondération, la moyenne générale
// n'est plus la même que ci-dessus (13,71), ce qui prouve que les coefficients
// de matière sont bien appliqués.
const flat = averages.computeBundle(bundle, { ...settings, useSubjectCoefficients: false });
close('moyennes de matières non pondérées', flat.general.average20, 13.33, 0.05);
check('pondération active et inactive donnent des résultats différents', flat.general.average20 !== computed.general.average20);

// --- 5. Simulateur -------------------------------------------------------
const simulation = averages.simulate(bundle, { subjectKey: litterature.key, value: 20, outOf: 20, coefficient: 1 }, settings);
check('simulation : moyenne générale recalculée', simulation.simulated.general.average20 !== simulation.base.general.average20);
check('simulation : écart positif avec 20/20', simulation.delta > 0);
check('simulation : la moyenne réelle est intacte', averages.computeBundle(bundle, settings).general.average20 === computed.general.average20);

// --- 6. Question inverse --------------------------------------------------
close('note nécessaire : 10 de moyenne, poids 4, cible 12, poids 1', averages.neededGrade({
  currentAverage: 10,
  currentWeight: 4,
  target: 12,
  newWeight: 1
}), 20);
close('note nécessaire sur matière vierge = la cible', averages.neededGrade({
  currentAverage: null,
  currentWeight: 0,
  target: 14,
  newWeight: 1
}), 14);
close('note nécessaire /10 pour une cible sur 20', averages.neededGradeOnScale(15, 10), 7.5);
check('objectif irréaliste détecté', averages.neededGrade({
  currentAverage: 8,
  currentWeight: 1,
  target: 20,
  newWeight: 1
}) > 20);

// --- 7. Conditions dégradées ---------------------------------------------
const empty = model.buildBundle([], settings);
check('aucune note -> bundle vide + avertissement', empty.grades.length === 0 && empty.warnings.length > 0);
const weird = model.buildBundle([{ subject: '', value: 12 }], settings);
check('note sans matière ignorée', weird.grades.length === 0);
const noAverage = averages.weightedMean([{ value20: null, weight: 1 }]);
check('note sans valeur -> pas de moyenne (jamais 0)', noAverage.average === null);

// --- 8. Thème : bascule et résolution --------------------------------------
// Le bouton de mode sombre n'a que deux états : il doit donc forcer
// explicitement l'inverse de ce qui est affiché. Une erreur ici donnerait un
// bouton qui ne fait rien un clic sur deux.
const { theme } = EDP;
check('bascule : sombre -> clair', theme.nextPreference('dark') === 'light');
check('bascule : clair -> sombre', theme.nextPreference('light') === 'dark');
check(
  'préférence explicite respectée',
  theme.resolve('dark') === 'dark' && theme.resolve('light') === 'light'
);
check('préférence inconnue ramenée à « auto »', theme.normalize('n-importe-quoi') === 'auto');
check('mode auto résolu dans un des deux états', ['light', 'dark'].includes(theme.resolve('auto')));

// --- Rapport --------------------------------------------------------------
const label = (entry) => `${entry.passed ? 'ok  ' : 'FAIL'} ${entry.label}${entry.detail ? ` — ${entry.detail}` : ''}`;
checks.forEach((entry) => console.log(label(entry)));
console.log(`\n${checks.length - failures}/${checks.length} contrôles réussis`);
if (failures) {
  console.error(`\n${failures} contrôle(s) en échec : le moteur de calcul ne doit pas être publié en l'état.`);
  process.exit(1);
}
console.log('Moteur de calcul conforme.');
