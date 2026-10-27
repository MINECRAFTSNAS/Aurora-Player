# Aurora Player

Windows 11 风格的音乐播放器：**真·亚克力（Acrylic）毛玻璃窗口** + Fluent 圆角控件，
支持本地文件 / 文件夹 / 网络 URL 三种导入方式，可播放主流音频格式，附带实时频谱可视化。

打包产物为 Windows `.exe`（安装版 + 免安装便携版）。

---

## 功能

| 分类 | 说明 |
| --- | --- |
| **窗口材质** | 原生 DWM 亚克力模糊 / 云母 Mica / 纯色，三选一；Win11 圆角窗口、深色标题栏 |
| **导入方式** | ① 文件选择 ② 整个文件夹递归扫描 ③ 网络 URL 直链 / 电台流 ④ 拖拽到窗口（文件 / 文件夹 / 链接均可） |
| **格式支持** | mp3 / flac / wav / m4a / aac / ogg / opus / wma / aiff / ape / webm 等 |
| **播放列表** | 搜索过滤、曲目封面、时长；Ctrl+点击多选、Delete 删除（同时删文件） |
| **音乐库** | 歌曲实体存放在 `C:\Users\<用户名>\Music`（可改），关闭应用后歌单不丢失 |
| **播放模式** | 顺序播放 · 列表循环 · 单曲循环 · 随机播放 |
| **进度与音量** | 可拖拽进度条（带缓冲进度显示）、音量浮层滑块、静音；直播流自动禁用 seek |
| **可视化** | 实时频谱柱（只向上生长）/ 示波器波形 / 两者叠加；播放/暂停有缓动的起落动画，不是瞬间跳变 |
| **窗口交互** | 无边框拖拽、最小化 / 最大化 / 关闭、窗口置顶、迷你模式、透明度调节 |
| **悬停提示** | 所有按钮悬停显示用途与快捷键（如音量图标显示当前音量百分比） |
| **系统集成** | 任务栏进度条、Media Session（媒体键控制）、文件关联、单实例 |
| **元数据** | 自动读取标题 / 艺术家 / 专辑 / 时长 / 内嵌封面 |

## 快捷键

| 按键 | 作用 |
| --- | --- |
| `空格` | 播放 / 暂停 |
| `←` `→` | 后退 / 前进 5 秒 |
| `Shift` + `←` `→` | 上一首 / 下一首 |
| `↑` `↓` | 音量 ±5% |
| `M` / `S` / `N` / `P` | 静音 / 停止 / 下一首 / 上一首 |
| `Delete` | 删除选中的歌曲（连同音乐库里的文件） |
| `Esc` | 切换迷你模式 |

> 多选：`Ctrl` + 点击逐首加选，`Shift` + 点击连选；普通点击会播放并清空选择。
> 删除前会弹系统确认框，且只允许删除音乐库目录内的文件。

---

## 直接使用

到 `release/` 目录取打包好的可执行文件：

- **`Aurora Player-Setup-1.0.0.exe`** — 安装版，可选安装目录，自动创建开始菜单/桌面快捷方式与文件关联
- **`Aurora Player-1.0.0-portable.exe`** — 免安装单文件，双击即用

## 从源码构建

```bash
npm install                # 安装依赖
npm run dev                # 开发模式（热更新）
npm run build              # 仅编译
npm run dist               # 编译 + 打包出 exe（输出到 release/）
npm run typecheck          # 类型检查
```

### 环境要求

- Node.js 18+（已在 Node 24 验证）
- Windows 10 1803+ / Windows 11（亚克力依赖 Win10 1803 起支持的系统 API）
- 首次打包会下载 Electron 与 NSIS 工具链，国内网络建议设置镜像：

```powershell
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR='https://npmmirror.com/mirrors/electron-builder-binaries/'
```

---

## 亚克力是怎么实现的

窗口本体不靠 CSS 模拟模糊，而是直接调用系统合成器：

1. `DwmSetWindowAttribute(hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND)` — Win11 圆角
2. `DwmSetWindowAttribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, 1)` — 深色标题栏
3. 优先尝试 `DWMWA_SYSTEMBACKDROP_TYPE = DWMSBT_TRANSIENTWINDOW(3)`（Acrylic）
4. 失败则回退 `SetWindowCompositionAttribute(WCA_ACCENT_POLICY, ACCENT_ENABLE_ACRYLICBLURBEHIND)`
5. 若系统完全不支持，UI 自动降级为半透明纯色，功能不受影响

这些调用通过 [koffi](https://koffi.dev/) 调用 `user32.dll` / `dwmapi.dll` 完成。

> **一个容易踩的坑**：HWND 必须以 `intptr_t`（整数值）传给 Win32。
> 若声明为 `void *` 并传 `Buffer`，会被解释成「指针的指针」，
> 调用统一返回 `E_INVALIDARG (0x80070057)`，**所有窗口属性静默失效**且没有报错。
> 项目里由 `src/main/win32.ts` 的 `hwndValue()` 统一处理。
> `scripts/smoke.cjs` 会通过 `app:window-material` 向 DWM 回查实际属性值，
> 确保亚克力是「真的生效」而不是「调用没报错」。

## 项目结构

```
src/
├── main/                  # 主进程
│   ├── index.ts           # 窗口、IPC、设置持久化、文件扫描、元数据解析
│   └── win32.ts           # 亚克力 / Mica / 圆角 / 深色标题栏的原生调用
├── preload/               # 预加载：contextBridge 暴露受限 API
├── shared/types.ts        # 主进程与渲染层共享的类型
└── renderer/              # 渲染层（React）
    ├── src/
    │   ├── App.tsx                    # 布局编排、拖放导入、设置同步
    │   ├── hooks/
    │   │   ├── usePlayer.ts           # 播放引擎：队列、模式、seek、Media Session
    │   │   └── useAudioAnalyser.ts    # Web Audio 频谱分析 + canvas 绘制
    │   ├── components/
    │   │   ├── TitleBar.tsx           # 自绘标题栏 + 置顶/迷你/设置
    │   │   ├── UrlBar.tsx             # URL 导入与连通性检测
    │   │   ├── Playlist.tsx           # 播放列表（搜索、封面、移除）
    │   │   ├── PlayerBar.tsx          # 传输控件、进度条、音量、可视化
    │   │   ├── SettingsPanel.tsx      # 设置抽屉
    │   │   ├── Visualizer.tsx         # 频谱 / 波形画布
    │   │   └── Icons.tsx              # Fluent 风格图标集
    │   └── styles/
    │       ├── global.css             # 设计令牌、亚克力底、噪点层
    │       ├── win11.css              # Win11 控件：按钮/滑块/开关/分段/卡片
    │       └── app.css                # 布局
scripts/
├── smoke.cjs              # 端到端冒烟测试（24 项断言）
└── make_icon.py           # 生成多尺寸应用图标
```

## 测试

```powershell
.\node_modules\electron\dist\electron.exe scripts\smoke.cjs
```

覆盖 24 项断言：渲染层结构、Win11 控件数量、亚克力材质经 DWM 回查确认、
本地文件导入与元数据解析、音频解码播放、Web Audio 频谱能量、窗口置顶等。
结果同时写入 `smoke-report.json`。

打包产物另有一道验证（18 项，会真实启动 exe 并通过远程调试端口连接渲染层）：

```powershell
node scripts/verify-packaged.cjs                                     # win-unpacked
node scripts/verify-packaged.cjs "release\Aurora Player-1.0.0-portable.exe"
```

界面交互回归（13 项，针对可视化条位置、浮层遮挡、悬停提示）：

```powershell
node scripts\verify-fixes.cjs
```

该脚本用几何位置与元素命中测试判定，而不是"看起来对"：

- 可视化条的 `top` 必须 ≥ 控件区的 `bottom`，且无重叠、贴播放栏底边
- `.playerbar` 的 `overflow` 不能是 `hidden`（否则音量为代表的浮层会被裁掉）
- 浮层 `is-open` 后 `pointer-events: auto`、`opacity` 收敛到 1、且向上溢出播放栏仍完整可见
- 悬停提示出现在 body 的 portal 里、`position: fixed`、`z-index ≥ 99999`、完整落在视口内

> 注：窗口不可见时 Chromium 会节流 CSS 过渡，脚本会轮询等 `opacity` 落定再断言，
> 否则容易把"动画没跑完"误判成"浮层没打开"。

拖放导入回归（7 项，用 CDP 投递带真实文件路径的拖拽事件）：

```powershell
node scripts\verify-dnd.cjs
```

音乐库 / 多选删除 / 频谱方向回归（13 项 + 重启验证）：

```powershell
node scripts\verify-library-runner.cjs
```

频谱起落动画回归（8 项）：逐帧采样画布着墨量，验证暂停是渐隐、恢复是渐显。

```powershell
node scripts\verify-viz-anim-runner.cjs
```

歌单顺序持久化回归（模拟"加完歌立刻关窗口"）：

```powershell
node scripts\verify-playlist-order-runner.cjs
```

这个测试把写盘防抖调到 5 秒（`AURORA_SAVE_DEBOUNCE`），确保退出时数据一定还没落盘，
从而**确定性地**验证退出时的同步 flush。带对照开关：`AURORA_SKIP_FLUSH=1` 时应当失败
（实测重启后顺序会变成 `[aa, mm, zz]`），说明测试确实能抓到这个 bug。

这个脚本会起两个进程：phase1 跑断言，phase2 全新启动检查歌单是否从磁盘恢复
（"关闭后歌曲消失"只有真重启才能验证）。几个关键点：

- 音乐库通过 `AURORA_LIBRARY_DIR` 指向临时目录，**不会碰用户真实的 Music 文件夹**
- 删除确认框用 monkey-patch `dialog.showMessageBox` 自动确认，
  这样才能验证"文件是否真被删掉"，而不是只验证弹窗出现过
- 频谱方向用**画布像素统计**判定：上半区着墨量必须明显少于下半区
  （对称绘制时两者会接近）；实测为 `上=0 下=1920`

这是唯一能同时验证「`dataTransfer.files` 有内容」和「`webUtils.getPathForFile` 能取到绝对路径」的方法——
用合成的 `File` 对象测不出来，因为那种 File 没有真实路径。

### 频谱的起落动画

柱体不是直接画 analyser 的瞬时值，而是经过一层"包络跟随"：

- 每根柱子有自己的平滑值，按指数方式逼近目标：`v += (target - v) * (1 - e^(-dt/τ))`
- 上升 τ=90ms（约 270ms 到 95%），回落 τ≈240ms —— 上升利落、回落更缓，像真实 VU 表
- **暂停时不是把整帧置零**，而是把目标设为 0，让包络自己滑下去（约 1.3s 淡出）；
  淡到看不见才停掉 rAF，避免暂停时空转
- **单帧步长上限 33ms**：主线程卡一下（点击、切歌）时 rAF 会跳帧，
  若按真实 dt 计算，一帧就能从 0 冲到 60%+，看上去仍是"弹起"
- 静音时**不画柱子**（否则每根 2px 的最小高度会残留成一条假底线，
  淡出永远到不了 0）

对应的回归测试会逐帧采样画布着墨量，检查暂停后存在中间态并最终归零、
恢复后存在 3 个以上的过渡帧（瞬间跳变时只会有 0~1 帧）。

### 音乐库是怎么做到"重启不丢歌"的

- **文件放在哪**：默认 `app.getPath('music')`，Windows 上就是
  `C:\Users\<用户名>\Music`，可在设置里改。导入时若文件在库外，
  会**复制**一份进来（可用设置关掉），重名自动加 ` (1)` 后缀，不会覆盖已有文件
- **顺序怎么记**：索引写到 `userData/playlist.json`（只存路径与 URL，不存封面 base64，
  否则文件会膨胀到几 MB）
- **顺序怎么保证不丢**：写盘有两层——渲染层在歌单变化时**立即**上报（不再防抖），
  主进程再防抖 250ms 合并写盘。但只靠防抖会踩一个坑：
  **加完歌马上关窗口时，定时器还没触发，进程就退出了**，索引根本没写下来。
  启动时索引缺失就只能退回扫描目录，于是顺序变成文件名排序——
  看起来像"重启后顺序乱了"。
  所以窗口 `close`、`app.before-quit`、`window-all-closed` 三处都会调
  `flushPlaylistIndex()` 用**同步写**把待写数据落盘（quit 期间异步写不保证完成）。
  另外扫描目录时按名称排序，保证回退路径也是确定的
- **启动怎么恢复**：先按索引还原顺序并跳过已不存在的文件，再扫描音乐库把
  **新出现的文件补到末尾**——所以直接把歌拖进 Music 文件夹也能被读到
- **删除的安全边界**：只允许删除 `libraryDir` 内的文件。判断用
  `path.relative(root, target)` 不以 `..` 开头，网络流/库外路径一律跳过，
  避免误删用户其他位置的文件

一个需要留意的语义：歌单和音乐库目录是**双向对应**的。从列表里删掉一首，文件也会被删；
反之把文件直接放进 Music，重启后会自动出现在列表里。

### 窗口置顶为什么曾经是坏的

置顶按钮点击后"没反应"，而且重启后置顶状态也会丢。原因有两条：

1. **时机不对**：启动时在 `createWindow()` 之后立刻 `setAlwaysOnTop(true)`，
   此时窗口还没 `show()`，随后 60ms 的 `applyMaterial()`（WCA 亚克力 / DWM 属性）
   会重设窗口样式，把置顶状态冲掉。
   现在统一在 `ready-to-show → show() → applyMaterial()` **之后**由 `applyWindowPrefs()` 落定。
2. **接口说谎**：`window:set-always-on-top` 之前 `return flag`，无条件回显参数，
   所以渲染层/测试永远看到"成功"。现在返回 `mainWindow.isAlwaysOnTop()` 的真实值。

对应的测试也从"读 `win.isAlwaysOnTop()`"升级为**读 OS 层扩展样式**：
用 koffi 调 `GetWindowLongPtrW(hwnd, GWL_EXSTYLE)` 检查 `WS_EX_TOPMOST (0x8)` 位，
这才是"窗口真的置顶了"的唯一证据。

### 打包时踩过的坑

**便携版（portable）不解包、不显示窗口**：`electron-builder` 的 portable 目标
默认把内容解包到一个带随机后缀的临时目录，在本机环境下自解压过程会卡住，
进程存活但窗口始终不出现。指定固定的 `unpackDirName` 后恢复正常：

```json
"portable": { "unpackDirName": "AuroraPlayer" }
```

> 注意：若环境中设置了 `ELECTRON_RUN_AS_NODE=1`，Electron 会以纯 Node 模式运行，
> 导致 `require('electron')` 返回 CLI shim 字符串、`app` 为 undefined。
> 运行或打包前请清除该变量。

## 已知限制

- **DRM 音频**（如部分音乐平台的加密流）无法播放，属 Chromium 解码限制
- **跨域远程音频**若未返回 CORS 头，Web Audio 分析会得到静音，频谱退化为静止；
  播放本身不受影响
- `ape` / `wma` 等格式能否播放取决于系统已安装的解码器
- **音乐库很大时启动会偏慢**：每首歌都要读标签与内嵌封面。当前上限 3000 首，
  且不做元数据缓存——如果你的 Music 文件夹有上千首，首次加载可能要几秒。
  需要的话可以加一层元数据缓存（按路径 + 修改时间失效）
- 仅面向 Windows；亚克力与圆角 API 为 Windows 特有，其他平台会降级

## 许可

MIT
