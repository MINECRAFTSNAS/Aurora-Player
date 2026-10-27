import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppSettings, TrackMeta } from '../../shared/types'
import { usePlayer } from './hooks/usePlayer'
import TitleBar from './components/TitleBar'
import UrlBar from './components/UrlBar'
import Playlist from './components/Playlist'
import PlayerBar from './components/PlayerBar'
import SettingsPanel from './components/SettingsPanel'
import TooltipLayer from './components/TooltipLayer'
import './styles/app.css'

type VizVariant = 'bars' | 'wave' | 'both'

export default function App(): React.JSX.Element {
  const player = usePlayer(0.8, 'sequential')
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [appInfo, setAppInfo] = useState<{
    version: string
    electron: string
    chrome: string
    node: string
    nativeBlur: boolean
  } | null>(null)
  const [vizVariant, setVizVariant] = useState<VizVariant>(() => {
    return (localStorage.getItem('aurora.viz') as VizVariant) || 'bars'
  })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [libraryDir, setLibraryDir] = useState('')
  const dragDepth = useRef(0)
  const toastTimer = useRef<number>(0)
  /** 音乐库加载完成前不要保存空歌单，否则会把索引清空 */
  const libraryReady = useRef(false)
  const savePlaylistTimer = useRef<number>(0)

  const { enqueue, queue, index, removeBySrcs, current, playing, playAt } = player

  const notify = useCallback((text: string): void => {
    setToast(text)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 2800)
  }, [])

  /* ---------------- 启动：读设置 + 应用信息 + 音乐库 ---------------- */
  useEffect(() => {
    void (async () => {
      const s = await window.aurora.getSettings()
      setSettings(s)
      player.setVolume(s.volume)
      player.setMode(s.playMode)
      document.body.dataset.material = s.material
      const info = await window.aurora.appInfo()
      setAppInfo(info)
      if (!info.nativeBlur) {
        notify('系统模糊不可用：已降级为半透明纯色界面')
      }
      // 歌单来自音乐库：索引里的顺序 + 库里新增文件。
      // 只恢复列表，不自动播放（避免一开就出声，也绕开浏览器自动播放限制）。
      try {
        const lib = await window.aurora.loadLibrary()
        setLibraryDir(lib.libraryDir)
        if (lib.tracks.length > 0) player.setQueue(lib.tracks)
      } catch (e) {
        notify(`读取音乐库失败：${(e as Error).message}`)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ---------------- 歌单变化时持久化索引 ---------------- */
  useEffect(() => {
    if (queue.length === 0 && !libraryReady.current) return
    libraryReady.current = true
    // 立即发给主进程（主进程侧再做防抖）：少一层延迟，
    // 避免"加完歌马上关窗口"时改动根本没送到主进程
    void window.aurora.savePlaylist(
      queue.map((t) => ({ src: t.src, source: t.source, title: t.title }))
    )
  }, [queue])

  /* ---------------- 迷你模式时把 material 同步到 body ---------------- */
  useEffect(() => {
    if (settings) document.body.dataset.material = settings.material
  }, [settings?.material])

  useEffect(() => {
    localStorage.setItem('aurora.viz', vizVariant)
  }, [vizVariant])

  /* ---------------- 外部"用 Aurora Player 打开" ---------------- */
  useEffect(() => {
    const off = window.aurora.onExternalOpen((tracks) => {
      if (tracks.length === 0) return
      enqueue(tracks, true)
      notify(`已从系统打开 ${tracks.length} 首`)
    })
    return off
  }, [enqueue, notify])

  /* ---------------- 任务栏进度条 + 媒体信息 ---------------- */
  useEffect(() => {
    if (player.duration > 0) {
      void window.aurora.setProgress(player.position / player.duration)
    } else {
      void window.aurora.setProgress(-1)
    }
  }, [player.position, player.duration])

  useEffect(() => {
    document.title = current ? `${current.title} — Aurora Player` : 'Aurora Player'
    if ('mediaSession' in navigator && current) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: current.title,
          artist: current.artist ?? '',
          album: current.album ?? 'Aurora Player',
          artwork: current.cover ? [{ src: current.cover, sizes: '512x512' }] : []
        })
      } catch {
        /* ignore */
      }
    }
  }, [current])

  /* ---------------- 拖放导入（文件 + 文件夹 + 链接） ---------------- */
  const handleDrop = useCallback(
    async (e: React.DragEvent): Promise<void> => {
      e.preventDefault()
      dragDepth.current = 0
      setDragging(false)

      // 1) 拖入的是页面内的链接或文本
      const uri = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain')
      const files = Array.from(e.dataTransfer.files ?? [])

      if (files.length > 0) {
        const paths = files.map((f) => window.aurora.pathForFile(f)).filter(Boolean)
        if (paths.length > 0) {
          const tracks = await window.aurora.tracksFromPaths(paths)
          if (tracks.length > 0) {
            enqueue(tracks, true)
            notify(`已添加 ${tracks.length} 首曲目`)
          } else {
            notify('未在拖入的内容中找到可播放的音频')
          }
          return
        }
      }

      if (uri && /^https?:\/\//i.test(uri.trim())) {
        try {
          const track = await window.aurora.trackFromUrl(uri.trim().split('\n')[0])
          enqueue([track], true)
          notify(`已添加链接：${track.title}`)
        } catch (err) {
          notify(`链接导入失败：${(err as Error).message}`)
        }
        return
      }

      notify('请拖入音频文件、文件夹或 http(s) 链接')
    },
    [enqueue, notify]
  )

  /* ---------------- 更换音乐库目录 ---------------- */
  const changeLibraryDir = useCallback(async (): Promise<void> => {
    try {
      const r = await window.aurora.pickLibraryDir()
      if (!r) return // 用户取消
      setLibraryDir(r.libraryDir)
      player.setQueue(r.tracks)
      notify(`音乐库已切换：${r.libraryDir}（${r.tracks.length} 首）`)
    } catch (e) {
      notify(`更换音乐库失败：${(e as Error).message}`)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notify])

  /* ---------------- 导入动作 ---------------- */
  // pickFiles / pickFolder 已在主进程走音乐库导入：库外文件会被复制进库，
  // 所以这里拿到的曲目重启后依然存在。
  const importFiles = useCallback(async (): Promise<void> => {
    const tracks = await window.aurora.pickFiles()
    if (tracks.length === 0) return
    enqueue(tracks, queue.length === 0)
    notify(`已添加 ${tracks.length} 首曲目（已存入音乐库）`)
  }, [enqueue, notify, queue.length])

  const importFolder = useCallback(async (): Promise<void> => {
    const tracks = await window.aurora.pickFolder()
    if (tracks.length === 0) return
    enqueue(tracks, queue.length === 0)
    notify(`已添加 ${tracks.length} 首曲目（已存入音乐库）`)
  }, [enqueue, notify, queue.length])

  /* ---------------- 删除（连同音乐库文件） ---------------- */
  const handleDeleteSrcs = useCallback(
    async (srcs: string[], names: string[]): Promise<void> => {
      if (srcs.length === 0) return
      try {
        const r = await window.aurora.deleteTracks({ srcs, names })
        if (!r.confirmed) return
        // deleted=真正删掉的文件；skipped=库外路径或网络流，只从歌单移除
        const removed = [...r.deleted, ...r.skipped]
        if (removed.length > 0) removeBySrcs(removed)
        if (r.errors.length > 0) {
          notify(`${r.errors.length} 个文件删除失败：${r.errors[0].error}`)
        } else {
          notify(`已删除 ${r.deleted.length} 首`)
        }
      } catch (err) {
        notify(`删除失败：${(err as Error).message}`)
      }
    },
    [removeBySrcs, notify]
  )

  /* ---------------- 设置变更 ---------------- */
  const changeSettings = useCallback(
    async (patch: Partial<AppSettings>): Promise<void> => {
      const next = await window.aurora.setSettings(patch)
      setSettings(next)
      if (patch.volume !== undefined) player.setVolume(patch.volume)
      if (patch.playMode !== undefined) player.setMode(patch.playMode)
      if (patch.alwaysOnTop !== undefined) await window.aurora.setAlwaysOnTop(patch.alwaysOnTop)
      if (patch.miniMode !== undefined) await window.aurora.setMini(patch.miniMode)
    },
    [player]
  )

  const toggleAlwaysOnTop = useCallback((): void => {
    void changeSettings({ alwaysOnTop: !settings?.alwaysOnTop })
  }, [changeSettings, settings?.alwaysOnTop])

  const toggleMini = useCallback((): void => {
    void changeSettings({ miniMode: !settings?.miniMode })
  }, [changeSettings, settings?.miniMode])

  const mini = settings?.miniMode ?? false
  const showInFolder = useCallback((src: string): void => {
    if (src.startsWith('file://')) {
      void window.aurora.showItemInFolder(decodeURIComponent(src.replace('file:///', '')))
    }
  }, [])

  return (
    <div
      className={`app ${mini ? 'app--mini' : ''} ${dragging ? 'is-dragover' : ''}`}
      onDragEnter={(e) => {
        e.preventDefault()
        dragDepth.current++
        setDragging(true)
      }}
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }}
      onDragLeave={(e) => {
        e.preventDefault()
        dragDepth.current = Math.max(0, dragDepth.current - 1)
        if (dragDepth.current === 0) setDragging(false)
      }}
      onDrop={(e) => void handleDrop(e)}
    >
      <TitleBar
        title={current ? (playing ? `正在播放：${current.title}` : current.title) : '未在播放'}
        isPlaying={playing}
        alwaysOnTop={settings?.alwaysOnTop ?? false}
        miniMode={mini}
        vizVariant={vizVariant}
        nativeBlur={appInfo?.nativeBlur ?? false}
        onToggleAlwaysOnTop={toggleAlwaysOnTop}
        onToggleMini={toggleMini}
        onCycleViz={() => setVizVariant((v) => (v === 'bars' ? 'wave' : v === 'wave' ? 'both' : 'bars'))}
        onOpenSettings={() => setSettingsOpen((v) => !v)}
      />

      {!mini && (
        <main className="content">
          <UrlBar onImportFiles={importFiles} onImportFolder={importFolder} onAddUrl={(t) => enqueue([t], queue.length === 0)} />
          <Playlist
            queue={queue}
            index={index}
            playing={playing}
            libraryDir={libraryDir}
            onPlayAt={playAt}
            onDeleteSrcs={(srcs, names) => void handleDeleteSrcs(srcs, names)}
            onImportFiles={importFiles}
            onImportFolder={importFolder}
            onShowInFolder={showInFolder}
            onOpenLibrary={() => void window.aurora.openLibrary()}
          />
        </main>
      )}

      {mini && (
        <div className="mini-info">
          <div className="mini-info__title" title={current?.title ?? ''}>
            {current?.title ?? '未在播放'}
          </div>
          <div className="mini-info__sub">{[current?.artist, current?.album].filter(Boolean).join(' · ') || 'Aurora Player'}</div>
        </div>
      )}

      <PlayerBar player={player} vizVariant={vizVariant} onToggleMini={toggleMini} />

      {/* 拖放遮罩 */}
      {dragging && (
        <div className="dropzone" aria-hidden>
          <div className="dropzone__card card">
            <div className="dropzone__icon">
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" />
                <path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" />
              </svg>
            </div>
            <div className="dropzone__text">松开即可导入</div>
            <div className="dropzone__hint">支持音频文件、整个文件夹，以及 http(s) 直链</div>
          </div>
        </div>
      )}

      {/* 轻提示 */}
      {toast && <div className="toast card no-drag">{toast}</div>}

      <SettingsPanel
        open={settingsOpen}
        settings={settings}
        appInfo={appInfo}
        vizVariant={vizVariant}
        libraryDir={libraryDir}
        onClose={() => setSettingsOpen(false)}
        onChange={(patch) => void changeSettings(patch)}
        onVizChange={setVizVariant}
        onChangeLibraryDir={() => void changeLibraryDir()}
        onOpenLibrary={() => void window.aurora.openLibrary()}
      />

      {/* 全局悬停提示（portal 渲染，不会被播放栏/列表裁切） */}
      <TooltipLayer />
    </div>
  )
}
