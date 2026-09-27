import { createRef, forwardRef, type ReactElement, type Ref } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ZhihuButton, type HostButton, type HostButtonProps } from './client-host-ui.tsx'

type Props = HostButtonProps & { host?: HostButton }
function render(props: Props, ref: Ref<HTMLButtonElement> = null) {
  return (ZhihuButton as unknown as {
    render(props: Props, ref: Ref<HTMLButtonElement>): ReactElement<Props & { ref?: Ref<HTMLButtonElement> }>
  }).render(props, ref)
}

describe('portable Zhihu button adapter', () => {
  it.each([
    [undefined, ''], ['default', ''], ['primary', 'primary-action'],
    ['danger', 'danger-action'], ['icon', 'icon-button'],
  ] as const)('keeps standalone variant %s without a host dependency', (variant, expected) => {
    const button = render({ variant, className: 'zhihu-button', children: '搜索' })
    expect(button.type).toBe('button')
    expect(button.props.type).toBe('button')
    expect(button.props.className).toBe([expected, 'zhihu-button'].filter(Boolean).join(' '))
    expect(button.props).not.toHaveProperty('host')
    expect(button.props).not.toHaveProperty('variant')
  })

  it('preserves native events, focus refs, disabled state and accessible tab properties', () => {
    const onClick = vi.fn()
    const ref = createRef<HTMLButtonElement>()
    const button = render({ onClick, disabled: true, role: 'tab', tabIndex: -1,
      'aria-selected': true, 'aria-controls': 'zhihu-results', 'data-testid': 'zhihu-search' }, ref)
    expect((button as unknown as { ref: unknown }).ref).toBe(ref)
    expect(button.props).toMatchObject({ onClick, disabled: true, role: 'tab', tabIndex: -1,
      'aria-selected': true, 'aria-controls': 'zhihu-results', 'data-testid': 'zhihu-search' })
    expect(onClick).not.toHaveBeenCalled()
  })

  it('forwards host controls and refs without leaking the adapter-only host prop', () => {
    const Host = forwardRef<HTMLButtonElement, HostButtonProps>((props, ref) => <button ref={ref} {...props} />)
    const ref = createRef<HTMLButtonElement>()
    const onClick = vi.fn()
    const button = render({ host: Host, variant: 'primary', className: 'zhihu-button',
      disabled: true, onClick, 'aria-label': '搜索', children: '执行' }, ref)
    expect(button.type).toBe(Host)
    expect((button as unknown as { ref: unknown }).ref).toBe(ref)
    expect(button.props).toMatchObject({ variant: 'primary', className: 'zhihu-button',
      disabled: true, onClick, 'aria-label': '搜索', children: '执行' })
    expect(button.props).not.toHaveProperty('host')
  })

  it('defaults to a non-submitting button but preserves an explicit submit type', () => {
    expect(render({}).props.type).toBe('button')
    expect(render({ type: 'submit' }).props.type).toBe('submit')
  })

  it('renders standalone disabled and ARIA attributes through React', () => {
    const html = renderToStaticMarkup(<ZhihuButton variant="primary" disabled aria-label="搜索">查找</ZhihuButton>)
    expect(html).toContain('type="button"')
    expect(html).toContain('class="primary-action"')
    expect(html).toContain('disabled=""')
    expect(html).toContain('aria-label="搜索"')
    expect(html).not.toContain('variant=')
    expect(html).not.toContain('host=')
  })
})
