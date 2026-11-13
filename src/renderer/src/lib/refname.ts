/** Live name rules for the inline branch / tag input (the check-ref-format rules, applied to a short name). */

/** the original drops spaces as you type instead of turning them into dashes */
export const stripSpaces = (v: string): string => v.replace(/\s/g, '')

/** true when the name would be rejected; an empty name is not flagged (nothing typed yet) */
export function isInvalidRefName(name: string): boolean {
  if (!name) return false
  if (name === '@' || name.startsWith('-') || name.startsWith('/') || name.endsWith('/') || name.endsWith('.')) return true
  if (name.includes('..') || name.includes('@{') || name.includes('//')) return true
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f ~^:?*[\\]/.test(name)) return true
  return name.split('/').some((part) => part.startsWith('.') || part.endsWith('.lock'))
}
