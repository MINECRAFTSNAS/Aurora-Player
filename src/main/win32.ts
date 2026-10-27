/**
 * 原生亚克力背景实现（Windows 10 1803+ / Windows 11）
 *
 * 原理：通过 SetWindowCompositionAttribute (user32.dll) 设置
 *   ACCENT_ENABLE_ACRYLICBLURBEHIND = 4  -> 亚克力模糊
 *   ACCENT_ENABLE_BLURBEHIND      = 3  -> 纯模糊（老系统回退）
 * 并配合 DwmSetWindowAttribute 打开 Win11 的圆角、深色标题栏与 Mica 背景。
 *
 * 注意：所有指针都由 koffi 直接管理，程序侧只传"可写 Buffer"。
 */

export const ACCENT_DISABLED = 0
export const ACCENT_ENABLE_BLURBEHIND = 3
export const ACCENT_ENABLE_ACRYLICBLURBEHIND = 4
export const ACCENT_FLAG_GRADIENT = 2

export const WCA_ACCENT_POLICY = 19
export const DWMWA_USE_IMMERSIVE_DARK_MODE = 20
export const DWMWA_WINDOW_CORNER_PREFERENCE = 33
export const DWMWA_SYSTEMBACKDROP_TYPE = 38
export const DWMWCP_ROUND = 2

export const DWMSBT_AUTO = 0
export const DWMSBT_NONE = 1
export const DWMSBT_MAINWINDOW = 2 // Mica
export const DWMSBT_TRANSIENTWINDOW = 3 // Acrylic
export const DWMSBT_TABBEDWINDOW = 4 // Mica Alt

/** koffi 加载后的函数句柄：调用时传 Buffer 作为指针参数 */
export type NativeFn = (...args: unknown[]) => number

export interface NativeBindings {
  setWindowCompositionAttribute: NativeFn
  dwmSetWindowAttribute: NativeFn
  dwmGetWindowAttribute: NativeFn
  dwmFlush: NativeFn
}

/**
 * HWND 必须按 `intptr_t`（整数值）传给 Win32，
 * 不能用 `void *` + Buffer —— 后者会被当作指针的指针，DWM 直接返回
 * E_INVALIDARG(0x80070057)，属性静默设置失败。
 *
 * 而 koffi 解构 HWND 时，Buffer 里存的是指针值（小端 8 字节），
 * 所以取数值再传给 intptr_t。
 */
export function hwndValue(handle: Buffer): bigint {
  if (handle.length >= 8) return handle.readBigUInt64LE(0)
  return BigInt(handle.readUInt32LE(0))
}

/**
 * 把 #RRGGBB + 不透明度 编码为 native 需要的 32 位整数。
 * SetWindowCompositionAttribute 的 gradientColor 是 AABBGGRR（小端 ABGR）。
 */
export function toAbgr(hex: string, alpha = 0.62): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  const rgb = m ? parseInt(m[1], 16) : 0x1a1a1a
  const r = (rgb >> 16) & 0xff
  const g = (rgb >> 8) & 0xff
  const b = rgb & 0xff
  const a = Math.max(0, Math.min(255, Math.round(alpha * 255)))
  return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0
}

/** Windows 11 窗口圆角 + 深色模式标题栏（老系统静默失败） */
export function applyWindowChrome(native: NativeBindings, hwnd: Buffer): void {
  const h = hwndValue(hwnd)
  const corner = Buffer.alloc(4)
  corner.writeInt32LE(DWMWCP_ROUND, 0)
  try {
    native.dwmSetWindowAttribute(h, DWMWA_WINDOW_CORNER_PREFERENCE, corner, 4)
  } catch {
    /* Win10 无此属性 */
  }

  const dark = Buffer.alloc(4)
  dark.writeInt32LE(1, 0)
  try {
    native.dwmSetWindowAttribute(h, DWMWA_USE_IMMERSIVE_DARK_MODE, dark, 4)
  } catch {
    /* ignore */
  }
}

/** Win11 22H2+ 的系统背景材质：Mica / Acrylic。返回是否设置成功 */
export function applySystemBackdrop(native: NativeBindings, hwnd: Buffer, backdrop: number): boolean {
  const buf = Buffer.alloc(4)
  buf.writeInt32LE(backdrop, 0)
  try {
    return native.dwmSetWindowAttribute(hwndValue(hwnd), DWMWA_SYSTEMBACKDROP_TYPE, buf, 4) === 0
  } catch {
    return false
  }
}

/** 查询 DWM 窗口属性（自检用）。返回 null 表示该属性在当前系统不可用 */
export function queryWindowAttribute(native: NativeBindings, hwnd: Buffer, attr: number): number | null {
  const out = Buffer.alloc(4)
  try {
    const hr = native.dwmGetWindowAttribute(hwndValue(hwnd), attr, out, 4)
    return hr === 0 ? out.readInt32LE(0) : null
  } catch {
    return null
  }
}

/**
 * 设置亚克力模糊。
 *
 * SetWindowCompositionAttribute 在 Win7 上是未文档化 API，Win10 1803+ 支持
 * ACCENT_ENABLE_ACRYLICBLURBEHIND。它接受一个 WINDOWCOMPOSITIONATTRIBDATA
 * 结构体，其中 pvData 指向 ACCENT_POLICY —— 结构体内含指针，
 * 交给 koffi 声明成真正的 struct 最稳妥（手写内存布局容易踩指针语义的坑）。
 *
 * 失败时返回 false，由调用方决定是否回退。
 */
export function applyAccent(native: NativeBindings, hwnd: Buffer, state: number, tint: number): boolean {
  try {
    const data = makeCompositionData(state, tint)
    return native.setWindowCompositionAttribute(hwndValue(hwnd), data) !== 0
  } catch {
    return false
  }
}

/**
 * 用 koffi 构造 WINDOWCOMPOSITIONATTRIBDATA 实例。
 * 只有拿到 koffi 时才可用；其余情况抛错并由上层降级。
 */
function makeCompositionData(state: number, tint: number): unknown {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const koffi = require('koffi')
  const ACCENT_POLICY = koffi.struct('ACCENT_POLICY', {
    AccentState: 'int',
    AccentFlags: 'int',
    GradientColor: 'uint32',
    AnimationId: 'int'
  })
  const DATA = koffi.struct('WINDOWCOMPOSITIONATTRIBDATA', {
    Attrib: 'int',
    pvData: koffi.pointer(ACCENT_POLICY),
    cbData: 'uint64'
  })
  const policy = {
    AccentState: state,
    AccentFlags: ACCENT_FLAG_GRADIENT,
    GradientColor: tint >>> 0,
    AnimationId: 0
  }
  return { Attrib: WCA_ACCENT_POLICY, pvData: policy, cbData: 16 }
}

export function disableAccent(native: NativeBindings, hwnd: Buffer): void {
  applyAccent(native, hwnd, ACCENT_DISABLED, 0)
}
