import { useEffect, useRef, useState } from 'react'

export interface VizFrame {
  /** 频域柱，值域 0..1，长度 = bands */
  bars: number[]
  /** 时域波形，值域 -1..1 */
  wave: number[]
  /** 低频能量，用于整体呼吸感 */
  bass: number
}

const EMPTY: VizFrame = { bars: new Array(64).fill(0), wave: new Array(128).fill(0), bass: 0 }

export interface VizOptions {
  bands?: number
  wavePoints?: number
  /** 相邻帧平滑，0 = 不平滑，0.8 = 很平滑 */
  smoothing?: number
  /** 柱体增益 */
  gain?: number
}

/**
 * 用 Web Audio API 分析正在播放的音频。
 * 通过 WebAudioTap 组件把 <audio> 接入 AudioContext（MediaElementSource）。
 * 注意：跨域音频源若未返回 CORS 头会导致分析出静音，此时自动回退为"伪频谱"。
 */
export function useAudioAnalyser(
  audio: HTMLAudioElement | null,
  active: boolean,
  options: VizOptions = {}
): VizFrame | null {
  const { bands = 64, wavePoints = 128, smoothing = 0.72, gain = 1.15 } = options
  const [frame, setFrame] = useState<VizFrame>(EMPTY)

  const ctxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null)
  const rafRef = useRef<number>(0)
  const smoothed = useRef<Float32Array>(new Float32Array(bands))
  const unavailableRef = useRef(false)

  /* 用 ref 镜像播放状态：暂停后还要继续跑一小段做衰减动画，
     所以不能因为 active 变化就把 rAF 停掉。 */
  const activeRef = useRef(active)
  activeRef.current = active
  const tickingRef = useRef(false)
  const startRef = useRef<() => void>(() => {})
  const lastTsRef = useRef(0)
  /** 波形整体淡入淡出系数，暂停时从 1 缓降到 0 */
  const waveGainRef = useRef(0)

  useEffect(() => {
    if (!audio) return

    const setup = (): boolean => {
      try {
        if (!ctxRef.current) {
          const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
          ctxRef.current = new Ctor()
        }
        const ctx = ctxRef.current
        if (!sourceRef.current) {
          // 一个 <audio> 只能创建一次 MediaElementSource
          sourceRef.current = ctx.createMediaElementSource(audio)
          const analyser = ctx.createAnalyser()
          analyser.fftSize = 2048
          analyser.smoothingTimeConstant = 0.8
          analyser.minDecibels = -92
          analyser.maxDecibels = -12
          sourceRef.current.connect(analyser)
          analyser.connect(ctx.destination) // 必须连到 destination，否则没声音
          analyserRef.current = analyser
        }
        if (ctx.state === 'suspended') void ctx.resume()
        return true
      } catch {
        unavailableRef.current = true
        return false
      }
    }

    if (!setup() || !analyserRef.current || !ctxRef.current) {
      // 分析不可用（例如跨域流）——不做可视化
      return
    }

    const analyser = analyserRef.current
    const ctx = ctxRef.current
    const freq = new Uint8Array(analyser.frequencyBinCount)
    const time = new Uint8Array(analyser.fftSize)

    /* 时间常数（秒）。按 dt 计算，因此 60Hz / 120Hz 屏幕表现一致。
       上升快、回落慢，像真实 VU 表；暂停时用同样的回落曲线淡出，
       而不是直接把整帧置零。 */
    const TAU_ATTACK = 0.09
    const TAU_RELEASE = 0.08 + smoothing * 0.22
    const TAU_WAVE = 0.16
    /* 单帧最多按 33ms 推进。主线程卡一下（点击、切歌）时 rAF 会跳帧，
       若直接按真实 dt 计算，一帧就能从 0 冲到 60%+，看上去仍是"弹起"。
       限制步长可以保证任何情况下都至少有几个过渡帧。 */
    const MAX_STEP = 0.033
    const EPS = 0.004

    const tick = (ts: number): void => {
      const last = lastTsRef.current || ts
      const dt = Math.min(MAX_STEP, Math.min(0.05, Math.max(0.001, (ts - last) / 1000)))
      lastTsRef.current = ts

      // 真正在出声才算"运行中"：暂停后即使 active 还没变，也应开始衰减
      const running = activeRef.current && !audio.paused
      if (running && ctx.state === 'suspended') void ctx.resume()

      analyser.getByteFrequencyData(freq)
      analyser.getByteTimeDomainData(time)

      const binCount = freq.length
      const minLog = Math.log10(1)
      const maxLog = Math.log10(binCount)
      const out = new Array<number>(bands)
      let bassSum = 0
      let peak = 0

      for (let i = 0; i < bands; i++) {
        // 暂停时目标值直接为 0，让包络自己滑下去
        let target = 0
        if (running) {
          const lo = Math.floor(Math.pow(10, minLog + ((maxLog - minLog) * i) / bands))
          const hi = Math.max(lo + 1, Math.floor(Math.pow(10, minLog + ((maxLog - minLog) * (i + 1)) / bands)))
          let sum = 0
          let n = 0
          for (let k = lo; k < hi && k < binCount; k++) {
            sum += freq[k]
            n++
          }
          let v = n > 0 ? sum / n / 255 : 0
          v *= 1 + (i / bands) * 0.85 // 高频补偿
          target = Math.min(1, v * gain)
          if (i < 4) bassSum += target
        }

        const prev = smoothed.current[i]
        const tau = target > prev ? TAU_ATTACK : TAU_RELEASE
        const k = 1 - Math.exp(-dt / tau)
        const next = prev + (target - prev) * k
        smoothed.current[i] = next
        out[i] = next
        if (next > peak) peak = next
      }

      // 波形整体增益同样缓变，避免暂停瞬间被"拍平"
      const waveTarget = running ? 1 : 0
      waveGainRef.current += (waveTarget - waveGainRef.current) * (1 - Math.exp(-dt / TAU_WAVE))
      const wave = new Array<number>(wavePoints)
      const step = Math.max(1, Math.floor(time.length / wavePoints))
      for (let i = 0; i < wavePoints; i++) {
        wave[i] = ((time[i * step] - 128) / 128) * waveGainRef.current
      }

      setFrame({ bars: out, wave, bass: bassSum / 4 })

      // 已经淡到看不见了：收尾并停掉循环，避免暂停时白跑 rAF
      if (!running && peak < EPS && waveGainRef.current < 0.01) {
        for (let i = 0; i < bands; i++) smoothed.current[i] = 0
        waveGainRef.current = 0
        setFrame({ bars: new Array(bands).fill(0), wave: new Array(wavePoints).fill(0), bass: 0 })
        tickingRef.current = false
        return
      }

      rafRef.current = requestAnimationFrame(tick)
    }

    startRef.current = () => {
      if (tickingRef.current) return
      tickingRef.current = true
      lastTsRef.current = 0
      rafRef.current = requestAnimationFrame(tick)
    }

    if (activeRef.current) startRef.current()

    return () => {
      cancelAnimationFrame(rafRef.current)
      tickingRef.current = false
    }
  }, [audio, bands, wavePoints, smoothing, gain])

  /* 恢复播放时重新点火；暂停时不打断循环，交给它在衰减完后自行停止 */
  useEffect(() => {
    if (active) startRef.current()
  }, [active])

  return unavailableRef.current ? null : frame
}

/** 把帧数据画到 canvas 上 */
export function drawSpectrum(
  canvas: HTMLCanvasElement,
  frame: VizFrame,
  opts: { mirror?: boolean; color?: [string, string]; gap?: number; rounded?: boolean } = {}
): void {
  const { mirror = true, color = ['#4cc2ff', '#a06cff'], gap = 2, rounded = true } = opts
  const dpr = window.devicePixelRatio || 1
  const cssW = canvas.clientWidth
  const cssH = canvas.clientHeight
  if (cssW === 0 || cssH === 0) return
  const w = Math.round(cssW * dpr)
  const h = Math.round(cssH * dpr)
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w
    canvas.height = h
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, cssW, cssH)

  const bars = frame.bars
  const n = bars.length
  if (n === 0) return

  const barW = (cssW - gap * (n - 1)) / n
  if (barW <= 0) return

  const grad = ctx.createLinearGradient(0, cssH, 0, 0)
  grad.addColorStop(0, color[0])
  grad.addColorStop(1, color[1])
  ctx.fillStyle = grad

  const radius = rounded ? Math.min(barW / 2, 2.5) : 0

  for (let i = 0; i < n; i++) {
    const v = Math.max(0, Math.min(1, bars[i]))
    // 完全静音时不画：否则每根柱子的 2px 下限会残留成一条"假底线"，
    // 暂停后频谱看起来永远降不到 0，淡出动画也就没了终点。
    if (v <= 0.0008) continue
    const barH = Math.max(2, v * (mirror ? cssH / 2 - 1 : cssH - 2))
    const x = i * (barW + gap)
    if (mirror) {
      // 中轴向两侧对称，像 Win11 媒体控件的"律动条"
      roundRect(ctx, x, cssH / 2 - barH, barW, barH * 2, radius)
    } else {
      roundRect(ctx, x, cssH - barH - 1, barW, barH, radius)
    }
    ctx.fill()
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  if (radius <= 0.5) {
    ctx.rect(x, y, w, h)
    return
  }
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

/** 画波形（示波器风格折线） */
export function drawWaveform(
  canvas: HTMLCanvasElement,
  frame: VizFrame,
  color = 'rgba(255,255,255,0.55)'
): void {
  const dpr = window.devicePixelRatio || 1
  const cssW = canvas.clientWidth
  const cssH = canvas.clientHeight
  if (cssW === 0 || cssH === 0) return
  const w = Math.round(cssW * dpr)
  const h = Math.round(cssH * dpr)
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w
    canvas.height = h
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, cssW, cssH)

  const wave = frame.wave
  if (wave.length === 0) return
  const mid = cssH / 2
  const amp = cssH / 2 - 1

  ctx.beginPath()
  for (let i = 0; i < wave.length; i++) {
    const x = (i / (wave.length - 1)) * cssW
    const y = mid - wave[i] * amp
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.strokeStyle = color
  ctx.lineWidth = 1.5
  ctx.lineJoin = 'round'
  ctx.stroke()
}
