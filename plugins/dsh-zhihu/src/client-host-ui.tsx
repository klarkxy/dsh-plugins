import { forwardRef, useCallback, useState, type ChangeEvent, type ComponentType, type KeyboardEvent, type MouseEvent, type ReactNode, type Ref } from 'react';
import { Button, DisclosureRow, IconChecklistOutlineRegular, Input as OfficialInput, type ButtonVariant } from '@deepseek-ai/dsh-client-ui-primitives';

/**
 * Folded fine print: one concise sentence stays in the flow, the detail list
 * sits behind the host disclosure row. Children are `<li>` items.
 */
export function ZhihuDetails(props: { title: string; children: ReactNode; testId?: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(props.defaultOpen === true)
  const toggle = useCallback(() => setOpen(value => !value), [])
  return (
    <div className="zhihu-guide" data-testid={props.testId}>
      <DisclosureRow icon={<IconChecklistOutlineRegular />} title={props.title} open={open} expandable expandOnRowClick onToggle={toggle}>
        <ul className="zhihu-guide-list dsh-ui-help">{props.children}</ul>
      </DisclosureRow>
    </div>
  )
}

/** Structural host Select — no private package import. */
export type HostSelectProps = {
  value: string
  options: readonly { value: string; label: string }[]
  onChange(value: string): void
  disabled?: boolean
  'aria-label': string
  placeholder?: string
  /** Lets a visible `<label htmlFor>` name the control. */
  id?: string
}

/** Structural host Button — no private package import. */
export type HostButtonProps = {
  type?: 'button' | 'submit'
  variant?: 'default' | 'primary' | 'danger' | 'icon'
  className?: string
  disabled?: boolean
  title?: string
  onClick?(event: MouseEvent<HTMLButtonElement>): void
  'aria-label'?: string
  'aria-labelledby'?: string
  'aria-controls'?: string
  'aria-describedby'?: string
  'aria-current'?: boolean | 'page' | 'step' | 'location' | 'date' | 'time'
  'aria-pressed'?: boolean
  'aria-expanded'?: boolean
  'aria-selected'?: boolean
  'aria-checked'?: boolean
  'data-testid'?: string
  role?: string
  tabIndex?: number
  children?: ReactNode
}

/** Structural host Input — no private package import. */
export type HostInputProps = {
  value: string
  onChange(value: string): void
  disabled?: boolean
  maxLength?: number
  placeholder?: string
  type?: 'text' | 'search' | 'password'
  'aria-label'?: string
  'aria-describedby'?: string
  autoFocus?: boolean
  className?: string
  'data-testid'?: string
  onKeyDown?(event: KeyboardEvent<HTMLInputElement>): void
}

/** Structural host Dialog — no private package import. */
export type HostDialogProps = {
  open: boolean
  onOpenChange(open: boolean): void
  title: string
  description?: string
  children?: ReactNode
  className?: string
  overlayClassName?: string
  dismissible?: boolean
  initialFocusRef?: { current: HTMLElement | null }
}

export type HostSelect = ComponentType<HostSelectProps>
export type HostButton = ComponentType<HostButtonProps>
export type HostDialog = ComponentType<HostDialogProps>
export type HostInput = ComponentType<HostInputProps>

export const IME_KEYCODE = 229

export type NativeKeyish = { isComposing?: boolean; keyCode?: number }

/** React KeyboardEvent: isComposing/keyCode live on nativeEvent, not the synthetic event. */
export function nativeKeyFlags(event: { nativeEvent?: NativeKeyish }): { isComposing: boolean; keyCode: number } {
  const native = event.nativeEvent
  return {
    isComposing: Boolean(native?.isComposing),
    keyCode: typeof native?.keyCode === 'number' ? native.keyCode : 0,
  }
}

export function guardImeEnter(event: {
  key?: string
  preventDefault(): void
  nativeEvent?: NativeKeyish
}): boolean {
  const { isComposing, keyCode } = nativeKeyFlags(event)
  const enter = event.key === 'Enter' || keyCode === 13
  const ime = (isComposing && enter) || keyCode === IME_KEYCODE
  if (!ime) return false
  if (enter) event.preventDefault()
  return true
}

export function zhihuQueryKeyDown(
  event: {
    key?: string
    preventDefault(): void
    nativeEvent?: NativeKeyish
  },
  run: { disabled: boolean; search(): void },
): void {
  if (guardImeEnter(event)) return
  if (event.key === 'Enter' && !run.disabled) {
    event.preventDefault()
    run.search()
  }
}

export function dockEscapeKeyDown(
  event: { key?: string; stopPropagation(): void },
  run: { loading: boolean; close(): void },
): void {
  if (event.key !== 'Escape') return
  event.stopPropagation()
  if (run.loading) return
  run.close()
}

export function hostComponentsFromRenderProps(props: unknown): {
  Select?: HostSelect
  Dialog?: HostDialog
  Button?: HostButton
  Input?: HostInput
} {
  if (!props || typeof props !== 'object') return {}
  const record = props as Record<string, unknown>
  const sources: Record<string, unknown>[] = [record]
  if (record.owner && typeof record.owner === 'object') sources.push(record.owner as Record<string, unknown>)
  let Select: HostSelect | undefined
  let Dialog: HostDialog | undefined
  let Button: HostButton | undefined
  let Input: HostInput | undefined
  for (const source of sources) {
    if (typeof source.Select === 'function') Select = source.Select as HostSelect
    if (typeof source.Dialog === 'function') Dialog = source.Dialog as HostDialog
    if (typeof source.Button === 'function') Button = source.Button as HostButton
    if (typeof source.Input === 'function') Input = source.Input as HostInput
  }
  return { Select, Dialog, Button, Input }
}

export type RenderInputProps = HostInputProps & { ref?: Ref<HTMLInputElement> }

export function renderInput(Input: HostInput | undefined, props: RenderInputProps) {
  if (Input) {
    const Host = Input as ComponentType<RenderInputProps>
    return <Host {...props} />;
  }
  // The official field is a controlled native input, so this adapter keeps
  // speaking the plugin's own "hand me the value" callback and unwraps the
  // event here instead of leaking it to a call site. Its wrapper span owns the
  // visible box, so the caller's class rides on the wrapper and the caller's
  // ref — which only the host field can take — is left behind.
  const { onChange, ref, ...rest } = props
  return <OfficialInput {...rest} onChange={event => onChange(event.target.value)} />;
}

export function renderSelect(Select: HostSelect | undefined, props: HostSelectProps, className?: string) {
  if (Select) return <Select {...props} />;
  return (
    <select
      id={props.id}
      className={className}
      value={props.value}
      disabled={props.disabled}
      aria-label={props['aria-label']}
      onChange={(event: ChangeEvent<HTMLSelectElement>) => props.onChange(event.target.value)}>
      {props.options.map((option) => <option key={option.value === '' ? '__empty' : option.value} value={option.value}>
        {option.label}
      </option>)}
    </select>
  );
}

/**
 * The host's own Button still wins whenever the slot supplies one, so a page
 * rendered inside DSH keeps the surrounding chrome. Standalone there is no host
 * to defer to, and the plugin renders the official primitive instead of a
 * hand-rolled `<button>`: the two legacy variant names the call sites use are
 * mapped onto it here. `danger` has no primitive variant, so it keeps the
 * outlined appearance and takes its tone from a class in the plugin stylesheet
 * — the way every other destructive action in the host reads.
 */
const BUTTON_VARIANT: Record<NonNullable<HostButtonProps['variant']>, ButtonVariant> = {
  default: 'outline',
  primary: 'primary',
  danger: 'outline',
  icon: 'ghost',
}

export const ZhihuButton = forwardRef<HTMLButtonElement, HostButtonProps & { host?: HostButton }>(
  function ZhihuButton({ host, variant, className, ...rest }, ref) {
    if (host) {
      const Host = host as ComponentType<HostButtonProps & { ref?: Ref<HTMLButtonElement> }>
      return <Host ref={ref} variant={variant} className={className} {...rest} />
    }
    return <Button ref={ref} variant={BUTTON_VARIANT[variant ?? 'default']} className={className} {...rest} />
  },
)
