import type { Ref, Commit } from '@shared/types'

/** the annotation of an annotated tag (shown on hover); undefined for a lightweight tag, whose "subject" is the commit's */
export function tagAnnotation(tag: Ref | undefined, commits: Commit[]): string | undefined {
  if (!tag || tag.type !== 'tag' || !tag.subject) return undefined
  const c = commits.find((x) => x.sha === tag.sha)
  return c && c.summary === tag.subject ? undefined : tag.subject
}
