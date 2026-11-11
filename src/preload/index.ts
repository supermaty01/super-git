import { contextBridge, ipcRenderer } from 'electron'

function on<T>(channel: string, cb: (v: T) => void): () => void {
  const h = (_e: unknown, v: T) => cb(v)
  ipcRenderer.on(channel, h)
  return () => ipcRenderer.removeListener(channel, h)
}

contextBridge.exposeInMainWorld('bridge', {
  call: async (method: string, ...args: unknown[]) => {
    try {
      return await ipcRenderer.invoke('api', method, args)
    } catch (e) {
      // strip Electron's "Error invoking remote method 'api': Error: " prefix
      const msg = String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, '')
      throw new Error(msg)
    }
  },
  onRepoChanged: (cb: (p: string) => void) => on('repo-changed', cb),
  onProgress: (cb: (e: unknown) => void) => on('progress', cb),
  onZoom: (cb: (z: number) => void) => on('zoom', cb),
  onCommand: (cb: (c: string) => void) => on('command', cb),
  onTermData: (cb: (e: unknown) => void) => on('term-data', cb),
  onTermExit: (cb: (e: unknown) => void) => on('term-exit', cb)
})
