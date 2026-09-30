import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, useModalLayer } from '@deepseek-ai/dsh-client-ui-primitives';
import { officialUiCss } from '@klarkxy/dsh-plugin-kit/official-ui';
import type { HandoffGate, HandoffPhase } from './handoff.js';
import { useLocaleId, type LocaleSource } from './hooks.js';
import { createPageTranslator, type PageKey } from './page-locales.js';

export interface HandoffOverlayProps {
  open: boolean;
  title: string;
  cancelLabel: string;
  onCancel: () => void;
  cancellable?: boolean;
}

/**
 * The handoff mask is a blocking modal: it keeps the platform `<div
 * role="dialog">` so the existing aria wiring and the `data-modal-autofocus`
 * hook stay exactly as they were, and styles it from the host's own tokens.
 * The cancel action is the `Button` primitive rather than a styled <button>.
 */
const overlayCss = `${officialUiCss('cmt-handoff')}
.cmt-handoff .cmt-handoffMask {
  position: fixed;
  inset: 0;
  /* Literal on purpose: the host publishes no --dsw-* z-index token
   * (OFFICIAL_THEME_TOKEN_NAMES has none); this sits just under the int32 max
   * so the mask covers every host layer during the session switch. */
  z-index: 2147483646;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: color-mix(in srgb, var(--dsw-alias-bg-base) 62%, transparent);
}
.cmt-handoff .cmt-handoffDialog {
  box-sizing: border-box;
  width: min(360px, 100%);
  padding: 18px 16px 14px;
  border: 0;
  border-radius: var(--dsw-radius-panel);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  box-shadow: var(--dsw-elevation-prominent);
}
.cmt-handoff .cmt-handoffDialog p { margin: 0 0 14px; }
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
    <div className="cmt-handoff cmt-handoffMask" data-classmates-handoff="true">
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
          <div className="dsh-ui-actions dsh-ui-actions-end">
            <Button variant="outline" type="button" data-modal-autofocus onClick={onCancel}>
              {cancelLabel}
            </Button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

const PHASE_TITLE_KEY: Record<Exclude<HandoffPhase, 'idle'>, PageKey> = {
  task: 'handoff.task',
};

/** Root-owned overlay so a session switch cannot uncover the previous composer. */
export function HandoffOverlayRoot({ gate, locale }: { gate: HandoffGate; locale?: LocaleSource }) {
  const localeId = useLocaleId(locale);
  const t = useMemo(() => createPageTranslator(localeId), [localeId]);
  const [snapshot, setSnapshot] = useState(gate.snapshot);
  useEffect(() => gate.subscribe(() => {
    setSnapshot(gate.snapshot);
  }), [gate]);
  const open = snapshot.busy && snapshot.phase !== 'idle';
  const title = snapshot.phase === 'idle'
    ? ''
    : t(snapshot.cancellable ? PHASE_TITLE_KEY[snapshot.phase] : 'handoff.committed');
  return (
    <HandoffOverlay
      open={open}
      title={title}
      cancelLabel={t('common.cancel')}
      onCancel={() => gate.cancel()}
      cancellable={snapshot.cancellable}
    />
  );
}
