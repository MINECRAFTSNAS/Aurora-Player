import { useEffect, useRef, useState } from 'react'
import type { PlayMode, TrackMeta } from '../../../shared/types'
import { formatTime, type PlayerApi } from '../hooks/usePlayer'
import Visualizer from './Visualizer'
import {
  IconMusic,
  IconNext,
  IconPause,
  IconPlay,
  IconPrev,
  IconRepeatAll,
  IconRepeatOne,
  IconShuffle,
  IconStop,
  IconVolume,
  IconVolumeMute,
  IconLoading
} from './Icons'

interface Props {
  player: PlayerApi
  vizVariant: 'bars' | 'wave' | 'both'
  onToggleMini: () => void
}

const MODES: { key: PlayMode; label: string; Icon: (p: React.SVGProps<SVGSVGElement>) => React.JSX.Element }[] = [
  { key: 'sequential', label: '顺序播放', Icon: IconNext },
  { key: 'repeat-all', label: '列表循环', Icon: IconRepeatAll },
  { key: 'repeat-one', label: '单曲循环', Icon: IconRepeatOne },
  { key: 'shuffle', label: '随机播放', Icon: IconShuffle }
]

export default function PlayerBar({ player, vizVariant, onToggleMini }: Props): React.JSX.Element {
  const {
    audioRef,
    current,
    playing,
    loading,
    position,
    duration,
    buffered,
    volume,
    muted,
    mode,
    error,
    play,
    pause,
    stop,
    next,
    prev,
    seek,
    setVolume,
    toggleMute,
    setMode,
    queue
  } = player

  const [seeking, setSeeking] = useState(false)
  const [dragValue, setDragValue] = useState(0)
  const [volOpen, setVolOpen] = useState(false)
  const volTimer = useRef<number>(0)

  const isStream = duration === 0
  const shown = seeking ? dragValue : position
  const pct = duration > 0 ? Math.min(100, (shown / duration) * 100) : 0
  const bufPct = duration > 0 ? Math.min(100, (buffered / duration) * 100) : 0

  /* ---------------- 键盘快捷键（Win11 / 常见播放器习惯） ---------------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null
      // 输入框内不劫持
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return

      switch (e.code) {
        case 'Space':
          e.preventDefault()
          if (playing) pause()
          else play()
          break
        case 'ArrowRight':
          e.preventDefault()
          if (e.shiftKey) next()
          else seek(Math.min(duration || 0, position + 5))
          break
        case 'ArrowLeft':
          e.preventDefault()
          if (e.shiftKey) prev()
          else seek(Math.max(0, position - 5))
          break
        case 'ArrowUp':
          e.preventDefault()
          setVolume(Math.min(1, volume + 0.05))
          break
        case 'ArrowDown':
          e.preventDefault()
          setVolume(Math.max(0, volume - 0.05))
          break
        case 'KeyM':
          toggleMute()
          break
        case 'KeyS':
          stop()
          break
        case 'KeyN':
          next()
          break
        case 'KeyP':
          prev()
          break
        case 'Escape':
          onToggleMini()
          break
        default:
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [playing, duration, position, volume, play, pause, stop, next, prev, seek, setVolume, toggleMute, onToggleMini])

  /* ---------------- 音量浮层延迟关闭 ---------------- */
  const openVol = (): void => {
    window.clearTimeout(volTimer.current)
    setVolOpen(true)
  }
  const closeVolSoon = (): void => {
    window.clearTimeout(volTimer.current)
    volTimer.current = window.setTimeout(() => setVolOpen(false), 320)
  }

  const cover = current?.cover
  const hasTrack = Boolean(current)

  return (
    <footer className="playerbar">
      <div className="playerbar__inner">
        {/* ---------- 左：当前曲目信息 ---------- */}
        <div className="nowplaying">
          <div className={`nowplaying__cover ${playing ? 'is-playing' : ''}`}>
            {cover ? (
              <img src={cover} alt="" />
            ) : (
              <span className="nowplaying__cover-fallback">
                <IconMusic width={22} height={22} />
              </span>
            )}
            {playing && <span className="nowplaying__pulse" aria-hidden />}
          </div>
          <div className="nowplaying__text">
            <div className="nowplaying__title" title={current?.title ?? ''}>
              {current?.title ?? '未在播放'}
            </div>
            <div className="nowplaying__sub" title={current?.artist ?? ''}>
              {error ? (
                <span className="nowplaying__error">{error}</span>
              ) : (
                [current?.artist, current?.album].filter(Boolean).join(' · ') ||
                (hasTrack ? '未知艺术家' : queue.length > 0 ? `列表中有 ${queue.length} 首` : '添加音乐开始播放')
              )}
            </div>
          </div>
        </div>

        {/* ---------- 中：进度 + 传输控件 ---------- */}
        <div className="transport">
          <div className="transport__row">
            <button
              type="button"
              className="icon-btn icon-btn--transport tip"
              data-tip="上一首 (P)"
              onClick={prev}
              disabled={queue.length === 0}
              aria-label="上一首"
            >
              <IconPrev width={18} height={18} />
            </button>

            <button
              type="button"
              className="icon-btn icon-btn--primary tip"
              data-tip={playing ? '暂停 (空格)' : '播放 (空格)'}
              onClick={() => (playing ? pause() : play())}
              disabled={!hasTrack && queue.length === 0}
              aria-label={playing ? '暂停' : '播放'}
            >
              {loading ? (
                <span className="spin">
                  <IconLoading width={20} height={20} />
                </span>
              ) : playing ? (
                <IconPause width={20} height={20} />
              ) : (
                <IconPlay width={20} height={20} />
              )}
            </button>

            <button
              type="button"
              className="icon-btn icon-btn--transport tip"
              data-tip="停止 (S)"
              onClick={stop}
              disabled={!hasTrack}
              aria-label="停止"
            >
              <IconStop width={16} height={16} />
            </button>

            <button
              type="button"
              className="icon-btn icon-btn--transport tip"
              data-tip="下一首 (N)"
              onClick={next}
              disabled={queue.length === 0}
              aria-label="下一首"
            >
              <IconNext width={18} height={18} />
            </button>
          </div>

          <div className="progress no-drag">
            <span className="progress__time">{formatTime(shown)}</span>
            <div className="progress__track-wrap">
              <div className="progress__buffer" style={{ width: `${bufPct}%` }} />
              <input
                className="slider progress__slider"
                type="range"
                min={0}
                max={duration > 0 ? duration : 1}
                step={0.1}
                value={shown}
                disabled={isStream || !hasTrack}
                style={{ ['--pct' as string]: `${pct}%` }}
                onChange={(e) => setDragValue(Number(e.target.value))}
                onPointerDown={() => {
                  setDragValue(position)
                  setSeeking(true)
                }}
                onPointerUp={(e) => {
                  seek(Number((e.target as HTMLInputElement).value))
                  setSeeking(false)
                }}
                onKeyUp={(e) => {
                  seek(Number((e.currentTarget as HTMLInputElement).value))
                  setSeeking(false)
                }}
                aria-label="播放进度"
              />
            </div>
            <span className="progress__time progress__time--total">
              {isStream ? (hasTrack ? '直播' : '--:--') : formatTime(duration)}
            </span>
          </div>
        </div>

        {/* ---------- 右：播放模式 + 音量 ---------- */}
        <div className="controls-right">
          <div className="segment" role="group" aria-label="播放模式">
            {MODES.map(({ key, label, Icon }) => (
              <button
                key={key}
                type="button"
                className="segment__item tip"
                data-tip={label}
                aria-pressed={mode === key}
                onClick={() => setMode(key)}
                aria-label={label}
              >
                <Icon width={15} height={15} />
              </button>
            ))}
          </div>

          <div
            className="volume"
            onMouseEnter={openVol}
            onMouseLeave={closeVolSoon}
          >
            <button
              type="button"
              className="icon-btn tip"
              data-tip={muted ? '音量：已静音（点击恢复 · M）' : `音量 ${Math.round(volume * 100)}%（点击静音 · M）`}
              onClick={toggleMute}
              aria-label={muted ? '取消静音' : '静音'}
            >
              {muted || volume === 0 ? <IconVolumeMute width={17} height={17} /> : <IconVolume width={17} height={17} />}
            </button>

            <div className={`volume__flyout card ${volOpen ? 'is-open' : ''}`}>
              <input
                className="slider slider--sm volume__slider"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={muted ? 0 : volume}
                style={{ ['--pct' as string]: `${(muted ? 0 : volume) * 100}%` }}
                onChange={(e) => setVolume(Number(e.target.value))}
                aria-label="音量"
              />
              <span className="volume__val">{Math.round((muted ? 0 : volume) * 100)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* 可视化条：独立占据播放栏最底部的一条，不再压在按键上 */}
      <div className="playerbar__viz" aria-hidden>
        <Visualizer
          audio={audioRef.current}
          active={playing || loading}
          variant={vizVariant}
          height={vizVariant === 'both' ? 46 : vizVariant === 'wave' ? 26 : 38}
        />
      </div>
    </footer>
  )
}
