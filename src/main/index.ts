import electron from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, writeFileSync, promises as fsp } from 'node:fs'
import type { Dirent } from 'node:fs'
import { extname, join, basename, resolve, relative, isAbsolute } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { AUDIO_EXTENSIONS, DEFAULT_SETTINGS, type AppSettings, type TrackMeta } from '../shared/types'
import {
  ACCENT_ENABLE_ACRYLICBLURBEHIND,
  ACCENT_ENABLE_BLURBEHIND,
  applyAccent,
  applySystemBackdrop,
  applyWindowChrome,
  disableAccent,
  DWMSBT_NONE,
  DWMSBT_TRANSIENTWINDOW,
  DWMWA_SYSTEMBACKDROP_TYPE,
  DWMWA_USE_IMMERSIVE_DARK_MODE,
  DWMWA_WINDOW_CORNER_PREFERENCE,
  hwndValue,
  queryWindowAttribute,
  toAbgr,
  type NativeBindings
} from './win32'

/**
 * electron-vite 会把 `import { app } from 'electron'` 编译成对
 * __toESM 包装对象的属性访问，在 CJS 下 app 会是 undefined。
 * 用 default 导入再解构，才能拿到真实的 electron 模块。
 */
const { app, BrowserWindow, dialog, ipcMain, net, protocol, session, shell } = electron

// 值解构后，类型也要单独取；否则 BrowserWindow 只能当值用，不能当类型标注
type BrowserWindow = Electron.BrowserWindow
type OpenDialogOptions = Electron.OpenDialogOptions

/* ------------------------------------------------------------------ *
 * koffi：可选原生绑定。缺失或加载失败时优雅降级为"无模糊"模式。
 * koffi 是可选依赖，未安装时直接用独立色卡 UI，功能不受影响。
 * ------------------------------------------------------------------ */
let nativeLib: NativeBindings | null = null
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const koffi = require('koffi')
  const win32 = koffi.load('user32.dll')
  const dwmapi = koffi.load('dwmapi.dll')

  // 注意 HWND 一律用 intptr_t 传整数值：
  // 用 `void *` + Buffer 会被当成"指针的指针"，DWM/user32 直接返回
  // E_INVALIDARG(0x80070057)，所有窗口属性静默失效。
  nativeLib = {
    setWindowCompositionAttribute: win32.func(
      'int __stdcall SetWindowCompositionAttribute(intptr_t hwnd, void *pData)'
    ),
    dwmSetWindowAttribute: dwmapi.func(
      'int __stdcall DwmSetWindowAttribute(intptr_t hwnd, unsigned long attr, void *pv, unsigned long cb)'
    ),
    dwmGetWindowAttribute: dwmapi.func(
      'int __stdcall DwmGetWindowAttribute(intptr_t hwnd, unsigned long attr, void *pv, unsigned long cb)'
    ),
    dwmFlush: dwmapi.func('int __stdcall DwmFlush()')
  }
  console.log('[native] user32/dwmapi bindings loaded')
} catch (err) {
  console.warn('[native] blur bindings unavailable, falling back to solid UI:', (err as Error).message)
}

const WINDOW_SIZES = {
  normal: { width: 1080, height: 720, minWidth: 860, minHeight: 600 },
  mini: { width: 420, height: 480, minWidth: 340, minHeight: 140 }
}

let mainWindow: BrowserWindow | null = null
let settings: AppSettings = { ...DEFAULT_SETTINGS }
let settingsPath = ''
let lastWindowSize = { width: WINDOW_SIZES.normal.width, height: WINDOW_SIZES.normal.height }

/* ------------------------------------------------------------------ *
 * 设置持久化
 * ------------------------------------------------------------------ */
async function loadSettings(): Promise<void> {
  try {
    const raw = await fsp.readFile(settingsPath, 'utf-8')
    settings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
  } catch {
    settings = { ...DEFAULT_SETTINGS }
  }
  // 音乐库默认落在系统「音乐」文件夹（Windows 上即 C:\Users\<用户名>\Music）
  // 环境变量可覆盖，用于自动化测试与便携场景，避免污染用户真实的音乐文件夹
  const override = process.env.AURORA_LIBRARY_DIR
  if (override) settings.libraryDir = override
  else if (!settings.libraryDir) settings.libraryDir = app.getPath('music')
}

let saveTimer: NodeJS.Timeout | null = null
function persistSettings(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    fsp.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8').catch(() => undefined)
  }, 250)
}

/* ------------------------------------------------------------------ *
 * 亚克力材质
 * ------------------------------------------------------------------ */
function applyMaterial(win: BrowserWindow): void {
  if (!nativeLib || process.platform !== 'win32') return
  const hwnd = win.getNativeWindowHandle()

  applyWindowChrome(nativeLib, hwnd)

  // 深色底 + 亚克力染色
  const tint = toAbgr('#14161c', settings.material === 'none' ? 0.94 : 0.6)

  if (settings.material === 'none') {
    disableAccent(nativeLib, hwnd)
    applySystemBackdrop(nativeLib, hwnd, DWMSBT_NONE)
    return
  }

  if (settings.material === 'mica') {
    // Win11 22H2+ 系统 Mica；失败则退回亚克力
    if (applySystemBackdrop(nativeLib, hwnd, DWMSBT_TRANSIENTWINDOW)) {
      return
    }
  }

  // 亚克力：Win11 上仍有效，Win10 1803+ 亦可
  if (!applyAccent(nativeLib, hwnd, ACCENT_ENABLE_ACRYLICBLURBEHIND, tint)) {
    applyAccent(nativeLib, hwnd, ACCENT_ENABLE_BLURBEHIND, tint)
  }
  try {
    nativeLib.dwmFlush()
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ *
 * 窗口
 * ------------------------------------------------------------------ */

/**
 * 落定窗口级偏好（置顶 / 透明度 / 迷你模式）。
 * 必须在窗口 show 且材质写入之后调用 —— 否则 WCA/DWM 的样式重设会把这些设置冲掉，
 * 表现为「置顶按钮点了没反应、重启后置顶状态也丢了」。
 */
function applyWindowPrefs(): void {
  if (!mainWindow) return
  if (settings.alwaysOnTop) {
    // Windows 上不要传 'floating' 之类的层级：电平参数只对 macOS 有意义，
    // 在 Windows 上走默认 TOPMOST 最稳定。
    mainWindow.setAlwaysOnTop(true)
    mainWindow.moveTop()
  } else {
    mainWindow.setAlwaysOnTop(false)
  }
  if (settings.opacity < 1) mainWindow.setOpacity(settings.opacity)
  if (settings.miniMode) setMiniMode(mainWindow, true)
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: lastWindowSize.width,
    height: lastWindowSize.height,
    minWidth: WINDOW_SIZES.normal.minWidth,
    minHeight: WINDOW_SIZES.normal.minHeight,
    show: false,
    frame: false,
    transparent: false, // 亚克力需要不透明窗口 + 系统模糊
    backgroundColor: '#00000000',
    backgroundMaterial: 'acrylic',
    roundedCorners: true,
    thickFrame: true,
    hasShadow: true,
    autoHideMenuBar: true,
    title: 'Aurora Player',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    }
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
    if (process.platform === 'win32' && mainWindow) {
      // 需等窗口真正显示后底层 HWND 才可被合成器接受
      setTimeout(() => {
        if (!mainWindow) return
        applyMaterial(mainWindow)
        // 材质（SetWindowCompositionAttribute / DWM 属性）写入会重设窗口样式，
        // 置顶与透明度必须在这之后再落一次，否则会被静默冲掉。
        applyWindowPrefs()
      }, 60)
    } else {
      applyWindowPrefs()
    }
  })

  mainWindow.on('resize', () => {
    if (!mainWindow || settings.miniMode) return
    const [w, h] = mainWindow.getSize()
    lastWindowSize = { width: w, height: h }
  })

  // 关闭窗口前把还没落盘的歌单同步写掉
  mainWindow.on('close', () => {
    flushPlaylistIndex()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // 外链一律用系统浏览器
  mainWindow.webContents.setWindowOpenHandler((details: Electron.HandlerDetails) => {
    void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // 阻止渲染层被拖去外部地址
  mainWindow.webContents.on('will-navigate', (event: Electron.Event, url: string) => {
    const dev = process.env['ELECTRON_RENDERER_URL']
    if (dev && url.startsWith(dev)) return
    if (url.startsWith('file://')) return
    event.preventDefault()
    void shell.openExternal(url)
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void mainWindow.loadURL(devUrl)
  } else {
    void mainWindow.loadFile(join(__dirname, '../../dist/index.html'))
  }
}

/* ------------------------------------------------------------------ *
 * 元数据解析（music-metadata，可选依赖）
 * ------------------------------------------------------------------ */
async function readTags(filePath: string): Promise<Partial<TrackMeta>> {
  try {
    // music-metadata 是 ESM-only 且有 node/default 两套入口：
    // parseFile 只在 node 入口（lib/index.js）里，所以按路径显式引入。
    const mm = await import('music-metadata/lib/index.js')
    const parsed = await mm.parseFile(filePath, { duration: true, skipCovers: false })
    const cover = parsed.common.picture?.[0]
    let coverUrl: string | undefined
    if (cover) {
      // 限制封面体积，避免超大 base64 卡住渲染进程
      if (cover.data.length <= 4 * 1024 * 1024) {
        coverUrl = `data:${cover.format};base64,${Buffer.from(cover.data).toString('base64')}`
      }
    }
    return {
      title: parsed.common.title?.toString().trim() || undefined,
      artist: parsed.common.artist?.toString().trim() || undefined,
      album: parsed.common.album?.toString().trim() || undefined,
      duration: parsed.format.duration ? Math.round(parsed.format.duration) : undefined,
      cover: coverUrl
    }
  } catch {
    return {}
  }
}

/** 把本地路径转换为 TrackMeta（含元数据） */
async function fileToTrack(filePath: string): Promise<TrackMeta> {
  const abs = resolve(filePath)
  const ext = extname(abs).toLowerCase()
  const tags = await readTags(abs)
  let size: number | undefined
  try {
    size = (await fsp.stat(abs)).size
  } catch {
    size = undefined
  }
  return {
    id: randomUUID(),
    source: 'file',
    src: pathToFileURL(abs).href,
    title: tags.title || basename(abs, ext),
    artist: tags.artist,
    album: tags.album,
    duration: tags.duration,
    cover: tags.cover,
    size,
    isStream: false
  }
}

/** 网络地址 -> TrackMeta（尽力解析，失败也允许导入） */
async function urlToTrack(rawUrl: string): Promise<TrackMeta> {
  const url = rawUrl.trim()
  let title = url
  let duration: number | undefined
  let cover: string | undefined
  let artist: string | undefined
  let album: string | undefined

  const guessName = (): string => {
    try {
      const u = new URL(url)
      const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '')
      return last || u.hostname
    } catch {
      return url
    }
  }

  try {
    const mm = await import('music-metadata')
    // 只读取流头部若干字节，避免把整个远程文件拉下来
    const res = await net.fetch(url, { method: 'GET' })
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
    const head = await readHead(res.body, 256 * 1024) // 前 256KB 足够解析标签
    const parsed = await mm.parseBuffer(head, { mimeType: undefined }, { duration: false, skipCovers: true })
    title = parsed.common.title?.toString().trim() || guessName()
    artist = parsed.common.artist?.toString().trim() || undefined
    album = parsed.common.album?.toString().trim() || undefined
    duration = parsed.format.duration ? Math.round(parsed.format.duration) : undefined
  } catch {
    title = guessName()
  }

  return {
    id: randomUUID(),
    source: 'url',
    src: url,
    title,
    artist,
    album,
    cover,
    duration,
    isStream: duration === undefined
  }
}

/** 从 web 流中读取前 maxBytes 字节后中断，避免下载整个文件 */
async function readHead(stream: ReadableStream<Uint8Array>, maxBytes: number): Promise<Buffer> {
  const reader = stream.getReader()
  const chunks: Buffer[] = []
  let total = 0
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        chunks.push(Buffer.from(value))
        total += value.byteLength
      }
    }
  } finally {
    // 主动取消，断开连接
    void reader.cancel().catch(() => undefined)
  }
  return Buffer.concat(chunks)
}

/* ------------------------------------------------------------------ *
 * 窗口控制
 * ------------------------------------------------------------------ */
function setMiniMode(win: BrowserWindow, mini: boolean): void {
  if (settings.miniMode === mini) return
  const bounds = win.getBounds()

  if (mini) {
    lastWindowSize = { width: bounds.width, height: bounds.height }
    win.setMinimumSize(WINDOW_SIZES.mini.minWidth, WINDOW_SIZES.mini.minHeight)
    win.setResizable(true)
    win.setSize(WINDOW_SIZES.mini.width, WINDOW_SIZES.mini.height, true)
  } else {
    win.setMinimumSize(WINDOW_SIZES.normal.minWidth, WINDOW_SIZES.normal.minHeight)
    win.setSize(
      Math.max(lastWindowSize.width, WINDOW_SIZES.normal.minWidth),
      Math.max(lastWindowSize.height, WINDOW_SIZES.normal.minHeight),
      true
    )
  }
  settings.miniMode = mini
  persistSettings()
}

/* ------------------------------------------------------------------ *
 * IPC
 * ------------------------------------------------------------------ */
function registerIpc(): void {
  ipcMain.handle('dialog:pick-files', async (): Promise<TrackMeta[]> => {
    const opts: OpenDialogOptions = {
      title: '选择音乐文件',
      properties: ['openFile', 'multiSelections', 'dontAddToRecent'],
      filters: [
        { name: '音频文件', extensions: AUDIO_EXTENSIONS.map((e) => e.replace('.', '')) },
        { name: '所有文件', extensions: ['*'] }
      ]
    }
    const res = mainWindow
      ? await dialog.showOpenDialog(mainWindow, opts)
      : await dialog.showOpenDialog(opts)
    if (res.canceled || res.filePaths.length === 0) return []
    // 走音乐库导入：必要时把文件复制进库，保证重启后还在
    const imported = await importIntoLibrary(res.filePaths)
    return imported.tracks
  })

  ipcMain.handle('dialog:pick-folder', async (): Promise<TrackMeta[]> => {
    const opts: OpenDialogOptions = {
      title: '选择音乐文件夹',
      properties: ['openDirectory', 'dontAddToRecent']
    }
    const res = mainWindow
      ? await dialog.showOpenDialog(mainWindow, opts)
      : await dialog.showOpenDialog(opts)
    if (res.canceled || res.filePaths.length === 0) return []
    const imported = await importIntoLibrary(res.filePaths)
    return imported.tracks
  })

  ipcMain.handle('track:from-paths', async (_e, paths: string[]): Promise<TrackMeta[]> => {
    // 拖放 / 命令行打开 都走音乐库导入，确保复制进库后可持久化
    const imported = await importIntoLibrary(paths)
    return imported.tracks
  })

  /* ---------------- 音乐库 ---------------- */
  ipcMain.handle('library:load', async () => {
    const result = await loadLibrary()
    return { ...result, copyToLibrary: settings.copyToLibrary }
  })

  ipcMain.handle('library:import', async (_e, paths: string[]) => {
    const r = await importIntoLibrary(paths)
    return {
      tracks: r.tracks,
      copied: r.copied,
      failed: r.failed,
      libraryDir: r.libraryDir
    }
  })

  ipcMain.handle('library:save', (_e, entries: PlaylistEntry[]) => {
    if (!Array.isArray(entries)) return false
    const safe = entries.filter(
      (e): e is PlaylistEntry =>
        !!e && typeof e.src === 'string' && (e.source === 'file' || e.source === 'url')
    )
    scheduleSavePlaylist(safe)
    return true
  })

  /**
   * 删除歌曲：先弹系统确认框（删除文件不可撤销），
   * 且只允许删音乐库内的文件。
   */
  ipcMain.handle('library:delete', async (_e, payload: { srcs: string[]; names?: string[] }) => {
    const srcs = Array.isArray(payload?.srcs) ? payload.srcs : []
    if (srcs.length === 0) return { confirmed: false, deleted: [], skipped: [], errors: [] }

    const names = (payload.names ?? []).slice(0, 6)
    const more = srcs.length - names.length
    const detail =
      (names.length ? names.map((n) => `· ${n}`).join('\n') : '') +
      (more > 0 ? `\n… 以及另外 ${more} 首` : '')

    // 只有真的位于音乐库里的文件才需要确认；网络流/库外路径仅从歌单移除
    const deletable = srcs.filter((s) => {
      const p = srcToPath(s)
      return !!p && isInsideLibrary(p)
    })

    if (deletable.length === 0) {
      return { confirmed: true, deleted: [], skipped: srcs, errors: [] }
    }

    const opts: Electron.MessageBoxOptions = {
      type: 'warning',
      buttons: ['删除文件', '取消'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      title: '删除歌曲',
      message: `将从音乐库中永久删除 ${deletable.length} 个文件？`,
      detail: `${detail}\n\n文件会从磁盘上移除（${libraryRoot()}），此操作不可撤销。`
    }
    const box = mainWindow ? await dialog.showMessageBox(mainWindow, opts) : await dialog.showMessageBox(opts)
    if (box.response !== 0) return { confirmed: false, deleted: [], skipped: [], errors: [] }

    const r = await deleteLibraryFiles(srcs)
    return { confirmed: true, ...r }
  })

  ipcMain.handle('library:info', async () => {
    const dir = await ensureLibrary()
    return { dir, copyToLibrary: settings.copyToLibrary }
  })

  ipcMain.handle('library:open', async () => {
    const dir = await ensureLibrary()
    void shell.openPath(dir)
  })

  ipcMain.handle('library:pick-dir', async () => {
    const opts: OpenDialogOptions = {
      title: '选择音乐库文件夹',
      defaultPath: libraryRoot(),
      properties: ['openDirectory', 'createDirectory', 'dontAddToRecent']
    }
    const res = mainWindow
      ? await dialog.showOpenDialog(mainWindow, opts)
      : await dialog.showOpenDialog(opts)
    if (res.canceled || res.filePaths.length === 0) return null
    settings.libraryDir = res.filePaths[0]
    persistSettings()
    const result = await loadLibrary()
    return { ...result, copyToLibrary: settings.copyToLibrary }
  })

  ipcMain.handle('track:from-url', async (_e, url: string): Promise<TrackMeta> => urlToTrack(url))

  ipcMain.handle('track:probe-url', async (_e, url: string) => {
    try {
      const head = await net.fetch(url, { method: 'HEAD' })
      return {
        ok: head.ok,
        contentType: head.headers.get('content-type') || '',
        contentLength: Number(head.headers.get('content-length') || 0),
        acceptRanges: (head.headers.get('accept-ranges') || '').includes('bytes')
      }
    } catch (err) {
      return { ok: false, contentType: '', contentLength: 0, acceptRanges: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('settings:get', () => settings)

  ipcMain.handle('settings:set', (_e, patch: Partial<AppSettings>) => {
    settings = { ...settings, ...patch }
    persistSettings()
    if (mainWindow) applyMaterial(mainWindow)
    return settings
  })

  ipcMain.handle('window:minimize', () => mainWindow?.minimize())
  ipcMain.handle('window:toggle-maximize', () => {
    if (!mainWindow) return false
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
    return mainWindow.isMaximized()
  })
  ipcMain.handle('window:is-maximized', () => mainWindow?.isMaximized() ?? false)
  ipcMain.handle('window:close', () => mainWindow?.close())
  ipcMain.handle('window:hide', () => mainWindow?.hide())

  ipcMain.handle('window:set-always-on-top', (_e, flag: boolean) => {
    settings.alwaysOnTop = flag
    if (mainWindow) {
      mainWindow.setAlwaysOnTop(flag)
      if (flag) mainWindow.moveTop()
    }
    persistSettings()
    // 返回真实状态，而不是回显参数——否则"设置失败"会被误报为成功
    return mainWindow ? mainWindow.isAlwaysOnTop() : false
  })

  ipcMain.handle('window:set-mini', (_e, mini: boolean) => {
    if (mainWindow) setMiniMode(mainWindow, mini)
    return settings.miniMode
  })

  ipcMain.handle('window:set-opacity', (_e, value: number) => {
    settings.opacity = Math.max(0.4, Math.min(1, value))
    mainWindow?.setOpacity(settings.opacity)
    persistSettings()
    return settings.opacity
  })

  ipcMain.handle('window:set-material', (_e, material: AppSettings['material']) => {
    settings.material = material
    persistSettings()
    if (mainWindow) applyMaterial(mainWindow)
    return settings.material
  })

  ipcMain.handle('window:set-progress', (_e, value: number) => {
    if (!mainWindow) return
    mainWindow.setProgressBar(value >= 0 && value <= 1 ? value : -1)
  })

  ipcMain.handle('shell:show-item', (_e, filePath: string) => {
    if (filePath && existsSync(filePath)) shell.showItemInFolder(filePath)
  })

  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    nativeBlur: Boolean(nativeLib),
    platform: process.platform
  }))

  /**
   * 自检：向 DWM 查询窗口圆角/深色/背景材质是否真的生效。
   * 用于自动化验证亚克力链路，不参与正常播放逻辑。
   */
  ipcMain.handle('app:window-material', () => {
    if (!nativeLib || !mainWindow) return { corner: null, dark: null, backdrop: null }
    const hwnd = mainWindow.getNativeWindowHandle()
    return {
      corner: queryWindowAttribute(nativeLib, hwnd, DWMWA_WINDOW_CORNER_PREFERENCE),
      dark: queryWindowAttribute(nativeLib, hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE),
      backdrop: queryWindowAttribute(nativeLib, hwnd, DWMWA_SYSTEMBACKDROP_TYPE)
    }
  })
}

function isAudio(p: string): boolean {
  return AUDIO_EXTENSIONS.includes(extname(p).toLowerCase() as (typeof AUDIO_EXTENSIONS)[number])
}

/** 递归扫描文件夹，最多 3000 个文件，深度 5 层 */
async function scanFolder(root: string, depth = 0, budget = { n: 3000 }): Promise<TrackMeta[]> {
  if (depth > 5 || budget.n <= 0) return []
  const out: TrackMeta[] = []
  let entries: Dirent[]
  try {
    entries = await fsp.readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  // 按名称排序：文件系统返回顺序不保证稳定，未排序会让"重启后顺序变了"
  entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  for (const entry of entries) {
    if (budget.n <= 0) break
    const full = join(root, entry.name)
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.')) continue
      out.push(...(await scanFolder(full, depth + 1, budget)))
    } else if (isAudio(full)) {
      budget.n--
      out.push(await fileToTrack(full))
    }
  }
  return out
}

/* ------------------------------------------------------------------ *
 * 音乐库：让歌单在重启后依然存在
 *
 * 设计：
 * - 歌曲实际存放在「音乐库」目录（默认系统的 音乐 文件夹）
 * - 索引（顺序 / URL 项）存 userData/playlist.json
 * - 启动时先按索引恢复，再把库里新出现的文件补到末尾
 * - 导入外部文件时复制进库（可关），否则重启后文件被移走就失效
 * ------------------------------------------------------------------ */
interface PlaylistEntry {
  src: string
  source: 'file' | 'url'
  title?: string
}

const PLAYLIST_VERSION = 1

/**
 * 歌单写盘防抖。默认 250ms；自动化测试会把它调大，
 * 以便确定性地模拟"改动还没落盘就退出"的时机。
 */
const SAVE_DEBOUNCE = (() => {
  const raw = Number(process.env.AURORA_SAVE_DEBOUNCE)
  return Number.isFinite(raw) && raw >= 0 ? raw : 250
})()

function playlistIndexPath(): string {
  return join(app.getPath('userData'), 'playlist.json')
}

/** 音乐库根目录（settings.libraryDir 为空时用系统「音乐」文件夹） */
function libraryRoot(): string {
  return settings.libraryDir || app.getPath('music')
}

async function ensureLibrary(): Promise<string> {
  const dir = libraryRoot()
  try {
    await fsp.mkdir(dir, { recursive: true })
  } catch {
    /* 无权限时至少不崩，后续读写会各自报错 */
  }
  return dir
}

/** 目标路径是否位于音乐库内（删除操作的安全边界） */
function isInsideLibrary(targetPath: string): boolean {
  const root = resolve(libraryRoot())
  const target = resolve(targetPath)
  const rel = relative(root, target)
  return !!rel && !rel.startsWith('..') && !isAbsolute(rel)
}

function srcToPath(src: string): string | null {
  if (src.startsWith('file://')) {
    try {
      return fileURLToPath(src)
    } catch {
      return null
    }
  }
  return isAbsolute(src) ? src : null
}

async function readPlaylistIndex(): Promise<PlaylistEntry[]> {
  try {
    const raw = await fsp.readFile(playlistIndexPath(), 'utf-8')
    const data = JSON.parse(raw) as { version?: number; entries?: PlaylistEntry[] }
    if (!Array.isArray(data.entries)) return []
    return data.entries.filter(
      (e): e is PlaylistEntry =>
        !!e && typeof e.src === 'string' && (e.source === 'file' || e.source === 'url')
    )
  } catch {
    return []
  }
}

let saveIndexTimer: NodeJS.Timeout | null = null
/** 还没落盘的歌单；退出前必须同步写完，否则"刚加完就关"会丢掉顺序 */
let pendingPlaylist: PlaylistEntry[] | null = null

function serializePlaylist(entries: PlaylistEntry[]): string {
  return JSON.stringify({ version: PLAYLIST_VERSION, entries }, null, 2)
}

async function writePlaylistIndex(entries: PlaylistEntry[]): Promise<void> {
  try {
    await fsp.writeFile(playlistIndexPath(), serializePlaylist(entries), 'utf-8')
  } catch {
    /* 写失败不影响播放 */
  }
}

/** 防抖保存，避免频繁写盘 */
function scheduleSavePlaylist(entries: PlaylistEntry[]): void {
  pendingPlaylist = entries
  if (saveIndexTimer) clearTimeout(saveIndexTimer)
  saveIndexTimer = setTimeout(() => {
    saveIndexTimer = null
    const data = pendingPlaylist
    pendingPlaylist = null
    if (data) void writePlaylistIndex(data)
  }, SAVE_DEBOUNCE)
}

/**
 * 立即把待写入的歌单同步落盘。
 * 关闭窗口时防抖定时器还来不及触发，不同步 flush 就会丢掉最后一次改动
 * （表现为"重启后顺序不对"或最后加的几首不见了）。
 */
function flushPlaylistIndex(): void {
  if (saveIndexTimer) {
    clearTimeout(saveIndexTimer)
    saveIndexTimer = null
  }
  const data = pendingPlaylist
  pendingPlaylist = null
  if (!data) return
  try {
    // 这里必须用同步写：quit 期间异步写不保证能完成
    writeFileSync(playlistIndexPath(), serializePlaylist(data), 'utf-8')
  } catch {
    /* ignore */
  }
}

/**
 * 读取音乐库：索引里的条目（校验文件仍在）+ 库中新增的文件。
 * 重新解析元数据，这样即便文件被替换、封面变化也能反映出来。
 */
async function loadLibrary(): Promise<{ tracks: TrackMeta[]; libraryDir: string }> {
  const dir = await ensureLibrary()
  const entries = await readPlaylistIndex()
  const out: TrackMeta[] = []
  const seen = new Set<string>()

  for (const e of entries) {
    if (e.source === 'url') {
      if (seen.has(e.src)) continue
      seen.add(e.src)
      out.push({
        id: `url:${e.src}`,
        source: 'url',
        src: e.src,
        title: e.title || e.src,
        isStream: true
      })
      continue
    }
    const p = srcToPath(e.src)
    if (!p) continue
    try {
      await fsp.access(p)
    } catch {
      continue // 文件已被删除或移走，跳过
    }
    if (seen.has(e.src)) continue
    seen.add(e.src)
    out.push(await fileToTrack(p))
  }

  // 库里新增（或索引缺失）的文件补到末尾
  const scanned = await scanFolder(dir)
  for (const t of scanned) {
    if (seen.has(t.src)) continue
    seen.add(t.src)
    out.push(t)
  }

  return { tracks: out, libraryDir: dir }
}

/**
 * 导入路径：文件直接收，文件夹递归扫描；
 * 若在库外且开启 copyToLibrary，则复制进库根目录（重名时自动加后缀）。
 */
async function importIntoLibrary(
  paths: string[]
): Promise<{ tracks: TrackMeta[]; copied: number; failed: string[]; libraryDir: string }> {
  const dir = await ensureLibrary()
  const candidates: string[] = []
  const failed: string[] = []

  for (const p of paths) {
    let st
    try {
      st = await fsp.stat(p)
    } catch {
      failed.push(p)
      continue
    }
    if (st.isDirectory()) {
      const found = await scanFolder(p)
      for (const t of found) {
        const fp = srcToPath(t.src)
        if (fp) candidates.push(fp)
      }
    } else if (isAudio(p)) {
      candidates.push(p)
    } else {
      failed.push(p)
    }
  }

  const tracks: TrackMeta[] = []
  let copied = 0

  for (const file of Array.from(new Set(candidates))) {
    let finalPath = file
    // 库外的文件复制进来，保证重启后仍可播放
    if (settings.copyToLibrary && !isInsideLibrary(file)) {
      const target = await uniqueTarget(dir, basename(file))
      try {
        await fsp.copyFile(file, target)
        copied++
        finalPath = target
      } catch {
        failed.push(file)
        continue
      }
    }
    tracks.push(await fileToTrack(finalPath))
  }

  return { tracks, copied, failed, libraryDir: dir }
}

/** 库内重名时生成 "name (1).ext" 形式的可用路径 */
async function uniqueTarget(dir: string, fileName: string): Promise<string> {
  const ext = extname(fileName)
  const stem = basename(fileName, ext)
  let candidate = join(dir, fileName)
  let i = 1
  while (existsSync(candidate)) {
    candidate = join(dir, `${stem} (${i})${ext}`)
    i++
    if (i > 999) break
  }
  return candidate
}

/**
 * 删除音乐库里的文件。只允许删除库内文件——库外路径一律拒绝，
 * 避免误删用户其他位置的文件。
 */
async function deleteLibraryFiles(
  srcs: string[]
): Promise<{ deleted: string[]; skipped: string[]; errors: { src: string; error: string }[] }> {
  const deleted: string[] = []
  const skipped: string[] = []
  const errors: { src: string; error: string }[] = []

  for (const src of srcs) {
    const p = srcToPath(src)
    if (!p) {
      skipped.push(src)
      continue
    }
    if (!isInsideLibrary(p)) {
      skipped.push(src)
      continue
    }
    try {
      await fsp.unlink(p)
      deleted.push(src)
    } catch (e) {
      errors.push({ src, error: (e as Error).message })
    }
  }

  return { deleted, skipped, errors }
}

/* ------------------------------------------------------------------ *
 * 生命周期
 * ------------------------------------------------------------------ */
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
    openFromArgv(argv)
  })

  app.setAppUserModelId('com.aurora.player')

  // 允许渲染层直接 <audio src="file:///..."> （本地文件导入必需）
  protocol.registerSchemesAsPrivileged([
    { scheme: 'aurora', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true } }
  ])

  void app.whenReady().then(async () => {
    settingsPath = join(app.getPath('userData'), 'settings.json')
    await loadSettings()

    // 放宽 CSP 以允许 file:// 和远程音频源
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self' 'unsafe-inline' data: blob: aurora: file:; media-src * data: blob: file:; img-src * data: blob: file:; connect-src * data: blob: file:"
          ]
        }
      })
    })

    registerIpc()
    createWindow()

    // 窗口偏好统一在 ready-to-show → applyMaterial 之后落定（见 createWindow 内），
    // 这里不再重复设置：此时窗口还没显示，置顶会被后续材质调用覆盖。

    openFromArgv(process.argv)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  // 兜底：无论从哪条路径退出，都先把歌单刷盘
  app.on('before-quit', () => {
    flushPlaylistIndex()
  })

  app.on('window-all-closed', () => {
    flushPlaylistIndex()
    if (process.platform !== 'darwin') app.quit()
  })
}

/** 支持 "用 Aurora Player 打开" / 拖到 exe 图标上 / 命令行传文件 */
function openFromArgv(argv: string[]): void {
  const files = argv
    .slice(1)
    .filter((a) => !a.startsWith('-') && !a.includes('index.js') && existsSync(a) && isAudio(a))
  if (files.length === 0 || !mainWindow) return
  const send = async (): Promise<void> => {
    const tracks = await Promise.all(files.map(fileToTrack))
    mainWindow?.webContents.send('tracks:external-open', tracks)
  }
  if (mainWindow.webContents.isLoading()) {
    mainWindow.webContents.once('did-finish-load', () => void send())
  } else {
    void send()
  }
}

export {}
