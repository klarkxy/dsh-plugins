// Map node for deep-view: one MapLibre canvas plus an always-rendered,
// accessible location list. The style URL is a fixed trusted default — the
// model never supplies URLs, tile servers or arbitrary network data, only
// id/label/coordinate pairs. Locations are real <button> markers so selection
// works without WebGL or a pointer; routes are a controlled GeoJSON source
// + line layer managed by this component. maplibre-gl is imported lazily in
// an effect so module load, WebGL or style failures degrade to an honest
// notice instead of a blank card. The stylesheet for .dvui-map* classes is
// injected by the view's owner styles; no CSS is imported here.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { MapLocation, MapRoute } from './contracts.ts'
import type { RichNodeProps } from './rich-types.ts'
import { english } from './ui.tsx'

// The only basemap this component will ever request. It is a constant so the
// model cannot smuggle a style URL, api key or third-party endpoint through a
// node property; `MapView` does not read `node.style` at all.
export const DEFAULT_MAP_STYLE = 'https://demotiles.maplibre.org/style.json'

export const MAP_ROUTE_SOURCE = 'dvui-map-routes'
export const MAP_ROUTE_LAYER = 'dvui-map-routes-line'

export type LngLat = [number, number]
export type MapData = {
  locations: MapLocation[]
  routes: MapRoute[]
  center: LngLat | undefined
  zoom: number
}
export type RouteGeoJSON = {
  type: 'FeatureCollection'
  features: { type: 'Feature'; geometry: { type: 'LineString'; coordinates: number[][] }; properties: { label: string } }[]
}
export type MapLike = {
  on(type: string, listener: (event: never) => void): { unsubscribe(): void }
  off(type: string, listener: (event: never) => void): unknown
  addControl(control: unknown, position?: string): unknown
  addSource(id: string, source: unknown): unknown
  addLayer(layer: unknown, beforeId?: string): unknown
  getSource(id: string): unknown
  remove(): void
}
export type MarkerLike = { setLngLat(lnglat: LngLat): MarkerLike; addTo(map: MapLike): MarkerLike; remove(): void }
type MapLibreLike = {
  Map: new (options: Record<string, unknown>) => MapLike
  Marker: new (options: { element: HTMLElement }) => MarkerLike
  NavigationControl: new (options?: Record<string, unknown>) => unknown
}

const isLngLat = (value: unknown): value is LngLat =>
  Array.isArray(value) && value.length === 2 && value.every(part => typeof part === 'number' && Number.isFinite(part))
const isLocation = (value: unknown): value is MapLocation =>
  value !== null && typeof value === 'object'
  && typeof (value as MapLocation).id === 'string' && (value as MapLocation).id !== ''
  && typeof (value as MapLocation).label === 'string'
  && isLngLat((value as MapLocation).coordinates)

/** Everything the component needs from the node, defensively filtered.
 * A malformed coordinate or entry is dropped, never trusted or thrown on. */
export function mapData(node: { center?: unknown; zoom?: unknown; locations?: unknown; routes?: unknown }): MapData {
  const locations = (Array.isArray(node.locations) ? node.locations : []).filter(isLocation)
  const routes = (Array.isArray(node.routes) ? node.routes : []).filter((route): route is MapRoute =>
    route !== null && typeof route === 'object'
    && Array.isArray((route as MapRoute).coordinates) && (route as MapRoute).coordinates.length >= 2
    && (route as MapRoute).coordinates.every(isLngLat))
  const center = isLngLat(node.center) ? [node.center[0], node.center[1]] as LngLat
    : locations.length > 0 ? [locations[0].coordinates[0], locations[0].coordinates[1]] as LngLat
    : undefined
  const zoom = typeof node.zoom === 'number' && Number.isFinite(node.zoom)
    ? Math.max(0, Math.min(22, node.zoom))
    : locations.length <= 1 ? 4 : 3
  return { locations, routes, center, zoom }
}

/** Routes rendered as one FeatureCollection of LineStrings. `setData` is the
 * controlled update path: the component owns source and layer ids entirely. */
export function routesToGeoJSON(routes: MapRoute[]): RouteGeoJSON {
  return {
    type: 'FeatureCollection',
    features: routes.map(route => ({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: route.coordinates.map(pair => [pair[0], pair[1]]) },
      properties: { label: typeof route.label === 'string' ? route.label : '' },
    })),
  }
}

// Canvas paint cannot read CSS custom properties, so the route colour is
// resolved once from the host token, falling back to the plugin accent blue.
function lineColor(): string {
  try {
    const color = typeof getComputedStyle === 'function'
      ? getComputedStyle(document.documentElement).getPropertyValue('--dsw-alias-state-business-primary').trim()
      : ''
    return color !== '' ? color : 'currentColor'
  } catch {
    return 'currentColor'
  }
}

import { loadMapLibre } from './map-loader.ts'

function webglAvailable(): boolean {
  if (typeof document === 'undefined' || typeof WebGLRenderingContext === 'undefined' && typeof WebGL2RenderingContext === 'undefined') return true
  try {
    const canvas = document.createElement('canvas')
    return canvas.getContext('webgl2') !== null || canvas.getContext('webgl') !== null
  } catch { return false }
}

export function MapView({ node, lookup, setInput, t = english, editable = true }: RichNodeProps & { editable?: boolean }) {
  const id = typeof node.id === 'string' ? node.id : ''
  const data = useMemo(() => mapData(node), [node])
  const geo = useMemo(() => routesToGeoJSON(data.routes), [data.routes])
  // The view scope throws for a name the view never declared; a map without a
  // valid input id is read-only instead of crashing the card.
  const selected = (() => {
    try { return id !== '' ? lookup(id) : undefined } catch { return undefined }
  })()
  const selectedId = typeof selected === 'string' && selected !== '' ? selected : null
  const selectedLocation = data.locations.find(location => location.id === selectedId) ?? null
  const selectedRef = useRef(selectedId)
  selectedRef.current = selectedId

  const hostRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLike | null>(null)
  const markersRef = useRef<{ button: HTMLButtonElement; location: MapLocation; marker: MarkerLike }[]>([])
  const readyRef = useRef(false)
  const geoRef = useRef(geo)
  geoRef.current = geo
  const selectRef = useRef<(location: MapLocation) => void>(() => {})
  const [failure, setFailure] = useState<'init' | 'style' | null>(null)
  const failureRef = useRef<typeof failure>(null)
  failureRef.current = failure

  const choose = (location: MapLocation) => {
    if (id === '' || !editable) return
    setInput(id, selectedId === location.id ? '' : location.id)
  }
  selectRef.current = choose

  const syncRoutes = () => {
    const map = mapRef.current
    if (!map || !readyRef.current || failureRef.current !== null) return
    try {
      const source = map.getSource(MAP_ROUTE_SOURCE) as { setData?(data: unknown): void } | undefined
      if (source?.setData !== undefined) source.setData(geoRef.current)
      else {
        map.addSource(MAP_ROUTE_SOURCE, { type: 'geojson', data: geoRef.current })
        map.addLayer({
          id: MAP_ROUTE_LAYER, type: 'line', source: MAP_ROUTE_SOURCE,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': lineColor(), 'line-width': 3, 'line-opacity': 0.85 },
        })
      }
    } catch { /* a source race must never break the card; the list below still works */ }
  }

  useEffect(() => {
    const host = hostRef.current
    if (!host) return undefined
    let cancelled = false
    const subscriptions: { unsubscribe(): void }[] = []
    const markers: typeof markersRef.current = []
    let map: MapLike | null = null
    setFailure(null)
    failureRef.current = null
    readyRef.current = false
    void (async () => {
      let lib: MapLibreLike
      try {
        lib = await loadMapLibre()
      } catch {
        if (!cancelled) setFailure('init')
        return
      }
      if (cancelled) return
      if (!webglAvailable()) { if (!cancelled) setFailure('init'); return }
      try {
        map = new lib.Map({
          container: host,
          style: DEFAULT_MAP_STYLE,
          ...(data.center !== undefined ? { center: data.center } : {}),
          zoom: data.zoom,
          attributionControl: { compact: true },
          locale: {
            'Map.Title': t('Map'),
            'Marker.Title': t('Map marker'),
            'NavigationControl.ZoomIn': t('Zoom in'),
            'NavigationControl.ZoomOut': t('Zoom out'),
            'NavigationControl.ResetBearing': t('Reset bearing to north'),
          },
        })
      } catch {
        if (!cancelled) setFailure('init')
        return
      }
      if (cancelled) { try { map.remove() } catch { /* noop */ } return }
      mapRef.current = map
      subscriptions.push(
        // Before 'load' an error means the style (or WebGL) failed: the tiles
        // themselves cannot exist yet. After load, tile-level errors are
        // logged by the browser and must not blank a working map.
        map.on('error', () => { if (!readyRef.current) { failureRef.current = 'style'; setFailure('style') } }),
        map.on('load', () => {
          readyRef.current = true
          try { map?.addControl(new lib.NavigationControl({ showCompass: false }), 'top-right') } catch { /* controls are decoration */ }
          syncRoutes()
        }),
      )
      for (const location of data.locations) {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'dvui-map-pin'
        button.disabled = !editable
        button.setAttribute('aria-label', location.label)
        button.setAttribute('aria-pressed', location.id === selectedRef.current ? 'true' : 'false')
        button.setAttribute('title', location.label)
        button.addEventListener('click', event => { event.stopPropagation(); selectRef.current(location) })
        try {
          const marker = new lib.Marker({ element: button }).setLngLat([location.coordinates[0], location.coordinates[1]]).addTo(map)
          markers.push({ button, location, marker })
        } catch { /* a dead marker still leaves the list below */ }
      }
      markersRef.current = markers
    })()
    return () => {
      cancelled = true
      readyRef.current = false
      for (const { marker } of markers) { try { marker.remove() } catch { /* noop */ } }
      markersRef.current = []
      for (const subscription of subscriptions) { try { subscription.unsubscribe() } catch { /* noop */ } }
      mapRef.current = null
      if (map) { try { map.remove() } catch { /* noop */ } }
    }
  // Rebuild the map for a new model snapshot or a change in edit permission;
  // selection remains in the view scope and is restored by selectedRef.
  }, [data, editable])

  // Keep route geometry and marker selection state in sync with the view
  // scope; both are idempotent on an unmounted or unready map.
  useEffect(() => { syncRoutes() }, [geo])
  useEffect(() => {
    for (const { button, location } of markersRef.current) {
      button.setAttribute('aria-pressed', location.id === selectedId ? 'true' : 'false')
      button.style.background = location.id === selectedId ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-business-primary)'
    }
  }, [selectedId])

  return <div className="dvui-map">
    {node.label !== undefined ? <div className="dvui-input-label">{node.label}</div> : null}
    <div className="dvui-map-frame">
      <div ref={hostRef} className="dvui-map-host" />
      {failure !== null ? <div className="dvui-map-notice" role="status">
        <span>{t(failure === 'init' ? 'Map is unavailable in this environment.' : 'Map failed to load.')}</span>
        {data.locations.length > 0 ? <small>{t('You can still pick a location below.')}</small> : null}
      </div> : null}
    </div>
    {selectedLocation !== null ? <div className="dvui-map-detail" role="status">
      <span>{selectedLocation.label}</span>
      {typeof selectedLocation.detail === 'string' && selectedLocation.detail !== ''
        ? <span>{selectedLocation.detail}</span> : null}
    </div> : null}
    {data.locations.length > 0 ? <div className="dvui-map-locations" role="group" aria-label={t('Locations')}>
      {data.locations.map(location => <button
        key={location.id} type="button" className="dvui-map-location"
        aria-pressed={location.id === selectedId}
        title={typeof location.detail === 'string' ? location.detail : undefined}
        disabled={!editable}
        onClick={() => choose(location)}
      >{location.label}</button>)}
    </div> : null}
  </div>
}
