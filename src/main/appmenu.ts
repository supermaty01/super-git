// The native application menu (File / Edit / View / Help), laid out like the original on Windows.
// Items either run in the main process (window, zoom, devtools, relaunch) or are forwarded to the
// renderer on the 'command' channel. Shortcuts the renderer already handles are shown in the menu but
// not registered here (registerAccelerator: false), so they keep working inside the app's own inputs.
import { app, BrowserWindow, Menu, shell, type MenuItemConstructorOptions } from 'electron'

const REPO_URL = 'https://github.com/supermaty01/super-git'

export interface MenuState {
  hasRepo: boolean
  leftPanel: boolean
  detailPanel: boolean
  terminal: boolean
  favorites: string[]
}

let state: MenuState = { hasRepo: false, leftPanel: true, detailPanel: true, terminal: false, favorites: [] }

export function buildAppMenu(win: BrowserWindow | null): void {
  const send = (cmd: string) => () => win?.webContents.send('command', cmd)
  /** shown in the menu, handled by the renderer's keyboard handling */
  const shown = (accelerator: string) => ({ accelerator, registerAccelerator: false })
  const repo = state.hasRepo
  const name = app.getName()

  const tabs: MenuItemConstructorOptions[] = [
    { label: 'Select Next Tab', click: send('tab:next'), ...shown('Control+Tab') },
    { label: 'Select Previous Tab', click: send('tab:prev'), ...shown('Control+Shift+Tab') },
    { label: 'Open Tabs List', click: send('tab:list'), accelerator: 'Control+Shift+A' },
    { type: 'separator' },
    ...Array.from({ length: 9 }, (_, i): MenuItemConstructorOptions => ({ label: `Select Tab ${i + 1}`, click: send(`tab:${i + 1}`), accelerator: `Control+${i + 1}` }))
  ]
  const favorites: MenuItemConstructorOptions[] = Array.from({ length: 9 }, (_, i) => ({
    label: `Open Favorite Repo ${i + 1}`,
    sublabel: state.favorites[i] ? state.favorites[i].split(/[\\/]/).pop() : undefined,
    enabled: !!state.favorites[i],
    click: send(`favorite:${i + 1}`),
    accelerator: `Control+Alt+${i + 1}`
  }))

  const template: MenuItemConstructorOptions[] = [
    {
      label: '&File',
      submenu: [
        { label: 'New &Tab', click: send('tab:new'), ...shown('Control+T') },
        { label: 'Close Tab', click: send('tab:close'), ...shown('Control+W') },
        { label: 'Reopen Closed &Tab', click: send('tab:reopen'), ...shown('Control+Shift+T') },
        { type: 'separator' },
        { label: 'Clo&ne Repo...', click: send('repo:clone'), accelerator: 'Control+N' },
        { label: '&Init Repo...', click: send('repo:init'), accelerator: 'Control+I' },
        { label: '&Open Repo...', click: send('repo:open'), accelerator: 'Control+O' },
        { label: '&Open Repo Management', click: send('repo:management'), accelerator: 'Control+Alt+O' },
        { label: 'Open Repo in External &Editor', click: send('repo:editor'), accelerator: 'Control+Shift+E', enabled: repo },
        { type: 'separator' },
        { label: 'Open External &Terminal', click: send('repo:terminal'), accelerator: 'Alt+T', enabled: repo },
        { label: 'Open in File Manager', click: send('repo:files'), accelerator: 'Alt+O', enabled: repo },
        { type: 'separator' },
        { label: '&Preferences...', click: send('prefs'), ...shown('Control+,') },
        { type: 'separator' },
        { label: 'E&xit', role: 'quit', accelerator: 'Alt+F4' }
      ]
    },
    {
      label: '&Edit',
      submenu: [
        { label: '&Undo', click: send('undo'), ...shown('Control+Z') },
        { label: '&Redo', click: send('redo'), ...shown('Control+Y') },
        { type: 'separator' },
        { label: '&Cut', role: 'cut' },
        { label: 'C&opy', role: 'copy' },
        { label: '&Paste', role: 'paste' },
        { label: 'Select &All', role: 'selectAll' }
      ]
    },
    {
      label: '&View',
      submenu: [
        { label: `&Relaunch ${name}`, accelerator: 'Control+Shift+R', click: () => { app.relaunch(); app.exit(0) } },
        { label: 'Toggle &Full Screen', accelerator: 'Control+Shift+F', click: () => win?.setFullScreen(!win.isFullScreen()) },
        { label: 'Toggle Full Screen', accelerator: 'F11', visible: false, click: () => win?.setFullScreen(!win.isFullScreen()) },
        { type: 'separator' },
        { label: '&Increase Zoom', click: send('zoom:in'), ...shown('Control+=') },
        { label: '&Increase Zoom', click: send('zoom:in'), accelerator: 'Control+numadd', visible: false },
        { label: 'Decrease Z&oom', click: send('zoom:out'), ...shown('Control+-') },
        { label: 'Decrease Z&oom', click: send('zoom:out'), accelerator: 'Control+numsub', visible: false },
        { label: '&Reset Zoom', click: send('zoom:reset'), ...shown('Control+0') },
        { label: 'Developer', submenu: [{ label: 'Toggle Developer &Tools', click: () => win?.webContents.toggleDevTools(), ...shown('Control+Shift+I') }] },
        { label: 'Tabs', submenu: tabs },
        {
          label: 'Terminal Tabs', submenu: [
            { label: 'Select Next Terminal Tab', click: send('term:next'), accelerator: 'Control+PageDown', enabled: state.terminal },
            { label: 'Select Previous Terminal Tab', click: send('term:prev'), accelerator: 'Control+PageUp', enabled: state.terminal },
            { label: 'New Terminal Tab', click: send('term:new'), accelerator: 'Control+Shift+N', enabled: state.terminal },
            { label: 'Close Terminal Tab', click: send('term:close'), accelerator: 'Control+Shift+W', enabled: state.terminal },
            { type: 'separator' },
            ...Array.from({ length: 9 }, (_, i): MenuItemConstructorOptions => ({ label: `Select Terminal Tab ${i + 1}`, click: send(`term:${i + 1}`), accelerator: `Control+Shift+${i + 1}`, enabled: state.terminal }))
          ]
        },
        { label: 'Favorites', submenu: favorites },
        { type: 'separator' },
        { label: 'Show Left Panel', type: 'checkbox', checked: state.leftPanel, enabled: repo, click: send('panel:left'), accelerator: 'Control+J' },
        { label: 'Show Commit Details Panel', type: 'checkbox', checked: state.detailPanel, enabled: repo, click: send('panel:detail'), ...shown('Control+K') },
        { label: 'Show Terminal Panel', type: 'checkbox', checked: state.terminal, enabled: repo, click: send('panel:terminal'), ...shown('Control+`') }
      ]
    },
    {
      label: '&Help',
      submenu: [
        { label: 'Open Command Palette', click: send('palette'), ...shown('Control+P') },
        { label: 'Keyboard Shortcuts', click: send('shortcuts'), ...shown('Control+/') },
        { type: 'separator' },
        { label: `About ${name}`, click: send('about') },
        { label: `Version ${app.getVersion()} (${process.arch} ${process.arch.includes('64') ? '64' : '32'}-bit)`, enabled: false },
        { label: 'View Release Notes', click: () => void shell.openExternal(`${REPO_URL}/releases`) },
        { label: 'View Support Documentation', click: () => void shell.openExternal(`${REPO_URL}#readme`) },
        { label: 'Support Logs', submenu: [{ label: 'View Activity Log', click: send('activity') }] },
        { type: 'separator' },
        { label: 'Browse or Submit Feature Requests', click: () => void shell.openExternal(`${REPO_URL}/issues`) },
        { label: 'Report a Problem', click: () => void shell.openExternal(`${REPO_URL}/issues/new`) }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

export function setMenuState(win: BrowserWindow | null, patch: Partial<MenuState>): void {
  const next = { ...state, ...patch }
  if (JSON.stringify(next) === JSON.stringify(state)) return
  state = next
  buildAppMenu(win)
}
