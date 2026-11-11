import type { Api } from '@shared/api'

/** Typed proxy: api.snapshot(path, 100) -> window.bridge.call('snapshot', path, 100) */
export const api = new Proxy({} as Api, {
  get: (_t, method: string) => (...args: unknown[]) => (window.bridge.call as (m: string, ...a: unknown[]) => Promise<unknown>)(method, ...args)
})
export const bridge = () => window.bridge
