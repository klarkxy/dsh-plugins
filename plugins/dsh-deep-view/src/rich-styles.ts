export const richStyles = `
.dvui-root .dvui-flow { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.dvui-root .dvui-flow-canvas { min-width: 0; overflow: hidden; border: .5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-base); }
.dvui-root .dvui-flow-canvas .react-flow,.dvui-root .dvui-flow-canvas .react-flow.dark {
  --xy-edge-stroke-default: var(--dsw-alias-border-l4);
  --xy-edge-stroke-selected-default: var(--dsw-alias-state-business-primary);
  --xy-attribution-background-color-default: var(--dsw-alias-bg-base);
  --xy-minimap-background-color-default: var(--dsw-alias-bg-layer-1);
  --xy-minimap-mask-background-color-default: var(--dsw-alias-bg-layer-2);
  --xy-minimap-mask-stroke-color-default: var(--dsw-alias-border-l2);
  --xy-minimap-node-background-color-default: var(--dsw-alias-border-l3);
  --xy-background-pattern-dots-color-default: var(--dsw-alias-border-l2);
  --xy-node-color-default: var(--dsw-alias-label-primary);
  --xy-node-border-default: .5px solid var(--dsw-alias-border-l3);
  --xy-node-background-color-default: var(--dsw-alias-bg-layer-1);
  --xy-node-border-radius-default: var(--dsw-radius-md);
  --xy-handle-background-color-default: var(--dsw-alias-border-l2);
  --xy-handle-border-color-default: var(--dsw-alias-border-l2);
  --xy-controls-button-background-color-default: var(--dsw-alias-bg-layer-1);
  --xy-controls-button-background-color-hover-default: var(--dsw-alias-interactive-bg-hover);
  --xy-controls-button-color-default: var(--dsw-alias-label-secondary);
  --xy-controls-button-border-color-default: var(--dsw-alias-border-l2);
  --xy-edge-label-background-color-default: var(--dsw-alias-bg-layer-2);
  --xy-edge-label-color-default: var(--dsw-alias-label-secondary);
  color: var(--dsw-alias-label-primary);
}
.dvui-root .dvui-flow-canvas .react-flow__node { min-width: 124px; max-width: 216px; width: auto; font-family: inherit; box-shadow: var(--dsw-elevation-soft); }
.dvui-root .dvui-flow-canvas .react-flow__node.selected { border-color: var(--dsw-alias-state-business-primary); box-shadow: var(--dsw-elevation-panel); }
.dvui-root .dvui-flow-canvas .react-flow__handle { width: 1px; height: 1px; min-width: 0; min-height: 0; opacity: 0; pointer-events: none; }
.dvui-root .dvui-flow-node-body { display: flex; flex-direction: column; gap: 3px; padding: 9px 14px; border-radius: var(--dsw-radius-md); }
.dvui-root .dvui-flow-node-label { font-size: 13px; line-height: 18px; font-weight: 600; overflow-wrap: anywhere; }
.dvui-root .dvui-flow-node-detail { font-size: 12px; line-height: 16px; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
.dvui-root .dvui-flow-canvas .react-flow__node.dvui-flow-tone-accent { border-color: var(--dsw-alias-state-business-primary); border-left-width: 3px; }
.dvui-root .dvui-flow-canvas .react-flow__node.dvui-flow-tone-success { border-color: var(--dsw-alias-state-success-primary); border-left-width: 3px; }
.dvui-root .dvui-flow-canvas .react-flow__node.dvui-flow-tone-warn { border-color: var(--dsw-alias-state-warn-primary); border-left-width: 3px; }
.dvui-root .dvui-flow-canvas .react-flow__node.dvui-flow-tone-bad { border-color: var(--dsw-alias-state-error-primary); border-left-width: 3px; }
.dvui-root .dvui-flow-canvas .react-flow__edge-textbg { rx: 4; ry: 4; }
.dvui-root .dvui-flow-selection { min-height: 22px; font-size: 12px; line-height: 18px; padding: 2px 2px 0; }
.dvui-root .dvui-flow-hint { color: var(--dsw-alias-label-tertiary); }
.dvui-root .dvui-flow-detail { display: flex; flex-direction: column; gap: 2px; padding: 8px 12px; border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-2); }
.dvui-root .dvui-flow-detail-label { font-size: 13px; line-height: 20px; font-weight: 600; }
.dvui-root .dvui-flow-detail-text { color: var(--dsw-alias-label-secondary); }
.dvui-root .dvui-flow-detail[data-tone=accent] .dvui-flow-detail-label { color: var(--dsw-alias-state-business-primary); }
.dvui-root .dvui-flow-detail[data-tone=success] .dvui-flow-detail-label { color: var(--dsw-alias-state-success-primary); }
.dvui-root .dvui-flow-detail[data-tone=warn] .dvui-flow-detail-label { color: var(--dsw-alias-state-warn-primary); }
.dvui-root .dvui-flow-detail[data-tone=bad] .dvui-flow-detail-label { color: var(--dsw-alias-state-error-primary); }
.dvui-root .dvui-flow-canvas .react-flow__minimap { width: 96px; height: 64px; }
.dvui-root .dvui-flow-canvas .react-flow__attribution { font-size: 10px; opacity: .55; color: var(--dsw-alias-label-tertiary); }
.dvui-root .dvui-explore { min-width: 0; display: flex; flex-direction: column; gap: 8px; margin: 0; }
.dvui-root .dvui-explore-host { min-width: 0; padding: 8px; border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-base); border: .5px solid var(--dsw-alias-border-l2); }
.dvui-root .dvui-explore details > summary { cursor: pointer; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.dvui-root .dvui-explore .vega-embed { width: 100%; }
.dvui-root .dvui-explore .vega-embed svg { max-width: 100%; height: auto; }
.dvui-root .dvui-map { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.dvui-root .dvui-map-frame { position: relative; height: 280px; min-height: 180px; overflow: hidden; border: .5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-base); }
.dvui-root .dvui-map-host { position: absolute; inset: 0; }
.dvui-root .dvui-map .maplibregl-map { font-family: inherit; }
.dvui-root .dvui-map .maplibregl-ctrl-group { background: var(--dsw-alias-bg-layer-1); box-shadow: var(--dsw-elevation-stroke); }
.dvui-root .dvui-map .maplibregl-ctrl-group button { color: var(--dsw-alias-label-primary); }
.dvui-root .dvui-map .maplibregl-ctrl-attrib { background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-tertiary); }
.dvui-root .dvui-map-pin { display: block; width: 16px; height: 16px; padding: 0; border: 2px solid var(--dsw-alias-bg-base); border-radius: 50%; background: var(--dsw-alias-state-business-primary); box-shadow: var(--dsw-elevation-panel); cursor: pointer; }
.dvui-root .dvui-map-pin[aria-pressed=true] { background: var(--dsw-alias-state-success-primary); transform: scale(1.18); }
.dvui-root .dvui-map-pin:focus-visible,.dvui-root .dvui-map-location:focus-visible { outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 2px; }
.dvui-root .dvui-map-notice { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; padding: 16px; text-align: center; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary); pointer-events: none; }
.dvui-root .dvui-map-notice small { color: var(--dsw-alias-label-tertiary); }
.dvui-root .dvui-map-detail { display: flex; flex-direction: column; gap: 2px; min-width: 0; padding: 8px 12px; border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-2); font-size: 13px; line-height: 20px; }
.dvui-root .dvui-map-detail > span:first-child { font-weight: 600; }
.dvui-root .dvui-map-detail > span + span { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.dvui-root .dvui-map-locations { display: flex; flex-wrap: wrap; gap: 6px; }
.dvui-root .dvui-map-location { padding: 4px 11px; font: inherit; font-size: 12px; line-height: 20px; cursor: pointer; color: var(--dsw-alias-label-primary); border: .5px solid var(--dsw-alias-border-l3); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-base); }
.dvui-root .dvui-map-location[aria-pressed=true] { border-color: var(--dsw-alias-state-business-primary); background: var(--dsw-alias-interactive-bg-active); font-weight: 600; }
.dvui-root .dvui-map-location:hover { background: var(--dsw-alias-interactive-bg-hover); }
`
