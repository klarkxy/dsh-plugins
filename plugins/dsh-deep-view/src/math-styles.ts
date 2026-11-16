// Minimal Mafs structural styles, themed to the host. Kept separate from the
// lazy Mafs runtime so ordinary messages do not load the component library.
export const mathStyles = `
.dvui-root .dvui-math { margin: 0; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
.dvui-root .dvui-math-plot { min-width: 0; --mafs-bg: transparent; --mafs-fg: var(--dsw-alias-label-primary); --mafs-origin-color: var(--dsw-alias-border-l3); --mafs-line-color: var(--dsw-alias-border-l1); --mafs-axis-stroke-width: 1px; --grid-line-subdivision-color: var(--dsw-alias-border-l1); --mafs-line-stroke-dash-style: 4, 3; --mafs-pink: var(--dsw-alias-state-business-primary); }
.dvui-root .dvui-math-plot .MafsView { background: transparent; font-family: inherit; font-variant-numeric: tabular-nums; }
.dvui-root .dvui-math-plot .MafsView text { font-size: 12px; }
.dvui-root .dvui-math-plot .MafsView:focus-visible { outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 2px; border-radius: var(--dsw-radius-sm); }
.dvui-root .dvui-math-plot .mafs-movable-point { cursor: grab; touch-action: none; }
.dvui-root .dvui-math-plot .mafs-movable-point-dragging { cursor: grabbing; }
.dvui-root .dvui-math-plot .mafs-movable-point:focus { outline: 0; }
.dvui-root .dvui-math-plot .mafs-movable-point * { fill: none; stroke: none; }
.dvui-root .dvui-math-plot .mafs-movable-point-hitbox { fill: transparent; }
.dvui-root .dvui-math-plot .mafs-movable-point-focus { stroke: var(--movable-point-color); stroke-width: 2; stroke-opacity: 0; fill: none; transition: stroke-opacity .2s ease; }
.dvui-root .dvui-math-plot .mafs-movable-point:focus-visible .mafs-movable-point-focus { stroke-opacity: 1; }
.dvui-root .dvui-math-plot .mafs-movable-point-ring { fill: var(--movable-point-color); fill-opacity: .25; stroke: none; transition: r .2s ease; }
.dvui-root .dvui-math-plot .mafs-movable-point-point { fill: var(--movable-point-color); transition: r .2s ease; }
.dvui-root .dvui-math-plot .mafs-movable-point:hover .mafs-movable-point-point,.dvui-root .dvui-math-plot .mafs-movable-point:focus-visible .mafs-movable-point-point { r: calc(var(--movable-point-ring-size) - 2px); }
.dvui-root .dvui-math-plot .mafs-movable-point:hover .mafs-movable-point-ring,.dvui-root .dvui-math-plot .mafs-movable-point:focus-visible .mafs-movable-point-ring { r: calc(var(--movable-point-ring-size) + 3px); }
.dvui-root .dvui-math-plot .mafs-movable-point-dragging .mafs-movable-point-ring { r: var(--movable-point-ring-size); }
.dvui-root .dvui-math-readout { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
.dvui-root .dvui-math-readout i { flex: none; display: inline-block; width: 8px; height: 8px; margin-right: 6px; border-radius: 50%; }
`
