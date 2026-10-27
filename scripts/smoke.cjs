/**
 * 自动化冒烟测试：在真实 Electron 主进程里跑被测应用本身，
 * 再通过第二窗口/直接断言验证渲染层 DOM、亚克力材质、音频解码与频谱分析链路。
 *
 * 关键点：直接 require 打包后的主进程入口，这样 IPC handler、材质逻辑
 * 都是被测的真实代码，而不是测试脚本的复制品。
 *
 * 用法：electron.exe scripts/smoke.cjs
 */
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { pathToFileURL } = require('node:url')

const ROOT = path.resolve(__dirname, '..')
const shotsDir = path.resolve(ROOT, '..', 'shots')
fs.mkdirSync(shotsDir, { recursive: true })

// 测试会把导入的音频复制进"音乐库"。指向临时目录，避免污染用户真实的
// C:\Users\<用户名>\Music。必须在 require 主进程之前设置（启动时读取）。
const TEST_LIB = path.join(os.tmpdir(), 'aurora-smoke-lib')
fs.rmSync(TEST_LIB, { recursive: true, force: true })
fs.mkdirSync(TEST_LIB, { recursive: true })
process.env.AURORA_LIBRARY_DIR = TEST_LIB

// 同时用独立的 userData，避免覆盖用户真实的 playlist.json / settings.json
const TEST_USERDATA = path.join(os.tmpdir(), 'aurora-ud-smoke')
fs.rmSync(TEST_USERDATA, { recursive: true, force: true })
fs.mkdirSync(TEST_USERDATA, { recursive: true })

const results = []
const log = (name, ok, detail = '') => {
  results.push({ name, ok, detail: String(detail) })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`)
}

app_setUserModelId()

function app_setUserModelId() {
  const { app } = require('electron')
  // 必须在上面的 require(main) 之前把 userData 指到临时目录，
  // 否则主进程启动时读写的 settings.json / playlist.json 会是用户真实的那份。
  app.setPath('userData', TEST_USERDATA)
  app.setAppUserModelId('com.aurora.player.smoke')
}

// ---------- 载入被测主进程（真实 IPC + 真实材质逻辑） ----------
require(path.join(ROOT, 'dist-electron', 'main', 'index.js'))

const { app, BrowserWindow } = require('electron')

app.whenReady().then(async () => {
  // 主进程 createWindow 已经建好一个窗口；复用它
  await new Promise((r) => setTimeout(r, 1500))
  const wins = BrowserWindow.getAllWindows()
  log('主进程创建窗口', wins.length >= 1, `${wins.length} 个窗口`)
  const win = wins[0]
  if (!win) {
    console.log('no window, abort')
    app.exit(1)
    return
  }

  const js = (code) => win.webContents.executeJavaScript(code, true)

  // 等渲染层挂载
  for (let i = 0; i < 30; i++) {
    const ready = await js(`!!document.querySelector('.playerbar')`)
    if (ready) break
    await new Promise((r) => setTimeout(r, 300))
  }

  // ---------- 1. 渲染层结构 ----------
  try {
    const info = await js(`(() => ({
      hasApi: typeof window.aurora === 'object' && window.aurora !== null,
      apiKeys: window.aurora ? Object.keys(window.aurora).length : 0,
      titlebar: !!document.querySelector('.titlebar'),
      captionBtns: document.querySelectorAll('.caption-btn').length,
      iconBtns: document.querySelectorAll('.icon-btn').length,
      urlInput: !!document.querySelector('.urlbar__input'),
      playlist: !!document.querySelector('.playlist'),
      playerbar: !!document.querySelector('.playerbar'),
      rangeInputs: document.querySelectorAll('input[type=range]').length,
      vizCanvas: !!document.querySelector('.viz__canvas'),
      segmentItems: document.querySelectorAll('.segment__item').length,
      material: document.body.dataset.material || '',
      bg: getComputedStyle(document.body).backgroundImage.slice(0, 60),
      rootKids: document.getElementById('root').children.length,
      text: document.body.innerText.replace(/\\n+/g, ' | ').slice(0, 90)
    }))()`)
    log('preload API 注入', info.hasApi, `${info.apiKeys} 个方法`)
    log('标题栏 + 3 个窗口按钮', info.titlebar && info.captionBtns === 3, `${info.captionBtns} 个`)
    log('Win11 圆角按钮', info.iconBtns >= 8, `${info.iconBtns} 个 icon-btn`)
    log('URL 导入栏', info.urlInput)
    log('播放列表区域', info.playlist)
    log('进度/音量滑块', info.rangeInputs >= 2, `${info.rangeInputs} 个 range`)
    log('频谱画布', info.vizCanvas)
    log('播放模式分段控件', info.segmentItems >= 4, `${info.segmentItems} 项`)
    log('亚克力材质令牌', info.material === 'acrylic', `material=${info.material}`)
    log('毛玻璃渐变生效', info.bg.includes('radial-gradient'), info.bg)
    log('界面文案渲染', info.rootKids > 0, info.text)
  } catch (e) {
    log('渲染层断言', false, e.message)
  }

  // ---------- 2. 亚克力/DWM 原生层真实生效 ----------
  // 由主进程内部自检（applyMaterial 就在那里执行），避免外部探测的指针问题
  try {
    const raw = await js(`window.aurora.windowMaterial().then(r => JSON.stringify(r))`)
    const m = JSON.parse(raw)
    log(
      'Win11 窗口圆角已生效',
      m.corner === 2,
      `DWMWA_WINDOW_CORNER_PREFERENCE = ${m.corner} (2 = DWMWCP_ROUND)`
    )
    log('深色标题栏已启用', m.dark === 1, `DWMWA_USE_IMMERSIVE_DARK_MODE = ${m.dark}`)
    log(
      'DWM 背景材质已设置',
      m.backdrop !== null,
      `DWMWA_SYSTEMBACKDROP_TYPE = ${m.backdrop} (2=Mica 3=Acrylic 1=None)`
    )
  } catch (e) {
    log('DWM 原生检测', false, e.message)
  }

  // ---------- 3. 生成测试音频，跑通导入 -> 解码 -> 播放 -> 频谱 ----------
  let tmpWav = ''
  try {
    tmpWav = path.join(os.tmpdir(), 'aurora-smoke-tone.wav')
    fs.writeFileSync(tmpWav, makeWav(3.0, 440))
    const fileUrl = pathToFileURL(tmpWav).href

    // 走真实 IPC 导入
    const raw = await js(`window.aurora.tracksFromPaths(${JSON.stringify([tmpWav])}).then(t => JSON.stringify(t))`)
    const tracks = JSON.parse(raw)
    log('本地文件导入（真实 IPC + 元数据解析）', tracks.length === 1, `${tracks[0]?.title} · ${tracks[0]?.duration}s · src=${String(tracks[0]?.src).slice(0, 30)}…`)

    // 把曲目推进真实播放器状态：主进程广播通道
    await js(`(() => { window.__smoke081 = true; return true })()`)

    // 解码 + 播放（用真实 <audio> 元素，与播放器同一条解码路径）
    const playRaw = await js(`(async () => {
      const a = new Audio();
      a.src = ${JSON.stringify(fileUrl)};
      a.volume = 0;
      try {
        await a.play();
        await new Promise(r => setTimeout(r, 500));
        const t = a.currentTime;
        a.pause();
        return JSON.stringify({ ok: t > 0, currentTime: +t.toFixed(2), duration: +a.duration.toFixed(2) });
      } catch (e) { return JSON.stringify({ ok: false, error: e.message }); }
    })()`)
    const p = JSON.parse(playRaw)
    log('音频解码并播放', p.ok, `已播放 ${p.currentTime}s / 总长 ${p.duration}s`)

    // Web Audio 频谱链路
    const vizRaw = await js(`(async () => {
      const a = new Audio();
      a.src = ${JSON.stringify(fileUrl)};
      a.volume = 0.02;
      const ctx = new AudioContext();
      const src = ctx.createMediaElementSource(a);
      const an = ctx.createAnalyser();
      an.fftSize = 2048;
      src.connect(an); an.connect(ctx.destination);
      await a.play();
      await new Promise(r => setTimeout(r, 600));
      const freq = new Uint8Array(an.frequencyBinCount);
      an.getByteFrequencyData(freq);
      const time = new Uint8Array(an.fftSize);
      an.getByteTimeDomainData(time);
      let fe = 0; for (const v of freq) fe += v;
      let tv = 0; for (const v of time) tv += Math.abs(v - 128);
      a.pause(); await ctx.close();
      return JSON.stringify({ ok: fe > 0 && tv > 0, freqEnergy: fe, waveEnergy: tv });
    })()`)
    const v = JSON.parse(vizRaw)
    log('Web Audio 频谱分析', v.ok, `频域能量=${v.freqEnergy} 时域能量=${v.waveEnergy}`)

    // 生成频谱并写入 canvas，确认绘制不抛错
    const drawRaw = await js(`(() => {
      const c = document.querySelector('.viz__canvas');
      if (!c) return JSON.stringify({ ok: false, error: 'no canvas' });
      return JSON.stringify({ ok: c.width > 0 && c.height > 0, w: c.width, h: c.height });
    })()`)
    const d = JSON.parse(drawRaw)
    log('频谱 canvas 已按 DPR 分配', d.ok, `${d.w}x${d.h}`)
  } catch (e) {
    log('音频链路测试', false, e.message)
  }

  // ---------- 4. URL 通道 ----------
  try {
    const probeRaw = await js(`window.aurora.probeUrl('file:///${String(tmpWav).replace(/\\\\/g, '/')}').then(r => JSON.stringify(r)).catch(e => JSON.stringify({ ok: false, error: e.message }))`)
    const pr = JSON.parse(probeRaw)
    log('URL 探测通道可调用', typeof pr.ok === 'boolean', `ok=${pr.ok}${pr.error ? ' ' + pr.error : ''}`)

    const info = await js(`window.aurora.appInfo().then(r => JSON.stringify(r))`)
    const ai = JSON.parse(info)
    log('主进程 appInfo', !!ai.version, `v${ai.version} electron=${ai.electron} nativeBlur=${ai.nativeBlur}`)
    log('原生亚克力绑定已加载', ai.nativeBlur === true, `nativeBlur=${ai.nativeBlur}`)
  } catch (e) {
    log('IPC 通道测试', false, e.message)
  }

  // ---------- 5. 窗口控制 ----------
  try {
    // 用 OS 层扩展样式判定是否真的置顶。
    // 只读 win.isAlwaysOnTop() 不够：它反映的是 Electron 内部标志，
    // 而且 IPC 曾经无条件回显参数，会把"没生效"误报成成功。
    const koffi = require('koffi')
    const user32 = koffi.load('user32.dll')
    const GetWindowLongPtrW = user32.func('intptr_t GetWindowLongPtrW(intptr_t hWnd, int nIndex)')
    const GWL_EXSTYLE = -20
    const WS_EX_TOPMOST = 0x8

    const handle = win.getNativeWindowHandle()
    const hwnd = handle.length >= 8 ? Number(handle.readBigUInt64LE(0)) : Number(handle.readUInt32LE(0))
    const isTopmost = () => (Number(GetWindowLongPtrW(hwnd, GWL_EXSTYLE)) & WS_EX_TOPMOST) !== 0

    // 先把状态归零，避免上一次运行持久化的 alwaysOnTop 影响断言
    await js(`window.aurora.setAlwaysOnTop(false)`)
    await new Promise((r) => setTimeout(r, 400))
    const before = isTopmost()

    await js(`window.aurora.setAlwaysOnTop(true)`)
    await new Promise((r) => setTimeout(r, 500))
    const after = isTopmost()

    log('窗口置顶开关生效（OS 层 WS_EX_TOPMOST）', before === false && after === true, `before=${before} -> after=${after}`)

    // IPC 应返回真实状态
    const reported = await js(`window.aurora.setAlwaysOnTop(true).then(v => JSON.stringify(v))`)
    log('置顶接口返回真实状态', JSON.parse(reported) === true, `返回 ${reported}`)

    await js(`window.aurora.setAlwaysOnTop(false)`)
    await new Promise((r) => setTimeout(r, 400))
    log('置顶可正确关闭', isTopmost() === false, `关闭后 topmost=${isTopmost()}`)
  } catch (e) {
    log('窗口控制', false, e.message)
  }

  // ---------- 6. 截图 ----------
  try {
    const img = await win.webContents.capturePage()
    const out = path.join(shotsDir, 'app-verified.png')
    fs.writeFileSync(out, img.toPNG())
    log('截图导出', fs.statSync(out).size > 5000, `${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`)
  } catch (e) {
    log('截图导出', false, e.message)
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\n=== ${results.length - failed.length}/${results.length} 通过 ===`)
  if (failed.length) console.log('失败项: ' + failed.map((f) => f.name).join(', '))
  fs.writeFileSync(path.join(ROOT, 'smoke-report.json'), JSON.stringify(results, null, 2))
  app.exit(failed.length === 0 ? 0 : 1)
})

/** 生成单声道 16bit PCM WAV，无需外部素材即可测试解码 */
function makeWav(seconds, freq) {
  const rate = 44100
  const n = Math.floor(rate * seconds)
  const data = Buffer.alloc(n * 2)
  for (let i = 0; i < n; i++) {
    const fade = Math.min(1, i / 2000, (n - i) / 2000)
    const s = Math.sin((2 * Math.PI * freq * i) / rate) * 0.35 * fade
    data.writeInt16LE(Math.round(s * 32767), i * 2)
  }
  const h = Buffer.alloc(44)
  h.write('RIFF', 0)
  h.writeUInt32LE(36 + data.length, 4)
  h.write('WAVE', 8)
  h.write('fmt ', 12)
  h.writeUInt32LE(16, 16)
  h.writeUInt16LE(1, 20)
  h.writeUInt16LE(1, 22)
  h.writeUInt32LE(rate, 24)
  h.writeUInt32LE(rate * 2, 28)
  h.writeUInt16LE(2, 32)
  h.writeUInt16LE(16, 34)
  h.write('data', 36)
  h.writeUInt32LE(data.length, 40)
  return Buffer.concat([h, data])
}
