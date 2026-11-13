import { useEffect, useRef, useState } from 'react'
import { closeModal } from '../store'
import { Icon } from './Icon'

// GitKraken 12.6.2's list, in its order (the terminal and "Open tabs list" rows included)
const SHORTCUTS: Array<{ group: string; items: Array<[string, string[][]]> }> = [
  { group: 'Repo Actions', items: [
    ['Create Branch', [['Ctrl', 'B']]],
    ['Fetch All', [['Ctrl', 'L']]],
    ['Commit (when in message input)', [['Ctrl', 'Enter']]],
    ['Stage Current File', [['S']]],
    ['Unstage Current File', [['U']]],
    ['Stage All Files', [['Ctrl', 'Shift', 'S']]],
    ['Unstage All Files', [['Ctrl', 'Shift', 'U']]],
    ['Stage All + Commit (when in message input)', [['Ctrl', 'Shift', 'Enter']]],
    ['Focus commit message', [['Ctrl', 'Shift', 'M']]],
    ['Open in default terminal', [['Alt', 'T']]]
  ] },
  { group: 'Navigation', items: [
    ['Select Previous Item', [['↑'], ['K']]],
    ['Select Next Item', [['↓'], ['J']]],
    ['Select the Item to the Right', [['→'], ['L']]],
    ['Select the Item to the Left', [['←'], ['H']]],
    ['Select Next Item in Branch', [['Shift', '↓'], ['Shift', 'J']]],
    ['Select Previous Item in Branch', [['Shift', '↑'], ['Shift', 'K']]],
    ['Select First Item', [['Ctrl', 'Home']]],
    ['Select Last Item', [['Ctrl', 'End']]],
    ['Undo', [['Ctrl', 'Z']]],
    ['Redo', [['Ctrl', 'Y'], ['Ctrl', 'Shift', 'Z']]]
  ] },
  { group: 'Command Palette', items: [
    ['Toggle Command Palette', [['Ctrl', 'P']]],
    ['Search commits', [['Ctrl', 'F']]],
    ['Open Repo via Command Palette', [['Ctrl', 'Shift', 'O']]],
    ['Search for a file to view its history / blame', [['Ctrl', 'Shift', 'H']]],
    ['Open Selected File in External Diff/Merge Tool', [['Ctrl', 'D']]]
  ] },
  { group: 'UI', items: [
    ['Open a new tab', [['Ctrl', 'T']]],
    ['Close File/Tab', [['Ctrl', 'W']]],
    ['Close View', [['Escape']]],
    ['Jump to the next open tab', [['Ctrl', 'Tab']]],
    ['Jump to the previous open tab', [['Ctrl', 'Shift', 'Tab']]],
    ['Jump to a specific tab', [['Ctrl', '1–9']]],
    ['Toggle Left Panel', [['Ctrl', 'J']]],
    ['Toggle Commit Details Panel', [['Ctrl', 'K']]],
    ['Toggle Terminal Panel', [['Ctrl', '`']]],
    ['New terminal tab', [['Ctrl', 'Shift', 'N']]],
    ['Close terminal tab', [['Ctrl', 'Shift', 'W']]],
    ['Jump to the next terminal tab', [['Ctrl', 'PageDown']]],
    ['Jump to the previous terminal tab', [['Ctrl', 'PageUp']]],
    ['Jump to a specific terminal tab', [['Ctrl', 'Shift', '1–9']]],
    ['Increase Zoom', [['Ctrl', '+']]],
    ['Decrease Zoom', [['Ctrl', '-']]],
    ['Reset Zoom', [['Ctrl', '0']]],
    ['Toggle Full Screen', [['Ctrl', 'Shift', 'F'], ['F11']]],
    ['Open tabs list', [['Ctrl', 'Shift', 'A']]]
  ] }
]

export function ShortcutsModal() {
  const [q, setQ] = useState('')
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); e.stopPropagation(); input.current?.focus() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
  const t = q.trim().toLowerCase()
  const groups = SHORTCUTS.map((g) => ({
    ...g,
    items: g.items.filter(([label, combos]) => !t || label.toLowerCase().includes(t) || combos.some((c) => c.join(' + ').toLowerCase().includes(t)))
  })).filter((g) => g.items.length)
  return (
    <div className="modal shortcuts-modal">
      <div className="modal-header shortcuts-header">
        <span className="shortcuts-title">Keyboard Shortcuts</span>
        <span className="shortcuts-self"><kbd>Ctrl</kbd><kbd>/</kbd></span>
        <span className="shortcuts-filter">
          <input ref={input} placeholder="Filter shortcuts (Ctrl + F)" value={q} onChange={(e) => setQ(e.target.value)} />
          <Icon name="search" />
        </span>
        <span className="modal-close" onClick={closeModal}><Icon name="times" /></span>
      </div>
      <div className="modal-body keymapContainer">
        {groups.map((g) => (
          <div key={g.group} className="shortcut-group">
            <div className="shortcut-group-title">{g.group}</div>
            <hr />
            {g.items.map(([label, combos]) => (
              <div key={label} className="shortcut-row keymap">
                <span className="shortcut-label">{label}</span>
                <span className="shortcut-keys">
                  {combos.map((combo, ci) => (
                    <span key={ci} className="shortcut-combo">
                      {ci ? <span className="shortcut-or">or</span> : null}
                      {combo.map((k) => <kbd key={k}>{k}</kbd>)}
                    </span>
                  ))}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
