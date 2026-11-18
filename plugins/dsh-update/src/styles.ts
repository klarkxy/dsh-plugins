import { officialUiCss } from '@klarkxy/dsh-plugin-kit/official-ui'

export const dshUpdateClientStyles = `
${officialUiCss('.dsh-upd-root')}

.dsh-upd-root {
  & .dsh-upd-modal-body {
    display: flex;
    flex-direction: column;
    gap: 14px;
    max-height: min(68vh, 620px);
    overflow-y: auto;
    padding-right: 2px;
  }

  & .dsh-upd-version-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 10px;
    padding: 10px 14px;
    border: 0.5px solid var(--dsw-alias-border-l3);
    border-radius: var(--dsw-radius-md);
    background: var(--dsw-alias-bg-layer-2);
  }

  & .dsh-upd-version-pair {
    display: inline-flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    font-size: 13px;
    line-height: 20px;
    color: var(--dsw-alias-label-primary);
  }

  & .dsh-upd-version-code {
    font-family: var(--ds-font-family-code);
    font-size: 12px;
    line-height: 18px;
    padding: 2px 8px;
    border-radius: var(--dsw-radius-sm);
    border: 0.5px solid var(--dsw-alias-border-l3);
    background: var(--dsw-alias-bg-layer-1);
    color: var(--dsw-alias-label-primary);
  }

  & .dsh-upd-version-code--target {
    border-color: var(--dsw-alias-state-business-primary);
    color: var(--dsw-alias-brand-primary);
    font-weight: 600;
  }

  & .dsh-upd-arrow {
    color: var(--dsw-alias-label-tertiary);
    font-size: 13px;
  }

  & .dsh-upd-release-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  & .dsh-upd-release-card {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px 14px;
    border: 0.5px solid var(--dsw-alias-border-l3);
    border-radius: var(--dsw-radius-lg);
    background: var(--dsw-alias-bg-layer-1);
  }

  & .dsh-upd-release-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 8px;
    padding-bottom: 8px;
    border-bottom: 0.5px solid var(--dsw-alias-border-l2);
  }

  & .dsh-upd-release-title-group {
    display: inline-flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    min-width: 0;
  }

  & .dsh-upd-release-title {
    font-size: 14px;
    line-height: 20px;
    font-weight: 600;
    color: var(--dsw-alias-label-primary);
  }

  & .dsh-upd-release-date {
    font-size: 12px;
    line-height: 18px;
    color: var(--dsw-alias-label-tertiary);
  }

  & .dsh-upd-markdown {
    font-size: 13px;
    line-height: 20px;
    color: var(--dsw-alias-label-primary);
    min-width: 0;
    overflow-x: auto;
  }

  & .dsh-upd-link {
    font-size: 12px;
    line-height: 18px;
    color: var(--dsw-alias-brand-primary);
    text-decoration: underline;
  }

  & .dsh-upd-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 10px;
    width: 100%;
  }

  & .dsh-upd-footer-actions {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    margin-left: auto;
  }

  & .dsh-upd-diagnostic {
    margin: 0;
    padding: 8px 10px;
    border-radius: var(--dsw-radius-md);
    border: 0.5px solid var(--dsw-alias-border-l3);
    background: var(--dsw-alias-bg-layer-2);
    font-family: var(--ds-font-family-code);
    font-size: 12px;
    line-height: 18px;
    color: var(--dsw-alias-label-secondary);
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 160px;
    overflow-y: auto;
  }

  & .dsh-upd-tab-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 10px;
  }

  & .dsh-upd-plugin-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  & .dsh-upd-plugin-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 14px;
    padding: 12px 16px;
    border: 0.5px solid var(--dsw-alias-border-l3);
    border-radius: var(--dsw-radius-lg);
    background: var(--dsw-alias-bg-layer-1);
  }

  & .dsh-upd-plugin-main {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
    flex: 1;
  }

  & .dsh-upd-plugin-head {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }

  & .dsh-upd-plugin-pkg {
    font-family: var(--ds-font-family-code);
    font-size: 12px;
    line-height: 18px;
    color: var(--dsw-alias-label-tertiary);
  }

  & .dsh-upd-plugin-actions {
    display: inline-flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    flex-shrink: 0;
  }

  & .dsh-upd-inline-slot {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  @media (width < 640px) {
    & .dsh-upd-plugin-row {
      flex-direction: column;
    }
    & .dsh-upd-plugin-actions {
      width: 100%;
      justify-content: flex-end;
    }
  }
}
`
