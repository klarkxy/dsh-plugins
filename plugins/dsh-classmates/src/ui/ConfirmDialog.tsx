import { useCallback, useRef, useState, type ReactNode } from 'react';
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives';
import { officialUiCss } from '@klarkxy/dsh-plugin-kit/official-ui';
import type { PageTranslate } from './page-locales.js';

/**
 * The Modal portals to document.body, outside the `.classmates` subtree, so
 * the dialog body carries its own root class and contract stylesheet.
 */
const dialogCss = `${officialUiCss('classmates-dialog')}
.classmates-dialog .classmates-button--danger { color: var(--dsw-alias-state-error-primary); }
`;

export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel: string;
}

interface Pending extends ConfirmRequest {
  resolve(ok: boolean): void;
}

/**
 * Host-Modal replacement for window.confirm. `confirm()` resolves true only
 * when the destructive action is chosen; Escape, mask click, close and Cancel
 * all resolve false.
 */
export function useConfirmDialog(t: PageTranslate): [ReactNode, (request: ConfirmRequest) => Promise<boolean>] {
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);

  const settle = useCallback((ok: boolean) => {
    const current = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    current?.resolve(ok);
  }, []);

  const confirm = useCallback((request: ConfirmRequest) => new Promise<boolean>(resolve => {
    // A second request supersedes an unanswered one, which counts as cancelled.
    pendingRef.current?.resolve(false);
    const next = { ...request, resolve };
    pendingRef.current = next;
    setPending(next);
  }), []);

  const element = (
    <Modal
      open={pending !== null}
      onClose={() => settle(false)}
      title={pending?.title ?? ''}
      closeLabel={t('common.close')}
    >
      <div className="classmates-dialog dsh-ui-stack">
        <style>{dialogCss}</style>
        <p className="dsh-ui-wrap">{pending?.message}</p>
        <div className="dsh-ui-actions dsh-ui-actions-end">
          <Button variant="outline" type="button" data-modal-autofocus onClick={() => settle(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="outline"
            type="button"
            className="classmates-button--danger"
            onClick={() => settle(true)}
          >
            {pending?.confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
  return [element, confirm];
}
