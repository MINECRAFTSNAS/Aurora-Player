/** 共享类型定义（主进程 / 预加载 / 渲染进程共用） */

export const AUDIO_EXTENSIONS = [
  '.mp3',
  '.flac',
  '.wav',
  '.m4a',
  '.aac',
  '.ogg',
  '.oga',
  '.opus',
  '.wma',
  '.aiff',
  '.aif',
  '.ape',
  '.alac',
  '.mp4',
  '.webm',
  '.mka'
] as const

export interface TrackMeta {
  /** 稳定唯一 id */
  id: string
  /** 'file' = 本地文件, 'url' = 网络地址 */
  source: 'file' | 'url'
  /** 本地绝对路径，或网络 URL */
  src: string
  /** 展示用文件名 / URL */
  title: string
  artist?: string
  album?: string
  /** 秒，0 表示未知（直播流） */
  duration?: number
  /** 封面 dataURL */
  cover?: string
  /** 文件字节大小 */
  size?: number
  /** 是否判定为直播流（不可 seek） */
  isStream?: boolean
}

export interface AppSettings {
  alwaysOnTop: boolean
  miniMode: boolean
  volume: number
  muted: boolean
  playMode: PlayMode
  /** 透明度 0.4 - 1 */
  opacity: number
  /** 亚克力材质：acrylic（模糊） / mica（Win11 云母） */
  material: 'acrylic' | 'mica' | 'none'
  /**
   * 音乐库目录。启动时从这里读取歌曲，导入的歌曲也会被复制进来，
   * 因此关闭应用后歌单不会丢失。空字符串表示用系统「音乐」文件夹。
   */
  libraryDir: string
  /** 导入外部文件时是否复制到音乐库（关掉则只记录路径，不落盘） */
  copyToLibrary: boolean
}

export type PlayMode = 'sequential' | 'repeat-one' | 'repeat-all' | 'shuffle'

export const DEFAULT_SETTINGS: AppSettings = {
  alwaysOnTop: false,
  miniMode: false,
  volume: 0.8,
  muted: false,
  playMode: 'sequential',
  opacity: 1,
  material: 'acrylic',
  libraryDir: '',
  copyToLibrary: true
}
