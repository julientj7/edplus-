'use strict';
/**
 * content/core/dom.js
 * ------------------
 * Le strict minimum d'outillage DOM. Toutes les sélections sont encapsulées
 * dans un try/catch : un sélecteur invalide (ou un site qui casse en plein
 * chargement) doit produire `null`, jamais lever d'exception au milieu d'un
 * calcul de moyenne.
 */
(() => {
  const EDP = globalThis.EDP;
  const { debounce } = EDP.utils;

  const EDGE_SPACE = /[\s\u00a0]+/g;

  /** querySelector tolérant. */
  function $(selector, root = document) {
    try {
      return root.querySelector(selector);
    } catch (error) {
      return null;
    }
  }

  /** querySelectorAll tolérant, toujours un vrai tableau. */
  function $$(selector, root = document) {
    try {
      return Array.prototype.slice.call(root.querySelectorAll(selector));
    } catch (error) {
      return [];
    }
  }

  /** Texte normalisé d'un nœud (« 15,5/20 » sans espaces parasites). */
  function text(node) {
    if (!node) return '';
    return String(node.textContent || '').replace(EDGE_SPACE, ' ').trim();
  }

  /** Texte normalisé de chaque cellule d'une ligne de tableau. */
  function cellTexts(row) {
    const cells = row && row.querySelectorAll ? row.querySelectorAll('th, td') : [];
    return Array.prototype.map.call(cells, (cell) => text(cell));
  }

  /** Attribut d'un nœud, ou chaîne vide. */
  function attr(node, name) {
    if (!node || !node.getAttribute) return '';
    return node.getAttribute(name) || '';
  }

  /** Tous les attributs d'un nœud, aplatis en texte — utile au diagnostic. */
  function attrBag(node) {
    if (!node || !node.attributes) return '';
    return Array.prototype.map
      .call(node.attributes, (a) => `${a.name}="${a.value}"`)
      .join(' ');
  }

  /** Un élément est-il réellement affiché ? (écarte les blocs cachés) */
  function isVisible(element) {
    if (!element || !element.getBoundingClientRect) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  /** Attend que le document soit prêt (le content script peut arriver avant). */
  function ready() {
    if (document.readyState !== 'loading') return Promise.resolve();
    return new Promise((resolve) => {
      document.addEventListener('DOMContentLoaded', resolve, { once: true });
    });
  }

  /**
   * Attend l'apparition d'un sélecteur. Le site est une application qui remplit
   * ses écrans en Ajax : `document_idle` ne garantit pas que les notes existent.
   * Renvoie null après expiration, sans rejeter la promesse.
   */
  function waitFor(selector, { timeout = 15000, interval = 250 } = {}) {
    const found = $(selector);
    if (found) return Promise.resolve(found);

    return new Promise((resolve) => {
      const started = Date.now();
      const timer = setInterval(() => {
        const element = $(selector);
        if (element) {
          clearInterval(timer);
          resolve(element);
          return;
        }
        if (Date.now() - started > timeout) {
          clearInterval(timer);
          resolve(null);
        }
      }, interval);
    });
  }

  /**
   * Observe les mutations du document et rappelle `callback` de façon groupée.
   * L'observateur est volontairement limité à childList/subtree : observer les
   * attributs sur tout le document coûte cher pour un gain nul ici.
   *
   * `ignore` reçoit chaque nœud muté et, s'il renvoie true, la mutation est
   * écartée. C'est indispensable : nos propres panneaux modifient le DOM, et
   * sans filtre on déclencherait une boucle de recalcul sans fin.
   */
  function onDomChange(callback, { delay = 300, target = null, ignore = null } = {}) {
    const node = target || document.documentElement || document.body;
    if (!node) return () => {};

    const debounced = debounce(callback, delay);
    const observer = new MutationObserver((mutations) => {
      if (ignore) {
        const external = mutations.some((mutation) => {
          try {
            return !ignore(mutation.target);
          } catch (error) {
            return true;
          }
        });
        if (!external) return;
      }
      debounced();
    });
    observer.observe(node, { childList: true, subtree: true });
    return () => observer.disconnect();
  }

  EDP.dom = { $, $$, text, cellTexts, attr, attrBag, isVisible, ready, waitFor, onDomChange };
})();
