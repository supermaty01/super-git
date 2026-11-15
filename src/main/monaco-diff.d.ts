// Types for the one internal Monaco module the main process uses (it ships without declarations).
declare module 'monaco-editor/esm/vs/editor/common/diff/defaultLinesDiffComputer/defaultLinesDiffComputer.js' {
  interface TextRange { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }
  interface LineRange { startLineNumber: number; endLineNumberExclusive: number }
  export interface LineRangeMapping {
    original: LineRange
    modified: LineRange
    innerChanges: ReadonlyArray<{ originalRange: TextRange; modifiedRange: TextRange }> | undefined
  }
  export class DefaultLinesDiffComputer {
    computeDiff(original: string[], modified: string[], options: { ignoreTrimWhitespace: boolean; maxComputationTimeMs: number; computeMoves: boolean }): {
      changes: readonly LineRangeMapping[]
      hitTimeout: boolean
    }
  }
}
