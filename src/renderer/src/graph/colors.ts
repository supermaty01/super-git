export const GRAPH_COLORS = ['#15a0bf', '#0669f7', '#8e00c2', '#c517b6', '#d90171', '#cd0101', '#f25d2e', '#f2ca33', '#7bd938', '#2ece9d']
let APP_BG = [9, 10, 11]
export function setGraphTheme(bg: number[]): void { APP_BG = bg }

function rgb(hex: string): number[] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export const laneColor = (lane: number): string => GRAPH_COLORS[((lane % 10) + 10) % 10]

export function laneAlpha(lane: number, a: number): string {
  const [r, g, b] = rgb(laneColor(lane))
  return `rgba(${r}, ${g}, ${b}, ${a})`
}

/** Opaque mix of the lane colour with the app background (pct = share of the lane colour). */
export function laneMix(lane: number, pct: number): string {
  const c = rgb(laneColor(lane))
  const m = c.map((v, i) => Math.round(v * pct + APP_BG[i] * (1 - pct)))
  return `rgb(${m[0]}, ${m[1]}, ${m[2]})`
}
