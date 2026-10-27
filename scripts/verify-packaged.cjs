/**
 * 验证打包产物：直接启动 release/win-unpacked/Aurora Player.exe，
 * 通过 CDP(远程调试端口) 连接渲染层，确认打包后：
 *   1. 窗口正常出现
 *   2. 亚克力材质真的设置成功（读 window.aurora.windowMaterial()）
 *   3. 原生 koffi 在打包环境里仍能加载
 *   4. 主要 UI 元素齐全
 *
 * 用法：node scripts/verify-packaged.cjs
 */
const { spawn } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')
const http = require('node:http')

const ROOT = path.resolve(__dirname, '..')
const EXE = process.argv[2] || path.join(ROOT, 'release', 'win-unpacked', 'Aurora Player.exe')
const PORT = 9333

if (!fs.existsSync(EXE)) {
  console.error('exe not found:', EXE)
  process.exit(1)
}

const results = []
const log = (n, ok, d = '') => {
  results.push({ name: n, ok, detail: String(d) })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' :: ' + d : ''}`)
}

const get = (url) =>
  new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let b = ''
        res.on('data', (c) => (b += c))
        res.on('end', () => resolve(b))
      })
      .on('error', reject)
  })

async function findPage() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = JSON.parse(await get(`http://127.0.0.1:${PORT}/json/list`))
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) return page
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  return null
}

/** 极简 CDP 客户端：只需 Runtime.evaluate */
function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const WebSocket = require('ws')
    const ws = new WebSocket(wsUrl)
    let id = 0
    const pending = new Map()
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString())
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg)
        pending.delete(msg.id)
      }
    })
    ws.on('error', reject)
    ws.on('open', () =>
      resolve({
        send: (method, params) =>
          new Promise((res) => {
            const myId = ++id
            pending.set(myId, res)
            ws.send(JSON.stringify({ id: myId, method, params }))
          }),
        close: () => ws.close()
      })
    )
  })
}

async function main() {
  console.log('launching:', EXE)
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE // 该变量会让 Electron 退化成纯 Node

  // 独立 userData：验证过程不读写用户真实的 settings.json / playlist.json
  const TEST_USERDATA = path.join(require('node:os').tmpdir(), 'aurora-ud-packaged')
  fs.rmSync(TEST_USERDATA, { recursive: true, force: true })
  fs.mkdirSync(TEST_USERDATA, { recursive: true })

  const child = spawn(EXE, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${TEST_USERDATA}`], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false
  })

  const out = []
  child.stdout.on('data', (d) => out.push(d.toString()))
  child.stderr.on('data', (d) => out.push(d.toString()))

  await new Promise((r) => setTimeout(r, 4000))

  if (child.exitCode !== null) {
    log('打包 exe 启动', false, `进程已退出，code=${child.exitCode}\n${out.join('').slice(0, 900)}`)
    finish(child)
    return
  }
  log('打包 exe 启动', true, `pid=${child.pid}`)

  const page = await findPage()
  if (!page) {
    log('远程调试端口可连接', false, '未能发现页面')
    finish(child)
    return
  }
  log('远程调试端口可连接', true, page.url.slice(0, 60))

  const cdp = await connect(page.webSocketDebuggerUrl)
  const evalJs = async (expr) => {
    const r = await cdp.send('Runtime.evaluate', {
      expression: expr,
      awaitPromise: true,
      returnByValue: true
    })
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text || 'eval error')
    return r.result?.result?.value
  }

  // 等 React 挂载
  for (let i = 0; i < 30; i++) {
    const ok = await evalJs(`!!document.querySelector('.playerbar')`).catch(() => false)
    if (ok) break
    await new Promise((r) => setTimeout(r, 400))
  }

  try {
    const ui = await evalJs(`JSON.stringify({
      api: typeof window.aurora === 'object',
      apiKeys: window.aurora ? Object.keys(window.aurora).length : 0,
      titlebar: !!document.querySelector('.titlebar'),
      caption: document.querySelectorAll('.caption-btn').length,
      icons: document.querySelectorAll('.icon-btn').length,
      urlbar: !!document.querySelector('.urlbar__input'),
      playlist: !!document.querySelector('.playlist'),
      sliders: document.querySelectorAll('input[type=range]').length,
      viz: !!document.querySelector('.viz__canvas'),
      material: document.body.dataset.material || '',
      text: document.body.innerText.replace(/\\n+/g,' | ').slice(0,80)
    })`)
    const u = JSON.parse(ui)
    log('preload API（打包后）', u.api, `${u.apiKeys} 个方法`)
    log('标题栏 + 窗口按钮', u.titlebar && u.caption === 3, `${u.caption} 个`)
    log('Win11 图标按钮', u.icons >= 8, `${u.icons} 个`)
    log('URL 导入栏', u.urlbar)
    log('播放列表', u.playlist)
    log('进度/音量滑块', u.sliders >= 2, `${u.sliders} 个`)
    log('频谱画布', u.viz)
    log('渲染文案', u.text.length > 0, u.text)

    // DWM 属性由主进程在窗口 ready-to-show 时写入。portable 版要先解包再启动，
    // 这里若读得太早会拿到默认值（corner=0）而误报。轮询等它落定。
    let mat = { backdrop: 0, corner: 0, dark: 0 }
    for (let i = 0; i < 25; i++) {
      mat = JSON.parse(await evalJs(`window.aurora.windowMaterial().then(r=>JSON.stringify(r))`))
      if (mat.backdrop === 3 && mat.corner === 2 && mat.dark === 1) break
      await new Promise((r) => setTimeout(r, 300))
    }
    log('打包后亚克力生效', mat.backdrop === 3, `backdrop=${mat.backdrop} (3=Acrylic)`)
    log('打包后 Win11 圆角', mat.corner === 2, `corner=${mat.corner} (2=ROUND)`)
    log('打包后深色标题栏', mat.dark === 1, `dark=${mat.dark}`)

    const info = JSON.parse(await evalJs(`window.aurora.appInfo().then(r=>JSON.stringify(r))`))
    log('原生 koffi 在打包环境可用', info.nativeBlur === true, `nativeBlur=${info.nativeBlur}`)
    log('应用版本', !!info.version, `v${info.version} electron=${info.electron}`)

    // 音乐库通道（新增 IPC）在打包后必须同样可用
    try {
      const lib = JSON.parse(await evalJs(`window.aurora.loadLibrary().then(r=>JSON.stringify({dir:r.libraryDir, n:r.tracks.length, copy:r.copyToLibrary}))`))
      log(
        '打包后音乐库可读取',
        typeof lib.dir === 'string' && lib.dir.length > 0 && typeof lib.n === 'number',
        `dir=${lib.dir} tracks=${lib.n} copy=${lib.copy}`
      )
      const info2 = JSON.parse(await evalJs(`window.aurora.libraryInfo().then(r=>JSON.stringify(r))`))
      log('打包后音乐库目录存在', typeof info2.dir === 'string' && fs.existsSync(info2.dir), info2.dir)
    } catch (e) {
      log('打包后音乐库可读取', false, String(e.message).slice(0, 160))
    }

    // 音频链路：打包后仍能解码与做频谱分析
    const tone = path.join(require('node:os').tmpdir(), 'aurora-verify.wav')
    if (!fs.existsSync(tone)) fs.writeFileSync(tone, makeWav(2, 440))
    const fileUrl = require('node:url').pathToFileURL(tone).href

    const play = JSON.parse(
      await evalJs(`(async()=>{
        const a=new Audio(); a.src=${JSON.stringify(fileUrl)}; a.volume=0;
        try { await a.play(); await new Promise(r=>setTimeout(r,400));
          const t=a.currentTime; a.pause();
          return JSON.stringify({ok:t>0,t:+t.toFixed(2),d:+a.duration.toFixed(2)});
        } catch(e){ return JSON.stringify({ok:false,error:e.message}); }
      })()`)
    )
    log('打包后音频解码播放', play.ok, `${play.t}s / ${play.d}s`)

    const viz = JSON.parse(
      await evalJs(`(async()=>{
        const a=new Audio(); a.src=${JSON.stringify(fileUrl)}; a.volume=0.02;
        const c=new AudioContext(); const s=c.createMediaElementSource(a);
        const an=c.createAnalyser(); an.fftSize=2048;
        s.connect(an); an.connect(c.destination);
        await a.play(); await new Promise(r=>setTimeout(r,500));
        const f=new Uint8Array(an.frequencyBinCount); an.getByteFrequencyData(f);
        let e=0; for(const v of f) e+=v; a.pause(); await c.close();
        return JSON.stringify({ok:e>0,e});
      })()`)
    )
    log('打包后频谱分析', viz.ok, `能量=${viz.e}`)
  } catch (e) {
    log('打包产物断言', false, e.message)
  }

  // 截图
  try {
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
    const out = path.join(ROOT, '..', 'shots', 'packaged-app.png')
    fs.mkdirSync(path.dirname(out), { recursive: true })
    fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'))
    log('打包产物截图', fs.statSync(out).size > 5000, `${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`)
  } catch (e) {
    log('打包产物截图', false, e.message)
  }

  cdp.close()
  finish(child)
}

function finish(child) {
  try {
    child.kill()
  } catch {
    /* ignore */
  }
  const failed = results.filter((r) => !r.ok)
  console.log(`\n=== ${results.length - failed.length}/${results.length} 通过 ===`)
  if (failed.length) console.log('失败项: ' + failed.map((f) => f.name).join(', '))
  fs.writeFileSync(path.join(ROOT, 'packaged-report.json'), JSON.stringify(results, null, 2))
  process.exit(failed.length === 0 ? 0 : 1)
}

function makeWav(seconds, freq) {
  const rate = 44100
  const n = Math.floor(rate * seconds)
  const data = Buffer.alloc(n * 2)
  for (let i = 0; i < n; i++) {
    const fade = Math.min(1, i / 2000, (n - i) / 2000)
    data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * 0.35 * fade * 32767), i * 2)
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

main().catch((e) => {
  console.error('verify failed:', e)
  process.exit(1)
})
