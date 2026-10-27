/**
 * 验证歌单顺序在重启后保持不变（对应测试项 R-10）。
 *
 * 关键场景："加完歌立刻关窗口"——这是最容易丢顺序的时机。
 * phase1 在界面刚出现 3 首后立刻 app.quit()（走 before-quit 的同步 flush），
 * phase2 全新进程启动，比对顺序。
 *
 * 用法：electron.exe scripts/verify-playlist-order.cjs --phase1|--phase2
 *      （推荐用 verify-playlist-order-runner.cjs）
 */
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { spawnSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
const PHASE2 = process.argv.includes('--phase2')
const FFMPEG = path.join('D:', 'Test', 'AI', 'aurora-tools', 'resources', 'bin', 'ffmpeg.exe')
const LIB = process.env.AURORA_LIBRARY_DIR
const STATE = path.join(ROOT, 'verify-order-state.json')

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail: String(detail) })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`)
}

function makeWav(file, freq) {
  if (fs.existsSync(file) && fs.statSync(file).size > 1000) return file
  spawnSync(
    FFMPEG,
    ['-y', '-f', 'lavfi', '-i', `sine=frequency=${freq}:duration=1`, '-c:a', 'pcm_s16le', file],
    { encoding: 'utf-8', timeout: 60000 }
  )
  return file
}

const { app, BrowserWindow } = require('electron')

// 每轮用全新的 userData（由 runner 传进来），否则上一轮的 playlist.json
// 会让 phase1 一启动就已经是正确顺序，测试就失去意义了。
const UD = process.env.AURORA_TEST_USERDATA || path.join(os.tmpdir(), 'aurora-ud-order')
if (!PHASE2) fs.rmSync(UD, { recursive: true, force: true })
fs.mkdirSync(UD, { recursive: true })
app.setPath('userData', UD)

require(path.join(ROOT, 'dist-electron', 'main', 'index.js'))

const waitWindow = async () => {
  for (let i = 0; i < 30; i++) {
    const w = BrowserWindow.getAllWindows()[0]
    if (w) return w
    await new Promise((r) => setTimeout(r, 400))
  }
  return null
}

if (PHASE2) {
  app.whenReady().then(async () => {
    const win = await waitWindow()
    if (!win) {
      console.log('PHASE2 ' + JSON.stringify({ ok: false }))
      app.exit(0)
      return
    }
    const js = (code) => win.webContents.executeJavaScript(code, true)
    for (let i = 0; i < 50; i++) {
      if (await js(`!!document.querySelector('.playlist')`).catch(() => false)) break
      await new Promise((r) => setTimeout(r, 400))
    }
    let names = []
    for (let i = 0; i < 40; i++) {
      names = JSON.parse(
        await js(`JSON.stringify(Array.from(document.querySelectorAll('.track__name')).map(e => (e.textContent||'').trim()))`)
      )
      if (names.length >= 3) break
      await new Promise((r) => setTimeout(r, 500))
    }
    console.log('PHASE2 ' + JSON.stringify({ names }))
    app.exit(0)
  })
} else {
  if (!LIB) {
    check('拿到临时音乐库', false, '缺少 AURORA_LIBRARY_DIR')
    finish()
  } else {
    fs.rmSync(LIB, { recursive: true, force: true })
    fs.mkdirSync(LIB, { recursive: true })

    // 三个文件，名字顺序（字母序 aa<mm<zz）与拖入顺序（zz→mm→aa）刻意相反，
    // 这样只要顺序被"扫描排序"覆盖，测试就会失败。
    const src = path.join(os.tmpdir(), 'aurora-order-src')
    fs.mkdirSync(src, { recursive: true })
    const f1 = makeWav(path.join(src, 'order-zz.wav'), 440)
    const f2 = makeWav(path.join(src, 'order-mm.wav'), 550)
    const f3 = makeWav(path.join(src, 'order-aa.wav'), 660)

    app.whenReady().then(async () => {
      const win = await waitWindow()
      if (!win) {
        check('应用启动', false, 'no window')
        return finish()
      }
      check('应用启动', true)
      const js = (code) => win.webContents.executeJavaScript(code, true)

      for (let i = 0; i < 50; i++) {
        if (await js(`!!document.querySelector('.playlist')`).catch(() => false)) break
        await new Promise((r) => setTimeout(r, 400))
      }

      // 依次拖入：zz → mm → aa
      const drop = async (file) => {
        win.webContents.debugger.attach('1.3')
        try {
          const data = { items: [], files: [file], dragOperationsMask: 1 }
          const geo = JSON.parse(await js(`JSON.stringify({w: innerWidth, h: innerHeight})`))
          const x = Math.round(geo.w / 2)
          const y = Math.round(geo.h / 2)
          for (const type of ['dragEnter', 'dragOver', 'drop']) {
            win.webContents.debugger.sendCommand('Input.dispatchDragEvent', { type, x, y, data })
            await new Promise((r) => setTimeout(r, 200))
          }
        } finally {
          try {
            win.webContents.debugger.detach()
          } catch {
            /* ignore */
          }
        }
      }

      // 前两个文件正常等待，让顺序稳定下来
      for (const f of [f1, f2]) {
        await drop(f)
        await new Promise((r) => setTimeout(r, 1200))
      }

      // 第三个文件：一出现在列表里就立刻退出。
      // 主进程的写盘防抖是 250ms，这里必须抢在它之前退出，
      // 才能真正考验"退出时同步 flush"这条路径。
      await drop(f3)
      for (let i = 0; i < 40; i++) {
        const n = await js(`document.querySelectorAll('.track').length`)
        if (n >= 3) break
        await new Promise((r) => setTimeout(r, 50))
      }

      let names = []
      for (let i = 0; i < 30; i++) {
        names = JSON.parse(
          await js(`JSON.stringify(Array.from(document.querySelectorAll('.track__name')).map(e => (e.textContent||'').trim()))`)
        )
        if (names.length >= 3) break
        await new Promise((r) => setTimeout(r, 400))
      }

      const expected = ['order-zz', 'order-mm', 'order-aa']
      check('拖入后界面顺序即为拖入顺序', JSON.stringify(names) === JSON.stringify(expected), names.join(' / '))

      fs.writeFileSync(STATE, JSON.stringify({ expected, namesInPhase1: names }, null, 2), 'utf-8')

      // 记录退出前索引是否已经落盘（防抖被调大后应当还没写）
      const indexPath = path.join(UD, 'playlist.json')
      console.log('退出前 playlist.json 已存在: ' + fs.existsSync(indexPath))

      // 模拟"加完立刻关"：不再等待，直接退出（触发 before-quit 同步 flush）。
      // AURORA_SKIP_FLUSH=1 用来做对照实验：绕过 before-quit，
      // 应当丢掉刚加的 3 首（验证测试本身有足够的灵敏度）。
      if (process.env.AURORA_SKIP_FLUSH === '1') {
        console.log('（对照：跳过 flush）')
        app.exit(0)
      } else {
        app.quit()
      }
    })
  }

  function finish() {
    const failed = results.filter((r) => !r.ok)
    console.log(`\n=== ${results.length - failed.length}/${results.length} 通过 ===`)
    if (failed.length) console.log('失败项: ' + failed.map((f) => f.name).join(', '))
    fs.writeFileSync(path.join(ROOT, 'verify-playlist-order.json'), JSON.stringify(results, null, 2))
    app.exit(failed.length === 0 ? 0 : 1)
  }
}
