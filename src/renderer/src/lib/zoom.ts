/** GitKraken's zoom steps, in percent (min 80, max 300). */
export const ZOOM_STEPS = [80, 90, 100, 110, 120, 130, 140, 150, 175, 200, 250, 300]

/** the next zoom factor above/below the current one */
export function stepZoom(current: number, dir: 1 | -1): number {
  const pct = Math.round(current * 100)
  if (dir > 0) return (ZOOM_STEPS.find((z) => z > pct) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1]) / 100
  return ([...ZOOM_STEPS].reverse().find((z) => z < pct) ?? ZOOM_STEPS[0]) / 100
}
