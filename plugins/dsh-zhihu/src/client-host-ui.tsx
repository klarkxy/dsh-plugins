import { forwardRef, useCallback, useState, type ChangeEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
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

/** The platform select retains value-based callbacks used by the plugin. */
export type ZhihuSelectProps = {
  value: string
  options: readonly { value: string; label: string }[]
  onChange(value: string): void
  disabled?: boolean
  'aria-label': string
  placeholder?: string
  /** Lets a visible `<label htmlFor>` name the control. */
  id?: string
}

/** Plugin button props map its existing variants to official primitives. */
export type ZhihuButtonProps = {
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

/** Value-based input callbacks used by the plugin fields. */
export type ZhihuInputProps = {
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

export function renderInput(props: ZhihuInputProps) {
  // Keep the plugin's value-based callback by unwrapping the DOM event from
  // the controlled official input here.
  const { onChange, ...rest } = props
  return <OfficialInput {...rest} onChange={event => onChange(event.target.value)} />;
}

export function renderSelect(props: ZhihuSelectProps, className = 'dsh-ui-select') {
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

/** Map existing plugin variants onto the injected official Button. */
const BUTTON_VARIANT: Record<NonNullable<ZhihuButtonProps['variant']>, ButtonVariant> = {
  default: 'outline',
  primary: 'primary',
  danger: 'outline',
  icon: 'ghost',
}

export const ZhihuButton = forwardRef<HTMLButtonElement, ZhihuButtonProps>(
  function ZhihuButton({ variant, className, ...rest }, ref) {
    return <Button ref={ref} variant={BUTTON_VARIANT[variant ?? 'default']} className={className} {...rest} />
  },
)
