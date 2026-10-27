import { useEffect, useRef } from 'react'
import { drawSpectrum, drawWaveform, useAudioAnalyser } from '../hooks/useAudioAnalyser'

interface Props {
  audio: HTMLAudioElement | null
  active: boolean
  /** 'bars' = 频谱柱（对称），'wave' = 示波器波形，'both' = 波形在上、频谱在下 */
  variant?: 'bars' | 'wave' | 'both'
  height?: number
  className?: string
}

export default function Visualizer({
  audio,
  active,
  variant = 'bars',
  height = 92,
  className = ''
}: Props): React.JSX.Element {
  const barsRef = useRef<HTMLCanvasElement | null>(null)
  const waveRef = useRef<HTMLCanvasElement | null>(null)
  const frame = useAudioAnalyser(audio, active, {
    bands: 56,
    wavePoints: 160,
    smoothing: 0.74,
    gain: 1.2
  })
  const frameRef = useRef(frame)
  frameRef.current = frame

  useEffect(() => {
    let raf = 0
    const render = (): void => {
      const f = frameRef.current
      if (f) {
        if (barsRef.current) {
          drawSpectrum(barsRef.current, f, {
            // 只向上生长（不再以中轴上下对称）
            mirror: false,
            color: ['rgba(76,194,255,0.95)', 'rgba(160,108,255,0.9)'],
            gap: 2
          })
        }
        if (waveRef.current) {
          drawWaveform(waveRef.current, f, 'rgba(255,255,255,0.42)')
        }
      }
      raf = requestAnimationFrame(render)
    }
    raf = requestAnimationFrame(render)
    return () => cancelAnimationFrame(raf)
  }, [variant])

  if (variant === 'wave') {
    return (
      <div className={`viz viz--wave ${className}`} style={{ height }}>
        <canvas ref={waveRef} className="viz__canvas" />
      </div>
    )
  }

  if (variant === 'both') {
    return (
      <div className={`viz viz--both ${className}`} style={{ height }}>
        <canvas ref={waveRef} className="viz__canvas viz__canvas--wave" />
        <canvas ref={barsRef} className="viz__canvas viz__canvas--bars" />
      </div>
    )
  }

  return (
    <div className={`viz viz--bars ${className}`} style={{ height }}>
      <canvas ref={barsRef} className="viz__canvas" />
    </div>
  )
}
