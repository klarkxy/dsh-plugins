import { Button, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { Fragment, useEffect, useId, useRef, useState } from 'react'
import type { ShortcutCatalogEntry } from '@deepseek-ai/dsh-client-shortcuts/client'
import type { CommandPaletteSnapshot } from './contracts.ts'
import type { SelectorHook } from './settings.tsx'
import { SHORTCUTS_STYLES } from './styles.ts'

export interface PaletteProps {
  usePalette: SelectorHook<CommandPaletteSnapshot>
  useCatalog: SelectorHook<readonly ShortcutCatalogEntry[]>
  locale: 'zh' | 'en'
  close(): void
  execute(id: ShortcutCatalogEntry['id']): Promise<boolean>
  clearError(): void
  openSettings(): void
}

export function CommandPalettePanel(props: PaletteProps) {
  const state = props.usePalette(value => value)
  const catalog = props.useCatalog(value => value)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const listId = useId()
  const zh = props.locale === 'zh'
  const rows = state.commands.map(command => ({ command, row: catalog.find(row => row.id === command.id) }))
    .filter(({ command, row }) => `${row?.label ?? command.label()} ${command.aliases.join(' ')} ${command.id} ${row?.keys.join(' ') ?? ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const index = Math.min(selected, Math.max(0, rows.length - 1))
  useEffect(() => { if (state.open) { setQuery(''); setSelected(0); input.current?.focus() } }, [state.open])
  useEffect(() => { if (state.open) document.getElementById(`${listId}-${index}`)?.scrollIntoView?.({ block: 'nearest' }) }, [index, state.open, listId])
  return <>
    <Modal open={state.open} onClose={props.close} title={zh ? '快捷命令' : 'Command palette'} closeLabel={zh ? '关闭' : 'Close'} className="shortcuts-root" contentClassName="shortcuts-palette"
      footer={<div className="shortcuts-palette-footer">
        <span className="shortcuts-keys dsh-ui-hint" aria-hidden="true">
          <kbd className="shortcuts-key">↑</kbd>
          <kbd className="shortcuts-key">↓</kbd>
          <kbd className="shortcuts-key">Enter</kbd>
          <kbd className="shortcuts-key">Esc</kbd>
        </span>
        <Button variant="outline" size="sm" onClick={props.openSettings}>{zh ? '查看与修改全部快捷键' : 'View and edit all shortcuts'}</Button>
      </div>}>
      <style>{SHORTCUTS_STYLES}</style>
      <Input ref={input} data-modal-autofocus value={query} placeholder={zh ? '搜索插件命令…' : 'Search plugin commands…'}
        className="dsh-ui-control"
        role="combobox" aria-label={zh ? '搜索命令' : 'Search commands'} aria-expanded={state.open} aria-controls={listId}
        aria-autocomplete="list" aria-activedescendant={rows.length ? `${listId}-${index}` : undefined}
        onChange={event => { setQuery(event.target.value); setSelected(0) }}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault(); setSelected(rows.length ? (index + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length : 0)
          } else if (event.key === 'Enter' && rows[index]) {
            event.preventDefault(); if (!event.repeat) void props.execute(rows[index]!.command.id)
          } else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); props.close() }
        }} />
      {state.error && <div role="alert" className="dsh-ui-banner dsh-ui-banner--danger"><p>{state.error}</p></div>}
      <div id={listId} role="listbox" aria-label={zh ? '可执行命令' : 'Executable commands'} className="shortcuts-command-list">
        {rows.map(({ command, row }, rowIndex) => <div key={command.id} id={`${listId}-${rowIndex}`} role="option" aria-selected={index === rowIndex}>
          <Button tabIndex={-1} className="shortcuts-command" onMouseEnter={() => setSelected(rowIndex)} onClick={() => void props.execute(command.id)}>
            <span className="shortcuts-command-main">
              <span className="shortcuts-command-label">{row?.label ?? command.label()}</span>
            </span>
            {row?.keys.length ? <span className="shortcuts-keys shortcuts-palette-keys">
              {row.keys.map((key, keyIndex) => <Fragment key={keyIndex}>
                {keyIndex > 0 ? ' ' : null}
                {key === '+' ? <span className="shortcuts-key-sep" aria-hidden="true">+</span> : <kbd className="shortcuts-key">{key}</kbd>}
              </Fragment>)}
            </span> : null}
          </Button>
        </div>)}
      </div>
      {!rows.length && <p className="dsh-ui-empty">{zh ? '没有匹配的插件命令。其他插件注册后会自动出现在这里。' : 'No matching plugin commands. Commands appear here when another plugin registers them.'}</p>}
    </Modal>
    {!state.open && state.error && <div className="shortcuts-root shortcuts-error" role="alert"><span>{state.error}</span><Button variant="outline" size="sm" onClick={props.clearError}>{zh ? '关闭' : 'Dismiss'}</Button></div>}
  </>
}
