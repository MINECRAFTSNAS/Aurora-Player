import { useState } from 'react'
import type { TrackMeta } from '../../../shared/types'
import { IconLink, IconLoading, IconPlus, IconFolderOpen } from './Icons'

interface Props {
  onImportFiles: () => void
  onImportFolder: () => void
  onAddUrl: (track: TrackMeta) => void
}

interface Probe {
  ok: boolean
  contentType: string
  contentLength: number
  acceptRanges: boolean
  error?: string
}

const PRESETS = [
  { name: 'SomaFM Groove Salad', url: 'https://ice1.somafm.com/groovesalad-128-mp3' },
  { name: 'Radio Paradise', url: 'https://stream.radioparadise.com/mp3-192' },
  { name: 'SomaFM Lush', url: 'https://ice1.somafm.com/lush-128-mp3' }
]

export default function UrlBar({ onImportFiles, onImportFolder, onAddUrl }: Props): React.JSX.Element {
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err' | 'info'; text: string } | null>(null)
  const [showPresets, setShowPresets] = useState(false)

  const submit = async (raw?: string): Promise<void> => {
    const value = (raw ?? url).trim()
    if (!value) return
    if (!/^https?:\/\//i.test(value) && !/^file:\/\//i.test(value)) {
      setMsg({ kind: 'err', text: '地址需以 http:// 、https:// 或 file:// 开头' })
      return
    }
    setBusy(true)
    setMsg({ kind: 'info', text: '正在解析音频信息…' })
    try {
      const track = await window.aurora.trackFromUrl(value)
      // 直播流（无法确定时长）也允许加入
      onAddUrl(track)
      setUrl('')
      setMsg({ kind: 'ok', text: `已添加：${track.title}` })
      window.setTimeout(() => setMsg(null), 2600)
    } catch (err) {
      // 解析失败也要允许添加——很多流不返回元数据
      const fallback: TrackMeta = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        source: 'url',
        src: value,
        title: safeName(value),
        isStream: true
      }
      onAddUrl(fallback)
      setUrl('')
      setMsg({ kind: 'info', text: `已作为流地址添加（元数据不可用：${(err as Error).message}）` })
      window.setTimeout(() => setMsg(null), 4000)
    } finally {
      setBusy(false)
    }
  }

  const probe = async (): Promise<void> => {
    const value = url.trim()
    if (!value) return
    setBusy(true)
    const r: Probe = await window.aurora.probeUrl(value)
    setBusy(false)
    if (!r.ok) {
      setMsg({ kind: 'err', text: `无法访问：${r.error || '请求失败'}` })
      return
    }
    const mb = r.contentLength ? `${(r.contentLength / 1048576).toFixed(1)} MB` : '未知大小'
    const kind = r.acceptRanges ? '可拖拽定位' : '直播流 / 不可定位'
    setMsg({ kind: 'info', text: `${r.contentType || '未知类型'} · ${mb} · ${kind}` })
  }

  return (
    <section className="urlbar card">
      <div className="urlbar__row">
        <IconLink width={15} height={15} className="urlbar__icon" />
        <input
          className="input urlbar__input"
          placeholder="粘贴音频直链或电台地址（http/https/file）后按 Enter"
          value={url}
          spellCheck={false}
          onChange={(e) => {
            setUrl(e.target.value)
            if (msg?.kind === 'err') setMsg(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit()
          }}
        />
        <button
          type="button"
          className="btn"
          onClick={() => void probe()}
          disabled={busy || !url.trim()}
          title="检测地址是否可访问"
        >
          检测
        </button>
        <button
          type="button"
          className="btn btn--accent"
          onClick={() => void submit()}
          disabled={busy || !url.trim()}
        >
          {busy ? (
            <span className="spin">
              <IconLoading width={14} height={14} />
            </span>
          ) : (
            <IconPlus width={14} height={14} />
          )}
          导入链接
        </button>
      </div>

      <div className="urlbar__row urlbar__row--secondary">
        <button type="button" className="btn btn--subtle" onClick={onImportFiles}>
          <IconFolderOpen width={14} height={14} />
          导入音乐文件
        </button>
        <button type="button" className="btn btn--subtle" onClick={onImportFolder}>
          导入整个文件夹
        </button>
        <span className="urlbar__drag-hint">也可以直接把文件 / 文件夹拖进窗口</span>
        <div className="urlbar__spacer" />
        <button
          type="button"
          className="btn btn--subtle"
          onClick={() => setShowPresets((v) => !v)}
          aria-expanded={showPresets}
        >
          网络电台示例 {showPresets ? '▲' : '▼'}
        </button>
      </div>

      {showPresets && (
        <div className="urlbar__presets">
          {PRESETS.map((p) => (
            <button
              key={p.url}
              type="button"
              className="chip"
              onClick={() => {
                setUrl(p.url)
                void submit(p.url)
                setShowPresets(false)
              }}
              title={p.url}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}

      {msg && <div className={`urlbar__msg urlbar__msg--${msg.kind}`}>{msg.text}</div>}
    </section>
  )
}

function safeName(url: string): string {
  try {
    const u = new URL(url)
    const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '')
    return last || u.hostname
  } catch {
    return url
  }
}
