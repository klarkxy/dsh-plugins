import { createContext, useCallback, useContext, useSyncExternalStore } from 'react'

/** Host locale tier the plugin copy is written in; anything not Chinese reads English. */
export type ZhihuLocale = 'zh' | 'en'

/** Structural host locale service (the `locale` Cordis service), value-free. */
export type HostLocaleService = {
  getSnapshot(): { active: string }
  subscribe(listener: () => void): () => void
}

/** Pick one of the two inline strings for the current locale. */
export type Translate = (zh: string, en: string) => string

export function zhihuLocale(value: unknown): ZhihuLocale {
  return String(value ?? 'zh').startsWith('zh') ? 'zh' : 'en'
}

export function translator(locale: ZhihuLocale = 'zh'): Translate {
  return (zh, en) => (locale === 'en' ? en : zh)
}

/** Components below the settings root read the locale here instead of threading a prop. */
export const ZhihuLocaleContext = createContext<ZhihuLocale>('zh')

export function useZhihuLocale(): ZhihuLocale {
  return useContext(ZhihuLocaleContext)
}

// One stable function per locale: `t` sits in useCallback deps (e.g. a load
// callback an effect depends on), so a fresh closure per render would refetch forever.
const TRANSLATORS: Record<ZhihuLocale, Translate> = { zh: translator('zh'), en: translator('en') }

export function useT(): Translate {
  return TRANSLATORS[useZhihuLocale()]
}

/** Follow the host locale when the service is present; standalone renders stay Chinese. */
export function useHostLocale(service: HostLocaleService | undefined): ZhihuLocale {
  const subscribe = useCallback((listener: () => void) => (service ? service.subscribe(listener) : () => {}), [service])
  const snapshot = useCallback(() => (service ? service.getSnapshot().active : 'zh'), [service])
  return zhihuLocale(useSyncExternalStore(subscribe, snapshot, snapshot))
}
