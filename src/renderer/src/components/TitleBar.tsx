import { useEffect, useState } from 'react'
import {
  IconClose,
  IconMaximize,
  IconMinimize,
  IconMini,
  IconPin,
  IconRestore,
  IconSettings,
  IconWaves
} from './Icons'

interface Props {
  title: string
  isPlaying: boolean
  alwaysOnTop: boolean
  miniMode: boolean
  vizVariant: 'bars' | 'wave' | 'both'
  nativeBlur: boolean
  onToggleAlwaysOnTop: () => void
  onToggleMini: () => void
  onCycleViz: () => void
  onOpenSettings: () => void
}

export default function TitleBar({
  title,
  isPlaying,
  alwaysOnTop,
  miniMode,
  vizVariant,
  nativeBlur,
  onToggleAlwaysOnTop,
  onToggleMini,
  onCycleViz,
  onOpenSettings
}: Props): React.JSX.Element {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    void window.aurora.isMaximized().then(setMaximized)
    const onResize = (): void => {
      void window.aurora.isMaximized().then(setMaximized)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const toggleMaximize = async (): Promise<void> => {
    const next = await window.aurora.toggleMaximize()
    setMaximized(next)
  }

  return (
    <header className="titlebar">
      {/* 左侧：应用图标 + 标题，整块可拖拽 */}
      <div className="titlebar__brand drag">
        <span className={`titlebar__mark ${isPlaying ? 'is-playing' : ''}`} aria-hidden>
          <IconWaves width={14} height={14} />
        </span>
        <div className="titlebar__text">
          <span className="titlebar__title">Aurora Player</span>
          <span className="titlebar__subtitle" title={title}>
            {title}
          </span>
        </div>
      </div>

      {/* 中间空白拖拽区 */}
      <div className="titlebar__spacer drag" />

      {/* 右侧：功能按钮 + 窗口按钮，标为 no-drag */}
      <div className="titlebar__actions no-drag">
        <button
          type="button"
          className="icon-btn icon-btn--sm tip"
          data-tip={nativeBlur ? '亚克力模糊已启用' : '系统模糊不可用（降级为纯色）'}
          aria-pressed={nativeBlur}
          onClick={onOpenSettings}
          aria-label="设置"
        >
          <IconSettings width={15} height={15} />
        </button>

        <button
          type="button"
          className="icon-btn icon-btn--sm tip"
          data-tip={`可视化：${vizVariant === 'bars' ? '频谱' : vizVariant === 'wave' ? '波形' : '频谱+波形'}`}
          onClick={onCycleViz}
          aria-label="切换可视化"
        >
          <IconWaves width={15} height={15} />
        </button>

        <button
          type="button"
          className={`icon-btn icon-btn--sm tip ${alwaysOnTop ? 'is-on' : ''}`}
          data-tip={alwaysOnTop ? '取消置顶' : '窗口置顶'}
          aria-pressed={alwaysOnTop}
          onClick={onToggleAlwaysOnTop}
          aria-label="窗口置顶"
        >
          <IconPin width={15} height={15} />
        </button>

        <button
          type="button"
          className={`icon-btn icon-btn--sm tip ${miniMode ? 'is-on' : ''}`}
          data-tip={miniMode ? '退出迷你模式' : '迷你模式'}
          aria-pressed={miniMode}
          onClick={onToggleMini}
          aria-label="迷你模式"
        >
          <IconMini width={15} height={15} />
        </button>
      </div>

      {/* 窗口控制按钮（Win11 样式：46px 宽，关闭键红色悬停） */}
      <div className="caption no-drag">
        <button
          type="button"
          className="caption-btn"
          data-tip="最小化"
          onClick={() => void window.aurora.minimize()}
          aria-label="最小化"
        >
          <IconMinimize width={14} height={14} />
        </button>
        <button
          type="button"
          className="caption-btn"
          data-tip={maximized ? '向下还原' : '最大化'}
          onClick={() => void toggleMaximize()}
          aria-label={maximized ? '还原' : '最大化'}
        >
          {maximized ? <IconRestore width={14} height={14} /> : <IconMaximize width={14} height={14} />}
        </button>
        <button
          type="button"
          className="caption-btn caption-btn--close"
          data-tip="关闭"
          onClick={() => void window.aurora.close()}
          aria-label="关闭"
        >
          <IconClose width={14} height={14} />
        </button>
      </div>
    </header>
  )
}
