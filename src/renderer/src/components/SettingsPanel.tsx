import { useEffect, useState } from 'react'
import type { AppSettings, PlayMode } from '../../../shared/types'
import { IconClose, IconCheck } from './Icons'

interface Props {
  open: boolean
  settings: AppSettings | null
  appInfo: { version: string; electron: string; chrome: string; nativeBlur: boolean } | null
  vizVariant: 'bars' | 'wave' | 'both'
  /** 当前音乐库目录（用于展示） */
  libraryDir?: string
  onClose: () => void
  onChange: (patch: Partial<AppSettings>) => void
  onVizChange: (v: 'bars' | 'wave' | 'both') => void
  /** 更换音乐库目录并重新加载歌单 */
  onChangeLibraryDir: () => void
  onOpenLibrary: () => void
}

const MODE_OPTIONS: { key: PlayMode; label: string }[] = [
  { key: 'sequential', label: '顺序播放' },
  { key: 'repeat-all', label: '列表循环' },
  { key: 'repeat-one', label: '单曲循环' },
  { key: 'shuffle', label: '随机播放' }
]

export default function SettingsPanel({
  open,
  settings,
  appInfo,
  vizVariant,
  libraryDir,
  onClose,
  onChange,
  onVizChange,
  onChangeLibraryDir,
  onOpenLibrary
}: Props): React.JSX.Element | null {
  const [opacity, setOpacity] = useState(settings?.opacity ?? 1)

  useEffect(() => {
    if (settings) setOpacity(settings.opacity)
  }, [settings])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && open) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || !settings) return null

  return (
    <div className="settings-overlay no-drag" onMouseDown={onClose}>
      <aside className="settings card" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="设置">
        <header className="settings__head">
          <h2>设置</h2>
          <button type="button" className="icon-btn icon-btn--sm" onClick={onClose} aria-label="关闭设置">
            <IconClose width={14} height={14} />
          </button>
        </header>

        <div className="settings__body">
          <div className="settings__section-title">外观</div>

          <div className="settings__field">
            <label htmlFor="material">窗口材质</label>
            <div className="segment" id="material" role="group">
              {(
                [
                  ['acrylic', '亚克力'],
                  ['mica', '云母 Mica'],
                  ['none', '纯色']
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className="segment__item"
                  aria-pressed={settings.material === key}
                  onClick={() => onChange({ material: key })}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="settings__field">
            <label htmlFor="opacity">
              窗口不透明度 <span className="settings__val">{Math.round(opacity * 100)}%</span>
            </label>
            <input
              id="opacity"
              className="slider"
              type="range"
              min={0.4}
              max={1}
              step={0.02}
              value={opacity}
              style={{ ['--pct' as string]: `${((opacity - 0.4) / 0.6) * 100}%` }}
              onChange={(e) => setOpacity(Number(e.target.value))}
              onPointerUp={() => onChange({ opacity })}
              onKeyUp={() => onChange({ opacity })}
            />
          </div>

          <div className="settings__field settings__field--row">
            <label htmlFor="top">窗口置顶</label>
            <input
              id="top"
              className="toggle"
              type="checkbox"
              checked={settings.alwaysOnTop}
              onChange={(e) => onChange({ alwaysOnTop: e.target.checked })}
            />
          </div>

          <div className="settings__section-title">可视化</div>

          <div className="settings__field">
            <label htmlFor="viz">频谱样式</label>
            <div className="segment" id="viz" role="group">
              {(
                [
                  ['bars', '频谱柱'],
                  ['wave', '波形'],
                  ['both', '两者都要']
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className="segment__item"
                  aria-pressed={vizVariant === key}
                  onClick={() => onVizChange(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="settings__section-title">播放</div>

          <div className="settings__field">
            <label htmlFor="mode">默认播放模式</label>
            <div className="segment" id="mode" role="group">
              {MODE_OPTIONS.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  className="segment__item"
                  aria-pressed={settings.playMode === m.key}
                  onClick={() => onChange({ playMode: m.key })}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div className="settings__section-title">音乐库</div>

          <div className="settings__field">
            <label>歌曲存放位置（关闭应用后歌单不会丢失）</label>
            <div className="settings__dir">
              <code className="settings__path" title={libraryDir || settings.libraryDir}>
                {libraryDir || settings.libraryDir || '（系统音乐文件夹）'}
              </code>
              <button type="button" className="btn btn--sm" onClick={onChangeLibraryDir}>
                更改
              </button>
              <button type="button" className="btn btn--sm" onClick={onOpenLibrary}>
                打开
              </button>
            </div>
          </div>

          <div className="settings__field settings__field--row">
            <label htmlFor="copy-lib">导入时复制文件到音乐库</label>
            <input
              id="copy-lib"
              className="toggle"
              type="checkbox"
              checked={settings.copyToLibrary}
              onChange={(e) => onChange({ copyToLibrary: e.target.checked })}
            />
          </div>
          <p className="settings__hint">
            关闭后只记录文件路径，原文件被移动或删除时该曲目会失效。
          </p>

          <div className="settings__section-title">快捷键</div>
          <ul className="settings__keys">
            <li>
              <kbd>空格</kbd> 播放 / 暂停
            </li>
            <li>
              <kbd>←</kbd>
              <kbd>→</kbd> 后退 / 前进 5 秒
            </li>
            <li>
              <kbd>Shift</kbd>+<kbd>←</kbd>
              <kbd>→</kbd> 上一首 / 下一首
            </li>
            <li>
              <kbd>↑</kbd>
              <kbd>↓</kbd> 音量
            </li>
            <li>
              <kbd>M</kbd> 静音 · <kbd>S</kbd> 停止 · <kbd>N</kbd> 下一首 · <kbd>P</kbd> 上一首
            </li>
            <li>
              <kbd>Esc</kbd> 迷你模式
            </li>
          </ul>

          <div className="settings__section-title">关于</div>
          <div className="settings__about">
            <div className="settings__about-row">
              <span>版本</span>
              <span>{appInfo?.version ?? '—'}</span>
            </div>
            <div className="settings__about-row">
              <span>Electron</span>
              <span>{appInfo?.electron ?? '—'}</span>
            </div>
            <div className="settings__about-row">
              <span>Chromium</span>
              <span>{appInfo?.chrome ?? '—'}</span>
            </div>
            <div className="settings__about-row">
              <span>原生亚克力</span>
              <span className={appInfo?.nativeBlur ? 'is-ok' : 'is-warn'}>
                {appInfo?.nativeBlur ? (
                  <>
                    <IconCheck width={13} height={13} /> 可用
                  </>
                ) : (
                  '不可用（已降级）'
                )}
              </span>
            </div>
          </div>
        </div>
      </aside>
    </div>
  )
}
