import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TrackMeta } from '../../../shared/types'
import { formatTime } from '../hooks/usePlayer'
import { IconMusic, IconSearch, IconTrash, IconFolderOpen, IconPlay } from './Icons'

interface Props {
  queue: TrackMeta[]
  index: number
  playing: boolean
  /** 音乐库目录，仅用于展示 */
  libraryDir?: string
  onPlayAt: (i: number) => void
  /** 删除（会连同音乐库里的文件一起删，由上层弹确认框） */
  onDeleteSrcs: (srcs: string[], names: string[]) => void
  onImportFiles: () => void
  onImportFolder: () => void
  onShowInFolder: (src: string) => void
  onOpenLibrary: () => void
}

export default function Playlist({
  queue,
  index,
  playing,
  libraryDir,
  onPlayAt,
  onDeleteSrcs,
  onImportFiles,
  onImportFolder,
  onShowInFolder,
  onOpenLibrary
}: Props): React.JSX.Element {
  const [query, setQuery] = useState('')
  /** 多选集合：存 src，便于直接对应文件 */
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const listRef = useRef<HTMLDivElement | null>(null)
  const activeRef = useRef<HTMLButtonElement | null>(null)
  /** Shift 连选的锚点（在 filtered 中的下标） */
  const anchorRef = useRef<number | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const items = queue.map((t, i) => ({ t, i }))
    if (!q) return items
    return items.filter(
      ({ t }) =>
        t.title.toLowerCase().includes(q) ||
        (t.artist ?? '').toLowerCase().includes(q) ||
        (t.album ?? '').toLowerCase().includes(q)
    )
  }, [queue, query])

  const totalSec = useMemo(() => queue.reduce((sum, t) => sum + (t.duration ?? 0), 0), [queue])

  // 队列变化后，清掉已经不在列表里的选中项
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev
      const alive = new Set(queue.map((t) => t.src))
      const next = new Set([...prev].filter((s) => alive.has(s)))
      return next.size === prev.size ? prev : next
    })
  }, [queue])

  // 切歌时把当前项滚入视野（只在列表容器内滚动）
  useEffect(() => {
    const el = activeRef.current
    const container = listRef.current
    if (!el || !container) return
    const cTop = container.scrollTop
    const cBottom = cTop + container.clientHeight
    const eTop = el.offsetTop
    const eBottom = eTop + el.offsetHeight
    if (eTop < cTop + 8) container.scrollTo({ top: eTop - 8, behavior: 'smooth' })
    else if (eBottom > cBottom - 8) container.scrollTo({ top: eBottom - container.clientHeight + 8, behavior: 'smooth' })
  }, [index])

  /* ---------------- 多选逻辑 ---------------- */
  const toggleSelect = useCallback((src: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(src)) next.delete(src)
      else next.add(src)
      return next
    })
  }, [])

  const selectRange = useCallback(
    (toIdx: number): void => {
      const from = anchorRef.current
      if (from === null) return
      const [a, b] = from <= toIdx ? [from, toIdx] : [toIdx, from]
      setSelected((prev) => {
        const next = new Set(prev)
        for (let k = a; k <= b; k++) {
          const item = filtered[k]
          if (item) next.add(item.t.src)
        }
        return next
      })
    },
    [filtered]
  )

  const handleRowClick = useCallback(
    (e: React.MouseEvent, i: number, src: string): void => {
      if (e.ctrlKey || e.metaKey) {
        toggleSelect(src)
        anchorRef.current = i
        return
      }
      if (e.shiftKey) {
        selectRange(i)
        return
      }
      setSelected(new Set())
      anchorRef.current = i
      onPlayAt(i)
    },
    [onPlayAt, selectRange, toggleSelect]
  )

  const deleteSelected = useCallback((): void => {
    if (selected.size === 0) return
    const tracks = queue.filter((t) => selected.has(t.src))
    onDeleteSrcs(
      tracks.map((t) => t.src),
      tracks.map((t) => t.title)
    )
  }, [selected, queue, onDeleteSrcs])

  /* Delete / Backspace 删除选中项（输入框内不劫持） */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      if (selected.size === 0) return
      e.preventDefault()
      deleteSelected()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected, deleteSelected])

  const selectAll = useCallback((): void => {
    setSelected(new Set(filtered.map(({ t }) => t.src)))
  }, [filtered])

  return (
    <section className="playlist card">
      <div className="playlist__head">
        <div className="playlist__title">
          <IconMusic width={15} height={15} />
          <span>播放列表</span>
          <span className="badge">{queue.length}</span>
          {totalSec > 0 && <span className="playlist__total">{formatPlaylistTotal(totalSec)}</span>}
        </div>
        <div className="playlist__tools">
          <button type="button" className="btn btn--subtle tip" data-tip="添加文件（会复制进音乐库）" onClick={onImportFiles}>
            <IconFolderOpen width={14} height={14} />
            文件
          </button>
          <button type="button" className="btn btn--subtle tip" data-tip="扫描文件夹并导入" onClick={onImportFolder}>
            文件夹
          </button>
          <button type="button" className="btn btn--subtle tip" data-tip="打开音乐库文件夹" onClick={onOpenLibrary}>
            音乐库
          </button>
          <button
            type="button"
            className="btn btn--subtle tip"
            data-tip={selected.size > 0 ? `删除选中的 ${selected.size} 首（含文件）` : '先按住 Ctrl 点选歌曲'}
            onClick={deleteSelected}
            disabled={selected.size === 0}
          >
            <IconTrash width={14} height={14} />
          </button>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="playlist__selbar">
          <span>已选 {selected.size} 首</span>
          <button type="button" className="btn btn--subtle btn--sm" onClick={selectAll}>
            全选
          </button>
          <button type="button" className="btn btn--subtle btn--sm" onClick={() => setSelected(new Set())}>
            取消选择
          </button>
          <span className="playlist__selhint">按 Delete 删除（同时删除文件）</span>
        </div>
      )}

      <div className="playlist__search no-drag">
        <IconSearch width={14} height={14} className="playlist__search-icon" />
        <input
          className="input playlist__input"
          placeholder="搜索标题、艺术家或专辑…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          spellCheck={false}
        />
        {query && (
          <button type="button" className="playlist__clear-q" onClick={() => setQuery('')} aria-label="清除搜索">
            ×
          </button>
        )}
      </div>

      <div className="playlist__list" ref={listRef} role="listbox" aria-label="播放列表" aria-multiselectable="true">
        {filtered.length === 0 && (
          <div className="playlist__empty">
            {queue.length === 0 ? (
              <>
                <IconMusic width={30} height={30} />
                <p>音乐库还是空的</p>
                <p className="playlist__empty-hint">
                  拖入音乐文件、点击「文件 / 文件夹」，或把歌直接放进音乐库文件夹
                  {libraryDir ? <><br />{libraryDir}</> : null}
                </p>
                <div className="playlist__empty-actions">
                  <button type="button" className="btn btn--accent" onClick={onImportFiles}>
                    添加音乐文件
                  </button>
                  <button type="button" className="btn" onClick={onImportFolder}>
                    扫描文件夹
                  </button>
                  <button type="button" className="btn" onClick={onOpenLibrary}>
                    打开音乐库
                  </button>
                </div>
              </>
            ) : (
              <p className="playlist__empty-hint">没有匹配 "{query}" 的曲目</p>
            )}
          </div>
        )}

        {filtered.map(({ t, i }) => {
          const isActive = i === index
          const isSelected = selected.has(t.src)
          return (
            <div
              key={t.id}
              className={`track ${isActive ? 'is-active' : ''} ${isSelected ? 'is-selected' : ''}`}
              role="option"
              aria-selected={isSelected}
            >
              <button
                ref={isActive ? activeRef : undefined}
                type="button"
                className="track__main"
                onClick={(e) => handleRowClick(e, i, t.src)}
                onDoubleClick={() => onShowInFolder(t.src)}
                title={`${t.title}${t.artist ? ' — ' + t.artist : ''}\nCtrl+点击 多选`}
              >
                <span className="track__index">
                  {isActive ? (
                    <span className={`track__eq ${playing ? 'is-playing' : ''}`} aria-hidden>
                      <i />
                      <i />
                      <i />
                    </span>
                  ) : isSelected ? (
                    <IconPlay width={11} height={11} />
                  ) : (
                    String(i + 1).padStart(2, '0')
                  )}
                </span>

                <span className="track__cover" aria-hidden>
                  {t.cover ? (
                    <img src={t.cover} alt="" loading="lazy" />
                  ) : (
                    <IconMusic width={14} height={14} />
                  )}
                </span>

                <span className="track__meta">
                  <span className="track__name">{t.title}</span>
                  <span className="track__sub">
                    {[t.artist, t.album].filter(Boolean).join(' · ') || (t.source === 'url' ? '网络流' : '未知艺术家')}
                  </span>
                </span>

                <span className="track__dur">{t.duration ? formatTime(t.duration) : t.source === 'url' ? '直播' : '--:--'}</span>
              </button>

              <button
                type="button"
                className="track__remove tip"
                data-tip="删除这首（连同音乐库里的文件）"
                onClick={(e) => {
                  e.stopPropagation()
                  // 与 Delete 键同一条路径：先确认，再删文件并从歌单移除
                  onDeleteSrcs([t.src], [t.title])
                }}
                aria-label="删除"
              >
                <IconTrash width={13} height={13} />
              </button>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function formatPlaylistTotal(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.round((sec % 3600) / 60)
  return h > 0 ? `${h} 小时 ${m} 分` : `${m} 分钟`
}
