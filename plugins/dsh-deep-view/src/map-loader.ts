import type { MapLike, MarkerLike } from './map.tsx'
import { mapWorkerSource } from './map-worker.generated.ts'

type MapLibreLike = {
  Map: new (options: Record<string, unknown>) => MapLike
  Marker: new (options: { element: HTMLElement }) => MarkerLike
  NavigationControl: new (options?: Record<string, unknown>) => unknown
  setWorkerUrl?(url: string): void
}
let workerUrl: string | undefined

/** CJS interop belongs to the loader, not the map's rendering logic. */
export async function loadMapLibre(): Promise<MapLibreLike> {
  const module = await import('maplibre-gl') as unknown as MapLibreLike
  const lib = 'Map' in module ? module : (module as unknown as { default: MapLibreLike }).default
  // MapLibre accepts a trusted same-origin Blob worker. The page releases it on
  // unload; keeping one URL avoids revoking it before asynchronous construction.
  if (lib.setWorkerUrl && typeof Blob !== 'undefined' && typeof URL.createObjectURL === 'function') {
    workerUrl ??= URL.createObjectURL(new Blob([mapWorkerSource], { type: 'text/javascript' }))
    lib.setWorkerUrl(workerUrl)
  }
  return lib
}
