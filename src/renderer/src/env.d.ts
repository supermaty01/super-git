/// <reference types="vite/client" />
import type { Bridge } from '@shared/api'
declare global {
  interface Window { bridge: Bridge }
}
export {}
