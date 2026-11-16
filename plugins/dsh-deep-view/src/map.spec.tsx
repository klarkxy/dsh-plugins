import { act, useState } from 'react'
import { JSDOM } from 'jsdom'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { DEFAULT_MAP_STYLE, MAP_ROUTE_LAYER, MAP_ROUTE_SOURCE, MapView, mapData, routesToGeoJSON } from './map.tsx'

const dom = new JSDOM('<div id="root"></div>', { url: 'https://local.test' })
vi.stubGlobal('window', dom.window)
vi.stubGlobal('document', dom.window.document)
vi.stubGlobal('navigator', dom.window.navigator)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

// A fake maplibre-gl: the map records its constructor options, listeners and
// style mutations; a marker keeps its element as a plain DOM node so marker
// clicks exercise the real <button> handler.
const fake = vi.hoisted(() => {
  const state = {
    maps: [] as any[],
    markers: [] as any[],
  }
  class FakeMarker {
    element: HTMLElement
    lngLat: unknown
    removed = false
    constructor(options: { element: HTMLElement }) {
      this.element = options.element
      state.markers.push(this)
    }
    setLngLat(lnglat: unknown) { this.lngLat = lnglat; return this }
    addTo() {
      // The real MapLibre Marker adds its element to the map container.
      // Mount it here too so the test clicks a reachable button, not a detached node.
      document.querySelector('.dvui-map-host')?.appendChild(this.element)
      this.element.classList.add('maplibregl-marker')
      return this
    }
    remove() { this.removed = true; this.element.remove(); return this }
  }
  class FakeNavigationControl {
    options: unknown
    constructor(options?: unknown) { this.options = options }
  }
  class FakeMap {
    options: Record<string, unknown>
    listeners = new Map<string, ((event: unknown) => void)[]>()
    sources = new Map<string, { spec: unknown; data: unknown[] }>()
    layers: unknown[] = []
    controls: unknown[] = []
    removed = false
    constructor(options: Record<string, unknown>) {
      this.options = options
      state.maps.push(this)
    }
    on(type: string, listener: (event: unknown) => void) {
      const list = this.listeners.get(type) ?? []
      list.push(listener)
      this.listeners.set(type, list)
      const sub = { unsubscribe: () => { this.listeners.set(type, (this.listeners.get(type) ?? []).filter(item => item !== listener)) } }
      return sub
    }
    off(type: string, listener: (event: unknown) => void) {
      this.listeners.set(type, (this.listeners.get(type) ?? []).filter(item => item !== listener))
      return this
    }
    fire(type: string, event: unknown = {}) { for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event) }
    addControl(control: unknown) { this.controls.push(control); return this }
    addSource(id: string, spec: unknown) { this.sources.set(id, { spec, data: [] }); return this }
    getSource(id: string) {
      const entry = this.sources.get(id)
      return entry === undefined ? undefined : { setData: (data: unknown) => { entry.data.push(data) } }
    }
    addLayer(layer: unknown) { this.layers.push(layer); return this }
    remove() { this.removed = true }
  }
  return { state, FakeMap, FakeMarker, FakeNavigationControl }
})
vi.mock('./map-loader.ts', () => ({
  loadMapLibre: async () => ({ Map: fake.FakeMap, Marker: fake.FakeMarker, NavigationControl: fake.FakeNavigationControl }),
}))
vi.mock('maplibre-gl', () => ({
  default: { Map: fake.FakeMap, Marker: fake.FakeMarker, NavigationControl: fake.FakeNavigationControl },
  Map: fake.FakeMap,
  Marker: fake.FakeMarker,
  NavigationControl: fake.FakeNavigationControl,
}))

let createRoot: typeof import('react-dom/client').createRoot
beforeAll(async () => { createRoot = (await import('react-dom/client')).createRoot })
afterEach(() => {
  document.body.innerHTML = '<div id="root"></div>'
  fake.state.maps.length = 0
  fake.state.markers.length = 0
})

const t = (key: string) => key
const locations = [
  { id: 'a', label: 'Alpha', detail: 'first', coordinates: [116.39, 39.9] as [number, number] },
  { id: 'b', label: 'Beta', coordinates: [121.47, 31.23] as [number, number] },
]
const routes = [{ label: 'leg', coordinates: [[116.39, 39.9], [121.47, 31.23]] as [number, number][] }]
const mapNode = (extra: Record<string, unknown> = {}) => ({ type: 'map' as const, id: 'place', locations, routes, ...extra })
const render = async (props: Record<string, unknown>) => {
  const root = createRoot(document.getElementById('root')!)
  const setInput = vi.fn()
  const values: Record<string, unknown> = {}
  // setInput must re-render with the new scope value, like WidgetView's
  // useState does; a bare object read would leave aria-pressed stale.
  const Harness = () => {
    const [scope, setScope] = useState<Record<string, unknown>>({})
    return <MapView
      node={props.node as never}
      lookup={(name: string) => scope[name]}
      setInput={(id, value) => { values[id] = value; setInput(id, value); setScope(before => ({ ...before, [id]: value })) }}
      t={t}
    />
  }
  await act(async () => root.render(<Harness />))
  // MapLibre arrives through a dynamic import; give it a macrotask to land.
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
  return { root, setInput, values }
}
const latestMap = () => fake.state.maps.at(-1)!

describe('map helpers', () => {
  it('routesToGeoJSON builds a controlled FeatureCollection', () => {
    const geo = routesToGeoJSON(routes)
    expect(geo.type).toBe('FeatureCollection')
    expect(geo.features).toHaveLength(1)
    expect(geo.features[0].geometry).toEqual({ type: 'LineString', coordinates: [[116.39, 39.9], [121.47, 31.23]] })
    expect(geo.features[0].properties.label).toBe('leg')
  })
  it('mapData filters malformed entries and derives a sane default camera', () => {
    const data = mapData({ locations: [...locations, { id: 'x', label: 'bad', coordinates: ['x', 1] }, { id: '', label: 'empty' }], routes })
    expect(data.locations).toHaveLength(2)
    expect(data.center).toEqual(locations[0].coordinates)
    const bare = mapData({})
    expect(bare.locations).toEqual([])
    expect(bare.center).toBeUndefined()
    const clamped = mapData({ zoom: 99 })
    expect(clamped.zoom).toBe(22)
  })
})

describe('MapView', () => {
  it('creates the map with the fixed default style and never a model-supplied URL', async () => {
    const { root } = await render({ node: mapNode({ style: 'https://evil.example/style.json', center: [1, 2], zoom: 9 }) })
    const map = latestMap()
    expect(map.options.style).toBe(DEFAULT_MAP_STYLE)
    expect(map.options.center).toEqual([1, 2])
    expect(map.options.zoom).toBe(9)
    await act(async () => root.unmount())
  })

  it('selects a location from the marker button and toggles it off', async () => {
    const { root, setInput, values } = await render({ node: mapNode() })
    const pins = await vi.waitFor(() => {
      const found = [...document.querySelectorAll<HTMLButtonElement>('.dvui-map-pin')]
      if (found.length !== 2) throw new Error('Markers are not mounted yet')
      return found
    }, { timeout: 1000, interval: 10 })
    expect(pins).toHaveLength(2)
    expect(pins[0].getAttribute('aria-pressed')).toBe('false')
    await act(async () => pins[0].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })))
    expect(setInput).toHaveBeenCalledWith('place', 'a')
    expect(values.place).toBe('a')
    expect(pins[0].getAttribute('aria-pressed')).toBe('true')
    expect(document.body.textContent).toContain('first')
    await act(async () => pins[0].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })))
    expect(setInput).toHaveBeenLastCalledWith('place', '')
    await act(async () => root.unmount())
  })

  it('selects from the accessible location list with no map interaction', async () => {
    const { root, setInput } = await render({ node: mapNode() })
    const list = document.querySelector('.dvui-map-locations')!
    const beta = [...list.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Beta')!
    await act(async () => beta.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })))
    expect(setInput).toHaveBeenCalledWith('place', 'b')
    expect(beta.getAttribute('aria-pressed')).toBe('true')
    await act(async () => root.unmount())
  })

  it('adds a controlled geojson source and line layer after load', async () => {
    const { root } = await render({ node: mapNode() })
    const map = latestMap()
    expect(map.sources.has(MAP_ROUTE_SOURCE)).toBe(false)
    await act(async () => map.fire('load'))
    expect(map.sources.has(MAP_ROUTE_SOURCE)).toBe(true)
    const spec = map.sources.get(MAP_ROUTE_SOURCE)!.spec as { type: string; data: ReturnType<typeof routesToGeoJSON> }
    expect(spec.type).toBe('geojson')
    expect(spec.data.features[0].geometry.type).toBe('LineString')
    const layer = map.layers[0] as { id: string; type: string; source: string }
    expect(layer).toMatchObject({ id: MAP_ROUTE_LAYER, type: 'line', source: MAP_ROUTE_SOURCE })
    expect(map.controls).toHaveLength(1)
    await act(async () => root.unmount())
  })

  it('shows an honest notice when the style fails, without blanking the card', async () => {
    const { root } = await render({ node: mapNode() })
    const map = latestMap()
    await act(async () => map.fire('error', { error: new Error('style failed') }))
    expect(document.body.textContent).toContain('Map failed to load.')
    expect(document.querySelector('.dvui-map-notice')).toBeTruthy()
    expect(document.querySelector('.dvui-map-locations')).toBeTruthy()
    expect(map.sources.has(MAP_ROUTE_SOURCE)).toBe(false)
    await act(async () => root.unmount())
  })

  it('shows an honest notice when maplibre throws during construction', async () => {
    const boom = vi.spyOn(fake, 'FakeMap').mockImplementationOnce(() => { throw new Error('no webgl') })
    const { root } = await render({ node: mapNode() })
    await vi.waitFor(() => {
      if (!document.body.textContent?.includes('Map is unavailable in this environment.')) throw new Error('Waiting for the map failure notice')
    }, { timeout: 1000, interval: 10 })
    boom.mockRestore()
    await act(async () => root.unmount())
  })

  it('removes markers, listeners and the map on unmount', async () => {
    const { root } = await render({ node: mapNode() })
    const map = latestMap()
    await act(async () => map.fire('load'))
    expect(map.listeners.get('error')!.length).toBeGreaterThan(0)
    const markers = fake.state.markers.slice()
    expect(markers).toHaveLength(2)
    await act(async () => root.unmount())
    expect(markers.every(marker => marker.removed)).toBe(true)
    expect(map.removed).toBe(true)
    expect(map.listeners.get('error')).toEqual([])
    expect(map.listeners.get('load')).toEqual([])
    expect(document.querySelector('.maplibregl-marker')).toBeNull()
  })
})
