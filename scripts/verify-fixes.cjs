/**
 * 针对用户反馈的 3 个 Player 问题的回归验证。
 *
 * 用法：node scripts/verify-fixes.cjs
 *
 * 1) 频谱柱不再压在按键上，而是播放栏底部独立一条
 * 2) 弹出的选择框（音量浮层）不再被背景遮挡
 * 3) 悬停按键出现文字提示
 */
const path = require('node:path')
const fs = require('node:fs')
const http = require('node:http')

const ROOT = path.resolve(__dirname, '..')
const PORT = 9689
const EXE = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail: String(detail) })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`)
}

function cdpGet(p) {
  return new Promise((resolve, reject) => {
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
}

function connectWs(url, onMessage) {
  return new Promise((resolve, reject) => {
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
}

async function main() {
  const { spawn } = require('node:child_process')
  // 独立 userData / 音乐库，避免读写用户真实配置
  const TEST_USERDATA = path.join(require('node:os').tmpdir(), 'aurora-ud-fixes')
  const TEST_LIB = path.join(require('node:os').tmpdir(), 'aurora-fixes-lib')
  fs.rmSync(TEST_USERDATA, { recursive: true, force: true })
  fs.rmSync(TEST_LIB, { recursive: true, force: true })
  fs.mkdirSync(TEST_USERDATA, { recursive: true })
  fs.mkdirSync(TEST_LIB, { recursive: true })
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
  const evaluate = (expression) =>
    new Promise((resolve, reject) => {
      const myId = ++id
      pending.set(myId, (msg) => {
        if (msg.result?.exceptionDetails) {
          reject(new Error(msg.result.exceptionDetails.text + ' ' + (msg.result.exceptionDetails.exception?.description || '')))
        } else resolve(msg.result?.result?.value)
      })
      ws.send(
        JSON.stringify({
          id: myId,
          method: 'Runtime.evaluate',
          params: { expression, awaitPromise: true, returnByValue: true }
        })
      )
      setTimeout(() => {
        if (pending.has(myId)) {
          pending.delete(myId)
          reject(new Error('evaluate timeout'))
        }
      }, 60000)
    })

  for (let i = 0; i < 40; i++) {
    if (await evaluate(`!!document.querySelector('.playerbar')`).catch(() => false)) break
    await new Promise((r) => setTimeout(r, 400))
  }

  /* ============ 问题 1：可视化条在底部，不压按键 ============ */
  const layout = await evaluate(`JSON.stringify((() => {
    const viz = document.querySelector('.playerbar__viz')
    const inner = document.querySelector('.playerbar__inner')
    const transport = document.querySelector('.transport')
    const playBtn = document.querySelector('.icon-btn--primary')
    const bar = document.querySelector('.playerbar')
    if (!viz || !inner || !transport || !playBtn) return { error: 'missing nodes' }
    const vr = viz.getBoundingClientRect()
    const ir = inner.getBoundingClientRect()
    const tr = transport.getBoundingClientRect()
    const pr = playBtn.getBoundingClientRect()
    const br = bar.getBoundingClientRect()
    // 可视化条与控件区是否重叠
    const overlapInner = !(vr.bottom <= ir.top + 0.5 || vr.top >= ir.bottom - 0.5)
    const overlapPlay = !(vr.bottom <= pr.top + 0.5 || vr.top >= pr.bottom - 0.5)
    return {
      vizTop: Math.round(vr.top), vizBottom: Math.round(vr.bottom),
      innerTop: Math.round(ir.top), innerBottom: Math.round(ir.bottom),
      playBottom: Math.round(pr.bottom),
      barBottom: Math.round(br.bottom),
      posViz: getComputedStyle(viz).position,
      overlapInner, overlapPlay,
      vizBelowControls: vr.top >= ir.bottom - 0.5,
      vizAtBarBottom: Math.abs(vr.bottom - br.bottom) < 14,
      transportBottom: Math.round(tr.bottom)
    }
  })())`)
  const Y = JSON.parse(layout)
  if (Y.error) {
    check('布局节点存在', false, Y.error)
  } else {
    check('可视化条位于控件区下方（不再压在按键上）', Y.vizBelowControls === true, `viz.top=${Y.vizTop} inner.bottom=${Y.innerBottom}`)
    check('可视化条与控件区无重叠', Y.overlapInner === false && Y.overlapPlay === false, `overlapInner=${Y.overlapInner} overlapPlay=${Y.overlapPlay}`)
    check('可视化条贴在播放栏底部', Y.vizAtBarBottom === true, `viz.bottom=${Y.vizBottom} bar.bottom=${Y.barBottom}`)
    check('可视化条已改为正常文档流（非绝对定位背景）', Y.posViz === 'relative', `position=${Y.posViz}`)
  }

  /* ============ 问题 2：音量浮层不再被背景遮挡 ============ */
  // React 的 onMouseEnter 是由 mouseover/mouseout 合成的；
  // 直接派发 mouseenter 不冒泡、React 收不到，所以这里必须用 mouseover。
  const flyout = await evaluate(`JSON.stringify((() => {
    const bar = document.querySelector('.playerbar')
    const barStyle = getComputedStyle(bar)
    const vol = document.querySelector('.volume')
    const btn = vol?.querySelector('.icon-btn')
    if (!vol || !btn) return { error: 'no volume' }
    btn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }))
    return { barOverflow: barStyle.overflow, barZ: barStyle.zIndex, ok: true }
  })())`)
  const F0 = JSON.parse(flyout)
  const flyoutState = await evaluate(`(async () => {
    // 窗口不可见时 Chromium 会节流 CSS 过渡，这里轮询等它真正显现，
    // 避免把"动画还没跑完"误判成"浮层没打开"。
    const t0 = Date.now()
    let f = null
    let last = null
    while (Date.now() - t0 < 3500) {
      f = document.querySelector('.volume__flyout')
      if (f) {
        const op = Number(getComputedStyle(f).opacity)
        last = op
        if (op > 0.9) break
      }
      await new Promise((r) => setTimeout(r, 120))
    }
    if (!f) return JSON.stringify({ error: 'no flyout' })
    const cs = getComputedStyle(f)
    const r = f.getBoundingClientRect()
    const open = f.classList.contains('is-open')
    const inView = r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth
    let topmost = null
    if (cs.pointerEvents !== 'none') {
      const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      topmost = f.contains(el)
    }
    const bar = document.querySelector('.playerbar').getBoundingClientRect()
    return JSON.stringify({
      open,
      opacity: cs.opacity,
      settled: Number(cs.opacity) > 0.9,
      last,
      pe: cs.pointerEvents,
      topmost,
      inView,
      extendsAboveBar: r.top < bar.top,
      top: Math.round(r.top),
      barTop: Math.round(bar.top),
      w: Math.round(r.width),
      h: Math.round(r.height)
    })
  })()`)
  const F = JSON.parse(flyoutState)
  check('播放栏不再裁切溢出内容（overflow≠hidden）', F0.barOverflow !== 'hidden', `overflow=${F0.barOverflow}`)
  check('音量浮层可展开（is-open 且 pointer-events:auto）', F.error ? false : F.open === true && F.pe === 'auto', F.error ?? `pointer-events=${F.pe}`)
  if (!F.error) {
    check('音量浮层最终可见（opacity 收敛到 1）', F.settled === true, `opacity=${F.opacity}`)
    check('音量浮层完整位于视口内', F.inView === true, `top=${F.top} ${F.w}x${F.h}`)
    check('音量浮层向上溢出播放栏（未被裁切）', F.extendsAboveBar === true, `flyout.top=${F.top} bar.top=${F.barTop}`)
    check('音量浮层位于最上层（命中测试）', F.topmost === true, `pointer-events=${F.pe}`)
  }

  /* ============ 问题 3：悬停提示 ============ */
  const tip = await evaluate(`(async () => {
    const btn = document.querySelector('.volume .icon-btn')
    if (!btn) return 'no-btn'
    btn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    await new Promise(r=>setTimeout(r,400))
    const t = document.querySelector('.aurora-tooltip')
    if (!t) return 'no-tooltip'
    const cs = getComputedStyle(t)
    const r = t.getBoundingClientRect()
    return JSON.stringify({
      text: (t.textContent||'').trim(),
      z: cs.zIndex, pos: cs.position,
      inBody: t.parentElement === document.body,
      inView: r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth,
      nonZero: r.width > 0 && r.height > 0
    })
  })()`)
  let T
  try {
    T = JSON.parse(tip)
  } catch {
    T = tip
  }
  check(
    '悬停音量图标出现文字提示',
    typeof T === 'object' && T.nonZero === true && /音量/.test(T.text),
    typeof T === 'object' ? `"${T.text}"` : T
  )
  check(
    '提示层 portal 挂在 body、fixed 且高层级',
    typeof T === 'object' && T.inBody === true && T.pos === 'fixed' && Number(T.z) >= 99999 && T.inView === true,
    typeof T === 'object' ? `z=${T.z} pos=${T.pos} inView=${T.inView}` : T
  )

  // 再抽查几个按钮都有提示文案
  const tips = await evaluate(`JSON.stringify(Array.from(document.querySelectorAll('[data-tip]')).map(e=>e.getAttribute('data-tip')))`)
  const TIPS = JSON.parse(tips)
  check('播放器按钮普遍带提示文案', TIPS.length >= 8, `${TIPS.length} 个可提示元素，例如：${TIPS.slice(0, 4).join(' / ')}`)

  child.kill()
  await new Promise((r) => setTimeout(r, 1200))
  finish()
}

function finish() {
  const failed = results.filter((r) => !r.ok)
  console.log(`\n=== ${results.length - failed.length}/${results.length} 通过 ===`)
  if (failed.length) console.log('失败项: ' + failed.map((f) => f.name).join(', '))
  fs.writeFileSync(path.join(ROOT, 'verify-fixes.json'), JSON.stringify(results, null, 2))
  process.exit(failed.length === 0 ? 0 : 1)
}

main().catch((e) => {
  check('验证脚本', false, e.message)
  finish()
})
