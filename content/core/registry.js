'use strict';
/**
 * content/core/registry.js
 * ------------------------
 * Registre des fonctionnalités. Chaque module (grades, simulator, timetable,
 * homework…) s'annonce ici et décrit trois choses :
 *
 *   detect(ctx)  -> la fonctionnalité a-t-elle quelque chose à faire ici ?
 *   mount(ctx)   -> construit son interface, renvoie éventuellement un handle
 *   settingKey   -> la clé de EDP.DEFAULTS.modules qui l'active/désactive
 *
 * Pourquoi ce niveau d'indirection : le site recharge ses écrans en place. Sans
 * registre, chaque module devrait surveiller le DOM pour son compte, monter et
 * démonter ses nœuds à la main, et on finirait avec des panneaux fantômes
 * empilés. Ici, un seul endroit décide : `sync()`.
 *
 * `sync()` est idempotent : on peut l'appeler à chaque changement de route, de
 * réglages ou de données sans risque de double montage.
 */
(() => {
  const EDP = globalThis.EDP;

  const features = [];

  /** Déclare une fonctionnalité. À appeler au chargement du module. */
  function registerFeature(definition) {
    if (!definition || !definition.id) {
      console.warn('[ED+] fonctionnalité sans identifiant ignorée');
      return;
    }
    if (features.some((feature) => feature.id === definition.id)) {
      console.warn('[ED+] fonctionnalité déjà enregistrée :', definition.id);
      return;
    }
    features.push({
      id: definition.id,
      label: definition.label || definition.id,
      settingKey: definition.settingKey || null,
      detect: definition.detect || (() => true),
      mount: definition.mount || (() => null),
      unmount: definition.unmount || null,
      snapshot: definition.snapshot || null,
      mounted: false,
      handle: null
    });
  }

  /** Une fonctionnalité est-elle activée par les réglages de l'utilisateur ? */
  function isEnabled(feature, settings) {
    if (!feature.settingKey) return true;
    const modules = (settings && settings.modules) || {};
    return modules[feature.settingKey] !== false;
  }

  /**
   * Fait converger l'état des fonctionnalités avec le contexte courant.
   * @param {object} ctx contexte partagé : { settings, route, data, panel }
   */
  async function sync(ctx) {
    const active = [];
    for (const feature of features) {
      const enabled = isEnabled(feature, ctx.settings);
      let shouldMount = false;

      if (enabled) {
        try {
          shouldMount = feature.detect(ctx) === true;
        } catch (error) {
          console.warn(`[ED+] detect() en échec pour ${feature.id} :`, error);
          shouldMount = false;
        }
      }

      if (shouldMount && !feature.mounted) {
        try {
          feature.handle = await feature.mount(ctx);
          feature.mounted = true;
          active.push(feature.id);
        } catch (error) {
          // Un module qui plante ne doit jamais empêcher les autres de tourner.
          console.error(`[ED+] montage impossible pour ${feature.id} :`, error);
          feature.mounted = false;
          feature.handle = null;
        }
      } else if (!shouldMount && feature.mounted) {
        try {
          if (feature.unmount) await feature.unmount(ctx);
          else if (feature.handle && feature.handle.destroy) feature.handle.destroy();
        } catch (error) {
          console.warn(`[ED+] démontage incomplet pour ${feature.id} :`, error);
        } finally {
          feature.mounted = false;
          feature.handle = null;
        }
      }
    }
    return active;
  }

  /**
   * Rassemble les « sections » fournies par les fonctionnalités montées.
   * Chacune peut exposer `snapshot(ctx)` (prochain cours, devoirs du jour…).
   * Le popup lit ce résultat sans avoir besoin d'ouvrir un onglet du site.
   */
  function collect(ctx) {
    const sections = {};
    features.forEach((feature) => {
      if (!feature.mounted || typeof feature.snapshot !== 'function') return;
      try {
        sections[feature.id] = feature.snapshot(ctx) || null;
      } catch (error) {
        console.warn(`[ED+] snapshot() en échec pour ${feature.id} :`, error);
        sections[feature.id] = null;
      }
    });
    return sections;
  }

  /** Diagnostic : état de chaque fonctionnalité (utilisé par EDP.debug()). */
  function status() {
    return features.map(({ id, label, settingKey, mounted }) => ({ id, label, settingKey, mounted }));
  }

  EDP.registry = { registerFeature, sync, collect, status };
})();
