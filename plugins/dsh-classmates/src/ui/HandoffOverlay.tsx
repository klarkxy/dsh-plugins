import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useModalLayer } from '@deepseek-ai/dsh-client-ui-primitives';
import type { HandoffGate, HandoffPhase } from './handoff.js';

export interface HandoffOverlayProps {
  open: boolean;
  title: string;
  cancelLabel: string;
  onCancel: () => void;
  cancellable?: boolean;
}

const overlayCss = `
.cmt-handoffMask {
  position: fixed;
  inset: 0;
  z-index: 2147483646;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: color-mix(in srgb, var(--dsw-alias-bg-base, #111) 62%, transparent);
}
.cmt-handoffDialog {
  box-sizing: border-box;
  width: min(360px, 100%);
  padding: 18px 16px 14px;
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-base, #fff));
  color: var(--dsw-alias-label-primary, #1c1f24);
  box-shadow: var(--dsw-elevation-prominent, 0 12px 40px rgba(0, 0, 0, 0.28));
}
.cmt-handoffDialog p {
  margin: 0 0 14px;
  font-size: 14px;
  line-height: 1.5;
}
.cmt-handoffDialog button {
  appearance: none;
  min-height: 36px;
  padding: 8px 12px;
  border: 1px solid var(--dsw-alias-border-l, #d3d7dd);
  border-radius: 8px;
  background: var(--dsw-alias-bg-base, #fff);
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.cmt-handoffDialog button:hover,
.cmt-handoffDialog button:focus-visible {
  background: var(--dsw-alias-interactive-bg-hover, rgba(15, 23, 42, 0.05));
}
`;

/** Blocks the old composer until the official main view owns the target session. */
export function HandoffOverlay({
  open,
  title,
  cancelLabel,
  onCancel,
  cancellable = true,
}: HandoffOverlayProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalLayer(dialogRef, open, cancellable ? onCancel : () => {});
  if (!open) return null;
  return createPortal(
    <div className="cmt-handoffMask" data-classmates-handoff="true">
      <style>{overlayCss}</style>
      <div
        ref={dialogRef}
        className="cmt-handoffDialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="classmates-handoff-title"
        tabIndex={-1}
      >
        <p id="classmates-handoff-title">{title}</p>
        {cancellable && (
          <button type="button" data-modal-autofocus onClick={onCancel}>{cancelLabel}</button>
        )}
      </div>
    </div>,
    document.body,
  );
}

const PHASE_TITLE: Record<Exclude<HandoffPhase, 'idle'>, string> = {
  task: '正在打开任务会话…',
};

const COMMITTED_TITLE = '正在切换会话…';

/** Root-owned overlay so a session switch cannot uncover the previous composer. */
export function HandoffOverlayRoot({ gate }: { gate: HandoffGate }) {
  const [snapshot, setSnapshot] = useState(gate.snapshot);
  useEffect(() => gate.subscribe(() => {
    setSnapshot(gate.snapshot);
  }), [gate]);
  const open = snapshot.busy && snapshot.phase !== 'idle';
  const title = snapshot.phase === 'idle'
    ? ''
    : snapshot.cancellable ? PHASE_TITLE[snapshot.phase] : COMMITTED_TITLE;
  return (
    <HandoffOverlay
      open={open}
      title={title}
      cancelLabel="取消"
      onCancel={() => gate.cancel()}
      cancellable={snapshot.cancellable}
    />
  );
}
