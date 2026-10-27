/**
 * 验证 Player 的拖放导入是否真的工作。
 *
 * 用 CDP 的 Input.dispatchDragEvent 投递带真实文件路径的拖拽事件，
 * 这是唯一能同时验证「dataTransfer.files 有内容」和「webUtils.getPathForFile 能取到路径」的方法。
 *
 * 用法: node scripts/verify-dnd.cjs
 */
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const http = require('node:http')

const ROOT = path.resolve(__dirname, '..')
const PORT = 9695
const EXE = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const FFMPEG = path.join('D:', 'Test', 'AI', 'aurora-tools', 'resources', 'bin', 'ffmpeg.exe')

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail: String(detail) })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`)
}

const cdpGet = (p) =>
  new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: p, timeout: 4000 }, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => resolve(d))
    })
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('timeout'))
    })
  })

const connectWs = (url, onMessage) =>
  new Promise((resolve, reject) => {
    const WebSocket = require('ws')
    const ws = new WebSocket(url, { perMessageDeflate: false, maxPayload: 64 * 1024 * 1024 })
    ws.on('open', () => resolve(ws))
    ws.on('message', (d) => {
      try {
        onMessage(JSON.parse(d.toString()))
      } catch {
        /* ignore */
      }
    })
    ws.on('error', reject)
  })

function makeWav(name, freq) {
  const dir = path.join(os.tmpdir(), 'aurora-dnd')
  fs.mkdirSync(dir, { recursive: true })
  const out = path.join(dir, name)
  if (fs.existsSync(out) && fs.statSync(out).size > 1000) return out
  const { spawnSync } = require('node:child_process')
  spawnSync(
    FFMPEG,
    ['-y', '-f', 'lavfi', '-i', `sine=frequency=${freq}:duration=1.5`, '-c:a', 'pcm_s16le', out],
    { encoding: 'utf-8', timeout: 60000 }
  )
  return out
}

async function main() {
  const wav1 = makeWav('dnd-alpha.wav', 440)
  const wav2 = makeWav('dnd-beta.wav', 660)
  check('生成测试音频', fs.existsSync(wav1) && fs.existsSync(wav2), `${path.basename(wav1)}, ${path.basename(wav2)}`)

  const { spawn } = require('node:child_process')
  // 拖放会把文件复制进音乐库；指向临时目录，避免污染真实 Music 文件夹
  const TEST_LIB = path.join(os.tmpdir(), 'aurora-dnd-lib')
  fs.rmSync(TEST_LIB, { recursive: true, force: true })
  fs.mkdirSync(TEST_LIB, { recursive: true })
  // 独立 userData：不覆盖用户真实歌单，也避免与其他测试互相干扰
  const TEST_USERDATA = path.join(os.tmpdir(), 'aurora-ud-dnd')
  fs.rmSync(TEST_USERDATA, { recursive: true, force: true })
  fs.mkdirSync(TEST_USERDATA, { recursive: true })
  const child = spawn(
    EXE,
    [`--remote-debugging-port=${PORT}`, `--user-data-dir=${TEST_USERDATA}`, '.'],
    {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE')),
        AURORA_LIBRARY_DIR: TEST_LIB
      }
    }
  )

  let target = null
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 1000))
    try {
      const pages = JSON.parse(await cdpGet('/json/list')).filter((p) => p.type === 'page')
      if (pages.length) {
        target = pages[0]
        break
      }
    } catch {
      /* not ready */
    }
    if (child.exitCode !== null) break
  }
  if (!target) {
    check('应用启动', false, `exit=${child.exitCode}`)
    return finish()
  }

  let id = 0
  const pending = new Map()
  const ws = await connectWs(target.webSocketDebuggerUrl, (msg) => {
    const p = pending.get(msg.id)
    if (p) {
      pending.delete(msg.id)
      p(msg)
    }
  })
  const send = (method, params) =>
    new Promise((resolve, reject) => {
      const myId = ++id
      pending.set(myId, (msg) => {
        if (msg.error) reject(new Error(JSON.stringify(msg.error)))
        else resolve(msg.result)
      })
      ws.send(JSON.stringify({ id: myId, method, params }))
      setTimeout(() => {
        if (pending.has(myId)) {
          pending.delete(myId)
          reject(new Error('timeout ' + method))
        }
      }, 60000)
    })
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text)
    return r.result?.value
  }

  for (let i = 0; i < 40; i++) {
    if (await evaluate(`!!document.querySelector('.playerbar')`).catch(() => false)) break
    await new Promise((r) => setTimeout(r, 400))
  }

  const before = await evaluate(`document.querySelectorAll('.track').length`)
  const size = await evaluate(`JSON.stringify({w: window.innerWidth, h: window.innerHeight})`)
  const S = JSON.parse(size)
  const cx = Math.round(S.w / 2)
  const cy = Math.round(S.h / 2)

  const dragData = {
    items: [],
    files: [wav1, wav2],
    dragOperationsMask: 1
  }

  // 1) dragEnter 应触发遮罩
  await send('Input.dispatchDragEvent', { type: 'dragEnter', x: cx, y: cy, data: dragData })
  await new Promise((r) => setTimeout(r, 400))
  const overlay = await evaluate(`!!document.querySelector('.dropzone')`)
  check('拖入时显示拖放遮罩', overlay === true)

  // 2) dragOver
  await send('Input.dispatchDragEvent', { type: 'dragOver', x: cx, y: cy, data: dragData })
  await new Promise((r) => setTimeout(r, 250))

  // 3) drop
  await send('Input.dispatchDragEvent', { type: 'drop', x: cx, y: cy, data: dragData })
  await new Promise((r) => setTimeout(r, 2500))

  const after = await evaluate(`JSON.stringify({
    rows: document.querySelectorAll('.track').length,
    overlayGone: !document.querySelector('.dropzone'),
    text: (document.querySelector('.playlist, .content')?.innerText || '').replace(/\\s+/g,' ').slice(0, 120),
    titles: Array.from(document.querySelectorAll('.track__name')).map(e=>(e.textContent||'').trim()).slice(0,4)
  })`)
  const A = JSON.parse(after)

  check('拖放后遮罩消失', A.overlayGone === true)
  check('拖入的音频进入播放列表', A.rows > before, `行数 ${before} → ${A.rows}`)
  check('曲目名称已解析出来', A.titles.length > 0, A.titles.join(' / '))
  check('识别到两个文件', A.rows - before === 2, `新增 ${A.rows - before} 条`)

  // 4) 拖入纯文本 URL（不该崩溃，且应给出提示或尝试导入）
  const urlData = {
    items: [{ mimeType: 'text/plain', data: 'https://example.com/nonexistent.mp3' }],
    dragOperationsMask: 1
  }
  await send('Input.dispatchDragEvent', { type: 'dragEnter', x: cx, y: cy, data: urlData })
  await send('Input.dispatchDragEvent', { type: 'drop', x: cx, y: cy, data: urlData })
  await new Promise((r) => setTimeout(r, 2500))
  const stillAlive = await evaluate(`!!document.querySelector('.playerbar')`)
  check('拖入 URL 文本不会让界面崩溃', stillAlive === true)

  child.kill()
  await new Promise((r) => setTimeout(r, 1000))
  finish()
}

function finish() {
  const failed = results.filter((r) => !r.ok)
  console.log(`\n=== ${results.length - failed.length}/${results.length} 通过 ===`)
  if (failed.length) console.log('失败项: ' + failed.map((f) => f.name).join(', '))
  process.exit(failed.length === 0 ? 0 : 1)
}

main().catch((e) => {
  check('验证脚本', false, e.message)
  finish()
})
