import { useCallback, useEffect, useRef, useState } from 'react'
import type { PlayMode, TrackMeta } from '../../../shared/types'

type RepeatMode = PlayMode

export interface PlayerState {
  current: TrackMeta | null
  index: number
  playing: boolean
  loading: boolean
  /** 秒 */
  position: number
  /** 秒；0 = 直播流/未知 */
  duration: number
  buffered: number
  volume: number
  muted: boolean
  error: string | null
}

export interface PlayerApi extends PlayerState {
  audioRef: React.RefObject<HTMLAudioElement | null>
  play: () => void
  pause: () => void
  toggle: () => void
  stop: () => void
  next: () => void
  prev: () => void
  seek: (seconds: number) => void
  seekBy: (delta: number) => void
  setVolume: (v: number) => void
  toggleMute: () => void
  setMode: (mode: RepeatMode) => void
  mode: RepeatMode
  queue: TrackMeta[]
  setQueue: React.Dispatch<React.SetStateAction<TrackMeta[]>>
  playAt: (index: number) => void
  enqueue: (tracks: TrackMeta[], playNow?: boolean) => void
  removeAt: (index: number) => void
  /** 按 src 批量移除（删除文件后同步歌单）；若删到当前曲目则停止播放 */
  removeBySrcs: (srcs: string[]) => void
  clear: () => void
}

/** Media Session：让 Windows 任务栏/媒体键能控制播放器 */
function pushMediaSession(track: TrackMeta | null, playing: boolean, handlers: {
  play: () => void
  pause: () => void
  next: () => void
  prev: () => void
  seek: (t: number) => void
}): void {
  const ms = navigator.mediaSession
  if (!ms) return
  try {
    ms.metadata = new MediaMetadata({
      title: track?.title ?? '未在播放',
      artist: track?.artist ?? '',
      album: track?.album ?? 'Aurora Player',
      artwork: track?.cover ? [{ src: track.cover, sizes: '512x512' }] : []
    })
    ms.playbackState = playing ? 'playing' : 'paused'
    ms.setActionHandler('play', handlers.play)
    ms.setActionHandler('pause', handlers.pause)
    ms.setActionHandler('nexttrack', handlers.next)
    ms.setActionHandler('previoustrack', handlers.prev)
    ms.setActionHandler('seekto', (d) => {
      if (typeof d.seekTime === 'number') handlers.seek(d.seekTime)
    })
    ms.setActionHandler('seekbackward', () => handlers.seek(-1 as unknown as number))
    ms.setActionHandler('seekforward', () => handlers.seek(-1 as unknown as number))
  } catch {
    /* 某些环境不支持，忽略 */
  }
}

export function usePlayer(initialVolume = 0.8, initialMode: PlayMode = 'sequential'): PlayerApi {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [queue, setQueue] = useState<TrackMeta[]>([])
  const [index, setIndex] = useState(-1)
  const [playing, setPlaying] = useState(false)
  const [loading, setLoading] = useState(false)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(0)
  const [buffered, setBuffered] = useState(0)
  const [volume, setVolumeState] = useState(initialVolume)
  const [muted, setMuted] = useState(false)
  const [mode, setModeState] = useState<RepeatMode>(initialMode)
  const [error, setError] = useState<string | null>(null)

  // 用 ref 镜像最新值，供音频事件回调读取，避免闭包陈旧
  const modeRef = useRef(mode)
  const queueRef = useRef(queue)
  const indexRef = useRef(index)
  const current = index >= 0 && index < queue.length ? queue[index] : null
  const currentRef = useRef<TrackMeta | null>(null)

  useEffect(() => {
    modeRef.current = mode
  }, [mode])
  useEffect(() => {
    queueRef.current = queue
  }, [queue])
  useEffect(() => {
    indexRef.current = index
  }, [index])
  useEffect(() => {
    currentRef.current = current
  }, [current])

  /* ---------------- 播放控制 ---------------- */
  const playAt = useCallback(
    (i: number): void => {
      const list = queueRef.current
      if (i < 0 || i >= list.length) return
      setIndex(i)
      setError(null)
    },
    []
  )

  const next = useCallback(
    (auto = false): void => {
      const list = queueRef.current
      if (list.length === 0) return
      const i = indexRef.current
      if (modeRef.current === 'shuffle') {
        if (list.length === 1) {
          playAt(0)
          return
        }
        let r = i
        while (r === i) r = Math.floor(Math.random() * list.length)
        playAt(r)
        return
      }
      const last = i >= list.length - 1
      if (last) {
        if (modeRef.current === 'sequential' && auto) {
          // 顺序播放到底即停止
          setPlaying(false)
          playAt(0)
          return
        }
        playAt(0)
        return
      }
      playAt(i + 1)
    },
    [playAt]
  )

  const prev = useCallback((): void => {
    const list = queueRef.current
    if (list.length === 0) return
    const audio = audioRef.current
    // Win11/常见播放器行为：播放超过 3 秒按"回到开头"，否则上一首
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0
      return
    }
    const i = indexRef.current
    if (i <= 0) playAt(modeRef.current === 'shuffle' ? Math.floor(Math.random() * list.length) : list.length - 1)
    else playAt(i - 1)
  }, [playAt])

  const play = useCallback((): void => {
    const audio = audioRef.current
    if (!audio) return
    if (!currentRef.current) {
      if (queueRef.current.length > 0) {
        playAt(0)
        return
      }
      return
    }
    void audio.play().catch((err: Error) => setError(err.message))
  }, [playAt])

  const pause = useCallback((): void => {
    audioRef.current?.pause()
  }, [])

  const toggle = useCallback((): void => {
    if (audioRef.current?.paused === false) pause()
    else play()
  }, [play, pause])

  const stop = useCallback((): void => {
    const audio = audioRef.current
    if (!audio) return
    audio.pause()
    audio.currentTime = 0
    setPosition(0)
  }, [])

  const seek = useCallback((seconds: number): void => {
    const audio = audioRef.current
    if (!audio) return
    if (!Number.isFinite(audio.duration) || audio.duration === 0) return
    audio.currentTime = Math.max(0, Math.min(audio.duration, seconds))
    setPosition(audio.currentTime)
  }, [])

  const seekBy = useCallback(
    (delta: number): void => {
      const audio = audioRef.current
      if (!audio) return
      seek(audio.currentTime + delta)
    },
    [seek]
  )

  const setVolume = useCallback((v: number): void => {
    const clamped = Math.max(0, Math.min(1, v))
    setVolumeState(clamped)
    setMuted(clamped === 0)
  }, [])

  const toggleMute = useCallback((): void => setMuted((m) => !m), [])

  const setMode = useCallback((m: RepeatMode): void => setModeState(m), [])

  const enqueue = useCallback(
    (tracks: TrackMeta[], playNow = false): void => {
      if (tracks.length === 0) return
      setQueue((prevList) => {
        const seen = new Set(prevList.map((t) => t.src))
        const fresh = tracks.filter((t) => !seen.has(t.src))
        const list = [...prevList, ...fresh]
        if (playNow && fresh.length > 0) {
          const firstNew = prevList.length
          queueRef.current = list
          setTimeout(() => playAt(firstNew), 0)
        }
        return list
      })
    },
    [playAt]
  )

  const removeAt = useCallback(
    (i: number): void => {
      setQueue((list) => {
        const nextList = list.filter((_, k) => k !== i)
        if (i < indexRef.current) setIndex((v) => v - 1)
        else if (i === indexRef.current) {
          if (nextList.length === 0) {
            setIndex(-1)
            setPlaying(false)
          } else if (i >= nextList.length) setIndex(nextList.length - 1)
        }
        return nextList
      })
    },
    []
  )

  const clear = useCallback((): void => {
    setQueue([])
    setIndex(-1)
    setPlaying(false)
    setPosition(0)
    setDuration(0)
  }, [])

  const removeBySrcs = useCallback((srcs: string[]): void => {
    if (!srcs || srcs.length === 0) return
    const doomed = new Set(srcs)
    setQueue((list) => {
      const cur = currentRef.current
      const nextList = list.filter((t) => !doomed.has(t.src))
      queueRef.current = nextList
      if (cur && doomed.has(cur.src)) {
        // 正在播放的曲目被删掉了，停下来，避免继续指向已删除的文件
        setIndex(-1)
        setPlaying(false)
        setPosition(0)
        setDuration(0)
      } else if (cur) {
        const ni = nextList.findIndex((t) => t.src === cur.src)
        if (ni >= 0) setIndex(ni)
      }
      return nextList
    })
  }, [])

  /* ---------------- 挂载 <audio> 并绑定事件 ---------------- */
  useEffect(() => {
    const audio = new Audio()
    audio.preload = 'metadata'
    audio.crossOrigin = 'anonymous'
    audio.volume = initialVolume
    audioRef.current = audio

    const onPlay = (): void => setPlaying(true)
    const onPause = (): void => setPlaying(false)
    const onWaiting = (): void => setLoading(true)
    const onPlaying = (): void => setLoading(false)
    const onCanPlay = (): void => setLoading(false)

    const onTime = (): void => setPosition(audio.currentTime)
    const onDur = (): void => {
      // 直播流 duration 为 Infinity，按 0 处理表示不可 seek
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0)
    }
    const onProgress = (): void => {
      try {
        if (audio.buffered.length > 0) setBuffered(audio.buffered.end(audio.buffered.length - 1))
      } catch {
        /* ignore */
      }
    }
    const onEnded = (): void => {
      if (modeRef.current === 'repeat-one') {
        audio.currentTime = 0
        void audio.play()
        return
      }
      next(true)
    }
    const onError = (): void => {
      setLoading(false)
      const code = audio.error?.code
      const msg =
        code === 1
          ? '播放被中止'
          : code === 2
            ? '网络错误，无法加载'
            : code === 3
              ? '解码失败，该格式可能不被支持'
              : code === 4
                ? '音频格式不支持或地址无法访问'
                : '未知播放错误'
      setError(msg)
    }

    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('waiting', onWaiting)
    audio.addEventListener('playing', onPlaying)
    audio.addEventListener('canplay', onCanPlay)
    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('durationchange', onDur)
    audio.addEventListener('loadedmetadata', onDur)
    audio.addEventListener('progress', onProgress)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('error', onError)

    return () => {
      audio.pause()
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('waiting', onWaiting)
      audio.removeEventListener('playing', onPlaying)
      audio.removeEventListener('canplay', onCanPlay)
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('durationchange', onDur)
      audio.removeEventListener('loadedmetadata', onDur)
      audio.removeEventListener('progress', onProgress)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('error', onError)
      audioRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ---------------- 切歌：写入 src 并自动播放 ---------------- */
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    if (!current) {
      audio.removeAttribute('src')
      audio.load()
      setPosition(0)
      setDuration(0)
      return
    }
    setLoading(true)
    setError(null)
    setPosition(0)
    setDuration(current.duration ?? 0)
    // 直播流加破缓存参数，避免长期播放卡死
    audio.src = current.isStream ? withCacheBust(current.src) : current.src
    audio.load()
    void audio.play().catch((err: Error) => {
      setLoading(false)
      if (err.name !== 'AbortError') setError(err.message)
    })
  }, [current])

  /* ---------------- 音量 / 静音 ---------------- */
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.volume = volume
    audio.muted = muted
  }, [volume, muted])

  /* ---------------- Media Session ---------------- */
  useEffect(() => {
    pushMediaSession(current, playing, { play, pause, next: () => next(), prev, seek })
  }, [current, playing, play, pause, next, prev, seek])

  return {
    audioRef,
    current,
    index,
    playing,
    loading,
    position,
    duration,
    buffered,
    volume,
    muted,
    mode,
    error,
    queue,
    setQueue,
    play,
    pause,
    toggle,
    stop,
    next: () => next(),
    prev,
    seek,
    seekBy,
    setVolume,
    toggleMute,
    setMode,
    playAt,
    enqueue,
    removeAt,
    removeBySrcs,
    clear
  }
}

function withCacheBust(url: string): string {
  if (/^file:/i.test(url)) return url
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}_=${Date.now()}`
}

export function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const total = Math.floor(sec)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}
