import electron from 'electron'
import type { AppSettings, TrackMeta } from '../shared/types'

// 与主进程同理：electron-vite 下必须用 default 导入再解构，否则 CJS 里拿到 undefined
const { contextBridge, ipcRenderer, webUtils } = electron

export interface AuroraApi {
  pickFiles: () => Promise<TrackMeta[]>
  pickFolder: () => Promise<TrackMeta[]>
  tracksFromPaths: (paths: string[]) => Promise<TrackMeta[]>
  trackFromUrl: (url: string) => Promise<TrackMeta>
  probeUrl: (url: string) => Promise<{
    ok: boolean
    contentType: string
    contentLength: number
    acceptRanges: boolean
    error?: string
  }>
  /** 从拖拽的 File 对象取绝对路径（Electron 32+ 必须走 webUtils） */
  pathForFile: (file: File) => string

  /* ---------------- 音乐库（歌单持久化） ---------------- */
  /** 读取音乐库：索引恢复 + 库里新增文件 */
  loadLibrary: () => Promise<{ tracks: TrackMeta[]; libraryDir: string; copyToLibrary: boolean }>
  /** 导入路径（必要时复制进音乐库） */
  importPaths: (paths: string[]) => Promise<{
    tracks: TrackMeta[]
    copied: number
    failed: string[]
    libraryDir: string
  }>
  /** 保存歌单索引（顺序 / URL 项） */
  savePlaylist: (
    entries: { src: string; source: 'file' | 'url'; title?: string }[]
  ) => Promise<boolean>
  /** 删除歌曲文件（会先弹系统确认框；只允许删音乐库内的文件） */
  deleteTracks: (payload: { srcs: string[]; names?: string[] }) => Promise<{
    confirmed: boolean
    deleted: string[]
    skipped: string[]
    errors: { src: string; error: string }[]
  }>
  libraryInfo: () => Promise<{ dir: string; copyToLibrary: boolean }>
  openLibrary: () => Promise<void>
  pickLibraryDir: () => Promise<{ tracks: TrackMeta[]; libraryDir: string; copyToLibrary: boolean } | null>

  getSettings: () => Promise<AppSettings>
  setSettings: (patch: Partial<AppSettings>) => Promise<AppSettings>

  minimize: () => Promise<void>
  toggleMaximize: () => Promise<boolean>
  isMaximized: () => Promise<boolean>
  close: () => Promise<void>
  hide: () => Promise<void>

  setAlwaysOnTop: (flag: boolean) => Promise<boolean>
  setMini: (mini: boolean) => Promise<boolean>
  setOpacity: (value: number) => Promise<number>
  setMaterial: (material: AppSettings['material']) => Promise<AppSettings['material']>
  setProgress: (value: number) => Promise<void>

  showItemInFolder: (filePath: string) => Promise<void>
  appInfo: () => Promise<{
    version: string
    electron: string
    chrome: string
    node: string
    nativeBlur: boolean
    platform: string
  }>
  /** 自检：向 DWM 查询圆角/深色/背景材质是否真的生效 */
  windowMaterial: () => Promise<{
    corner: number | null
    dark: number | null
    backdrop: number | null
  }>

  onExternalOpen: (cb: (tracks: TrackMeta[]) => void) => () => void
  /** 允许渲染层广播当前曲目信息给主进程（任务栏/缩略图） */
  updateNowPlaying: (info: { title: string; artist?: string; playing: boolean }) => void
}

const api: AuroraApi = {
  pickFiles: () => ipcRenderer.invoke('dialog:pick-files'),
  pickFolder: () => ipcRenderer.invoke('dialog:pick-folder'),
  tracksFromPaths: (paths) => ipcRenderer.invoke('track:from-paths', paths),
  trackFromUrl: (url) => ipcRenderer.invoke('track:from-url', url),
  probeUrl: (url) => ipcRenderer.invoke('track:probe-url', url),
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return ''
    }
  },

  loadLibrary: () => ipcRenderer.invoke('library:load'),
  importPaths: (paths) => ipcRenderer.invoke('library:import', paths),
  savePlaylist: (entries) => ipcRenderer.invoke('library:save', entries),
  deleteTracks: (payload) => ipcRenderer.invoke('library:delete', payload),
  libraryInfo: () => ipcRenderer.invoke('library:info'),
  openLibrary: () => ipcRenderer.invoke('library:open'),
  pickLibraryDir: () => ipcRenderer.invoke('library:pick-dir'),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),

  minimize: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  close: () => ipcRenderer.invoke('window:close'),
  hide: () => ipcRenderer.invoke('window:hide'),

  setAlwaysOnTop: (flag) => ipcRenderer.invoke('window:set-always-on-top', flag),
  setMini: (mini) => ipcRenderer.invoke('window:set-mini', mini),
  setOpacity: (value) => ipcRenderer.invoke('window:set-opacity', value),
  setMaterial: (material) => ipcRenderer.invoke('window:set-material', material),
  setProgress: (value) => ipcRenderer.invoke('window:set-progress', value),

  showItemInFolder: (filePath) => ipcRenderer.invoke('shell:show-item', filePath),
  appInfo: () => ipcRenderer.invoke('app:info'),
  windowMaterial: () => ipcRenderer.invoke('app:window-material'),

  onExternalOpen: (cb) => {
    const listener = (_e: unknown, tracks: TrackMeta[]): void => cb(tracks)
    ipcRenderer.on('tracks:external-open', listener)
    return () => ipcRenderer.removeListener('tracks:external-open', listener)
  },
  updateNowPlaying: (info) => ipcRenderer.send('now-playing', info)
}

contextBridge.exposeInMainWorld('aurora', api)
