// dsh-context-cleaner client half.
//
// dsh-context renders two decoration cards in the right column of the top
// header row (.lc-cols.lc-head > .lc-col) on its dashboard:
//   - "Plugin Info" (.lc-card containing .lc-pi-grid; the only card without a
//     dedicated root class)
//   - the promotion card (a.lc-card.lc-recom, remote recommendations with a
//     bundled deepseek-platform fallback)
// The upstream Config schema exposes no switch for either card, so this module
// hides them with a scoped stylesheet. .lc-root only appears on dsh-context
// surfaces (dashboard / fleet); its settings layer uses .lc-modal-card, so the
// rule cannot reach the plugin's own settings or the host UI. The selectors
// and the lc-* class names are dsh-context implementation details verified
// against 0.82.2 (see peerDependencies).
window.__ModuleLoader__.load({
  id: '@klarkxy/dsh-context-cleaner',
  factory() {
    return {
      apply(ctx) {
        ctx.effect(() => {
          if (typeof document === 'undefined') return;
          const tag = document.createElement('style');
          // The Host removes a package's styles by its owner id, which is the
          // registration id minus a '/client' suffix. The tag must carry the
          // package name, not a short alias, or an unload leaves it behind.
          tag.dataset.plugin = '@klarkxy/dsh-context-cleaner';
          tag.dataset.pluginCss = 'dsh-context-cleaner/hide-cards.css';
          // Collapse the header column that wraps both cards. The sibling
          // stats card is a flex item (.lc-head > .lc-card:has(.lc-stats)) and
          // grows to fill the row, so no empty shell is left behind.
          tag.textContent =
            '.lc-root > .lc-cols.lc-head > .lc-col:has(.lc-pi-grid, .lc-recom) { display: none; }';
          document.head.appendChild(tag);
          return () => tag.remove();
        }, 'dsh-context-cleaner: hide cards');
      },
    };
  },
});
