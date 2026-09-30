import { createRef, forwardRef, type ReactElement, type Ref } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { ZhihuButton, type HostButton, type HostButtonProps } from './client-host-ui.tsx'

type Props = HostButtonProps & { host?: HostButton }
function render(props: Props, ref: Ref<HTMLButtonElement> = null) {
  return (ZhihuButton as unknown as {
    render(props: Props, ref: Ref<HTMLButtonElement>): ReactElement<Props & { ref?: Ref<HTMLButtonElement> }>
  }).render(props, ref)
}

describe('portable Zhihu button adapter', () => {
  it.each([
    [undefined, 'outline'], ['default', 'outline'], ['primary', 'primary'],
    ['danger', 'outline'], ['icon', 'ghost'],
  ] as const)('renders the official Button for standalone variant %s without a host dependency', (variant, expected) => {
    const button = render({ variant, className: 'zhihu-button', children: '搜索' })
    expect(button.type).toBe(Button)
    expect(button.props.variant).toBe(expected)
    expect(button.props.className).toBe('zhihu-button')
    expect(button.props).not.toHaveProperty('host')
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
    expect(renderToStaticMarkup(<ZhihuButton>查找</ZhihuButton>)).toContain('type="button"')
    expect(renderToStaticMarkup(<ZhihuButton type="submit">查找</ZhihuButton>)).toContain('type="submit"')
  })

  it('renders standalone disabled and ARIA attributes through React without leaking the adapter props', () => {
    const html = renderToStaticMarkup(<ZhihuButton variant="primary" className="zhihu-danger" disabled aria-label="搜索">查找</ZhihuButton>)
    expect(html).toContain('type="button"')
    // The primitive owns the button's own classes; the caller's class rides along.
    expect(html).toContain('zhihu-danger')
    expect(html).toContain('disabled=""')
    expect(html).toContain('aria-label="搜索"')
    expect(html).not.toContain('variant=')
    expect(html).not.toContain('host=')
  })
})
