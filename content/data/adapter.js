'use strict';
/**
 * content/data/adapter.js
 * ----------------------
 * Façade de données : c'est le point d'entrée unique des fonctionnalités.
 * Personne d'autre n'appelle une source directement.
 *
 * Il choisit la meilleure source disponible, construit le bundle normalisé,
 * y attache les moyennes calculées, et diffuse l'état aux abonnés.
 * Changer de source (DOM -> API) ne touche donc que ce fichier.
 */
(() => {
  const EDP = globalThis.EDP;

  /** Dernier état collecté, réutilisé par les fonctionnalités et le diagnostic. */
  let state = null;
  const listeners = new Set();

  /** Sources par ordre de préférence : l'API, plus riche, avant le DOM. */
  function candidates() {
    return [EDP.data.sourceApi, EDP.data.sourceDom].filter(
      (source) => source && typeof source.available === 'function' && source.available()
    );
  }

  /** État vide : la page n'expose aucune donnée exploitable (EDT, messagerie…). */
  function emptyState(settings, reason) {
    return {
      empty: true,
      source: null,
      period: null,
      grades: [],
      subjects: [],
      warnings: reason ? [reason] : [],
      general: { average20: null, weight: 0, subjectsUsed: 0 },
      classGeneral: null,
      settings,
      route: EDP.router ? EDP.router.current : null,
      at: Date.now()
    };
  }

  /**
   * Collecte l'état courant.
   * @param {object} [options] { settings } pour réutiliser des réglages déjà lus
   */
  async function collect(options = {}) {
    const settings = options.settings || (await EDP.settings.get());
    const sources = candidates();

    if (!sources.length) {
      state = emptyState(settings, null);
      return state;
    }

    const source = sources[0];
    let payload = { grades: [], period: null, warnings: [] };
    try {
      payload = await source.read();
    } catch (error) {
      payload = { grades: [], period: null, warnings: [`Lecture impossible (${source.id}) : ${error.message}`] };
    }

    const bundle = EDP.model.buildBundle(payload.grades, settings);
    const computed = EDP.averages.computeBundle(bundle, settings);

    state = {
      empty: computed.subjects.length === 0,
      source: source.id,
      period: payload.period,
      grades: bundle.grades,
      subjects: computed.subjects,
      warnings: bundle.warnings.concat(payload.warnings || []).slice(0, 8),
      general: computed.general,
      classGeneral: computed.classGeneral,
      settings,
      route: EDP.router ? EDP.router.current : null,
      at: Date.now()
    };
    return state;
  }

  /** Recollecte et prévient les abonnés (changement de route, de réglages, DOM). */
  async function refresh(options = {}) {
    const next = await collect(options);
    listeners.forEach((listener) => {
      try {
        listener(next);
      } catch (error) {
        console.warn('[ED+] abonné aux données en échec :', error);
      }
    });
    return next;
  }

  function subscribe(callback) {
    listeners.add(callback);
    return () => listeners.delete(callback);
  }

  /** État courant, sans recollecte. */
  function get() {
    return state;
  }

  /**
   * Vue destinée au popup : volontairement plate et courte (on ne stocke pas
   * l'intégralité des notes dans le stockage partagé).
   */
  function toSnapshot() {
    if (!state) return null;
    const lastGrade = EDP.model.sortByDateDesc(state.grades.filter((grade) => grade.counted))[0] || null;
    return {
      at: state.at,
      empty: state.empty,
      source: state.source,
      period: state.period,
      route: state.route,
      general: state.general,
      classGeneral: state.classGeneral,
      subjects: state.subjects
        .filter((subject) => subject.average20 !== null)
        .map((subject) => ({ name: subject.name, average20: subject.average20, coefficient: subject.coefficient })),
      counts: {
        grades: state.grades.length,
        counted: state.grades.filter((grade) => grade.counted).length
      },
      lastGrade: lastGrade
        ? {
            subject: lastGrade.subject,
            label: lastGrade.label,
            value: lastGrade.value,
            outOf: lastGrade.outOf,
            value20: lastGrade.value20,
            date: lastGrade.date ? lastGrade.date.toISOString() : null
          }
        : null,
      warnings: state.warnings.slice(0, 4),
      sections: {}
    };
  }

  EDP.data = EDP.data || {};
  EDP.data.adapter = { collect, refresh, subscribe, get, toSnapshot };
  // Raccourci lisible pour les fonctionnalités : EDP.data.collect() & co.
  EDP.data.collect = collect;
  EDP.data.refresh = refresh;
  EDP.data.subscribe = subscribe;
  EDP.data.get = get;
  EDP.data.toSnapshot = toSnapshot;
})();
