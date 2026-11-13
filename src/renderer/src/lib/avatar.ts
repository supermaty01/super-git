// Locally generated pixel-art identicons (no network), styled after retro avatars.
const cache = new Map<string, string>()

function hash(str: string): number[] {
  // two independent 32-bit FNV-1a style hashes -> 64 bits of entropy
  let h1 = 0x811c9dc5
  let h2 = 0x01000193 ^ 0x5bd1e995
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 16777619)
    h2 = Math.imul(h2 ^ c, 2246822519) ^ (h2 >>> 13)
  }
  const out: number[] = []
  for (let i = 0; i < 4; i++) out.push((h1 >>> (i * 8)) & 0xff)
  for (let i = 0; i < 4; i++) out.push((h2 >>> (i * 8)) & 0xff)
  return out
}

let useInitials = false
/** "Display author initials instead of avatars" */
export function setAvatarMode(initialsOnly: boolean): void { useInitials = initialsOnly }

function initialsAvatar(key: string, name: string): string {
  const bytes = hash(key)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 64
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = `hsl(${Math.round((bytes[0] / 255) * 360)}, 45%, 38%)`
  ctx.fillRect(0, 0, 64, 64)
  ctx.fillStyle = '#fff'
  ctx.font = '600 28px "Open Sans", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(initials(name || key) || '?', 32, 34)
  return canvas.toDataURL('image/png')
}

export function avatarUrl(email: string, name = ''): string {
  const key = (email || name).trim().toLowerCase()
  const cacheKey = (useInitials ? 'i:' : 'p:') + key
  const hit = cache.get(cacheKey)
  if (hit) return hit
  if (useInitials) { const u = initialsAvatar(key, name || email.split('@')[0]); cache.set(cacheKey, u); return u }
  const bytes = hash(key)
  const size = 8
  const px = 4
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size * px
  const ctx = canvas.getContext('2d')!
  // the palette of the original's retro avatars: dark slate background, cream figure
  ctx.fillStyle = 'rgb(31, 60, 81)'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = 'rgb(244, 220, 173)'
  // 4 columns x 8 rows, mirrored horizontally
  let bit = 0
  const bits = (n: number) => (bytes[4 + ((n >> 3) % 4)] >> (n & 7)) & 1
  for (let y = 1; y < size - 1; y++) {
    for (let x = 0; x < size / 2; x++) {
      const on = bits(bit++ * 3 + y) ^ (x === 3 && y > 1 && y < 6 ? 1 : 0)
      if (on) {
        ctx.fillRect(x * px, y * px, px, px)
        ctx.fillRect((size - 1 - x) * px, y * px, px, px)
      }
    }
  }
  const url = canvas.toDataURL('image/png')
  cache.set(cacheKey, url)
  return url
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('')
}
