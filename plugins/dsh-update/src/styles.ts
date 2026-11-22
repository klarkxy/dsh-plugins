import { officialUiCss } from '@klarkxy/dsh-plugin-kit/official-ui'

export const dshUpdateClientStyles = `
${officialUiCss('dsh-upd-root')}

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
    gap: 12px;
    margin-top: 8px;
  }

  & .dsh-upd-toolbar-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: min(100%, 360px);
  }

  & .dsh-upd-search {
    flex: 1;
    min-width: 160px;
  }

  & .dsh-upd-core-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 4px 16px;
    padding: 14px 16px;
    border: 0.5px solid var(--dsw-alias-border-l2);
    border-radius: var(--dsw-radius-md);
    background: var(--dsw-alias-bg-layer-1);
  }

  & .dsh-upd-core-main {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    min-width: 0;
  }

  & .dsh-upd-core-title {
    font-size: 14px;
    line-height: 20px;
    color: var(--dsw-alias-label-primary);
  }

  & .dsh-upd-core-row > .dsh-upd-plugin-release {
    grid-column: 1;
  }

  & .dsh-upd-core-row > .dsh-upd-plugin-actions {
    grid-column: 2;
    grid-row: 1 / span 2;
  }

  & .dsh-upd-plugin-list {
    display: flex;
    flex-direction: column;
    container-type: inline-size;
    border-top: 0.5px solid var(--dsw-alias-border-l2);
    border-bottom: 0.5px solid var(--dsw-alias-border-l2);
  }

  & .dsh-upd-plugin-row {
    position: relative;
    display: grid;
    grid-template-columns: minmax(220px, 1fr) auto auto;
    align-items: center;
    gap: 12px 20px;
    padding: 13px 12px 13px 14px;
    border-radius: var(--dsw-radius-sm);
    content-visibility: auto;
    contain-intrinsic-size: auto 66px;
  }

  & .dsh-upd-plugin-row + .dsh-upd-plugin-row::before {
    content: '';
    position: absolute;
    top: 0;
    left: 14px;
    right: 12px;
    border-top: 0.5px solid var(--dsw-alias-border-l2);
  }

  & .dsh-upd-plugin-row--update {
    background: var(--dsw-alias-bg-layer-1);
  }

  & .dsh-upd-plugin-main {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  & .dsh-upd-plugin-head {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
  }

  & .dsh-upd-plugin-title {
    flex-shrink: 0;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  & .dsh-upd-plugin-pkg {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11px;
    line-height: 18px;
    color: var(--dsw-alias-label-tertiary);
  }

  & .dsh-upd-plugin-description {
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  & .dsh-upd-plugin-release {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 136px;
    font-size: 12px;
    color: var(--dsw-alias-label-secondary);
  }

  & .dsh-upd-row-version {
    font-family: var(--ds-font-family-code);
    font-size: 12px;
    line-height: 18px;
    white-space: nowrap;
  }

  & .dsh-upd-row-version--target {
    color: var(--dsw-alias-brand-primary);
    font-weight: 600;
  }

  & .dsh-upd-status {
    margin-left: 4px;
    white-space: nowrap;
    font-size: 11px;
    line-height: 18px;
    color: var(--dsw-alias-label-tertiary);
  }

  & .dsh-upd-status--update {
    color: var(--dsw-alias-brand-primary);
    font-weight: 500;
  }

  & .dsh-upd-plugin-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 2px;
    flex-shrink: 0;
  }

  & .dsh-upd-inline-slot {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  /* The host can narrow the list independently of the viewport. */
  @container (width < 960px) {
    & .dsh-upd-plugin-row {
      grid-template-columns: minmax(180px, 1fr) auto;
      gap: 6px 12px;
    }
    & .dsh-upd-plugin-actions {
      grid-column: 1 / -1;
    }
  }

  @media (width < 640px) {
    & .dsh-upd-tab-toolbar,
    & .dsh-upd-toolbar-actions {
      align-items: stretch;
      width: 100%;
    }
    & .dsh-upd-toolbar-actions {
      flex-wrap: wrap;
    }
    & .dsh-upd-core-row {
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 6px 12px;
    }
    & .dsh-upd-core-row > .dsh-upd-plugin-actions {
      grid-column: 1 / -1;
      grid-row: auto;
    }
    & .dsh-upd-plugin-row {
      grid-template-columns: minmax(0, 1fr);
      padding: 12px;
    }
    & .dsh-upd-plugin-release,
    & .dsh-upd-plugin-actions {
      grid-column: 1;
    }
    & .dsh-upd-plugin-actions {
      justify-content: flex-start;
    }
    & .dsh-upd-plugin-description {
      white-space: normal;
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
    }
  }
}
`
