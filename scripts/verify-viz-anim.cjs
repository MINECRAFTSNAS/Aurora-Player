/**
 * 验证频谱在"播放 ↔ 暂停"之间是渐变而不是瞬间跳变。
 *
 * 判定依据不是看代码，而是按时间采样画布着墨量（alpha > 40 的像素数），
 * 得到一条真实的曲线：
 *   - 暂停后必须出现"中间态"（既不是满值也不是 0），并在 ~1s 内收敛到 0
 *   - 恢复播放后必须从 0 逐渐爬升，而不是一帧到顶
 *
 * 采样在页面内完成（performance.now + canvas 回读），避免 CDP 往返带来的时间误差。
 *
 * 用法：electron.exe scripts/verify-viz-anim.cjs
 *      （或 node scripts/verify-viz-anim-runner.cjs 以隔离音乐库）
 */
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { spawnSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
const FFMPEG = path.join('D:', 'Test', 'AI', 'aurora-tools', 'resources', 'bin', 'ffmpeg.exe')

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail: String(detail) })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`)
}

const { app, BrowserWindow } = require('electron')

// 独立 userData：不读写用户真实歌单/设置，也避免和其他测试串味
const TEST_USERDATA = path.join(os.tmpdir(), 'aurora-ud-viz')
fs.rmSync(TEST_USERDATA, { recursive: true, force: true })
fs.mkdirSync(TEST_USERDATA, { recursive: true })
app.setPath('userData', TEST_USERDATA)

const LIB = process.env.AURORA_LIBRARY_DIR
if (!LIB) {
  check('拿到临时音乐库路径', false, '请通过 verify-viz-anim-runner.cjs 运行')
  app.whenReady().then(() => app.exit(1))
} else {
  fs.rmSync(LIB, { recursive: true, force: true })
  fs.mkdirSync(LIB, { recursive: true })
  const tone = path.join(LIB, 'viz-tone.wav')
  spawnSync(
    FFMPEG,
    ['-y', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=30', '-c:a', 'pcm_s16le', tone],
    { encoding: 'utf-8', timeout: 60000 }
  )

  require(path.join(ROOT, 'dist-electron', 'main', 'index.js'))

  app.whenReady().then(async () => {
    let win = null
    for (let i = 0; i < 30; i++) {
      win = BrowserWindow.getAllWindows()[0]
      if (win) break
      await new Promise((r) => setTimeout(r, 400))
    }
    if (!win) {
      check('应用启动', false, 'no window')
      return finish()
    }
    const js = (code) => win.webContents.executeJavaScript(code, true)

    for (let i = 0; i < 50; i++) {
      if (await js(`!!document.querySelector('.playerbar__viz canvas') && document.querySelectorAll('.track').length > 0`).catch(() => false)) break
      await new Promise((r) => setTimeout(r, 400))
    }

    const hasTrack = await js(`document.querySelectorAll('.track').length > 0`)
    check('音乐库里的测试音频已就绪', hasTrack)
    if (!hasTrack) return finish()

    // 整段采样在页面内完成；用 requestAnimationFrame 逐帧取值，
    // 不会漏帧，也不受 CDP 往返延迟影响
    const raw = await js(`(async () => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms))
      const canvas = document.querySelector('.playerbar__viz canvas')
      if (!canvas) return JSON.stringify({ error: 'no canvas' })
      const ctx = canvas.getContext('2d')
      const ink = () => {
        const w = canvas.width, h = canvas.height
        const d = ctx.getImageData(0, 0, w, h).data
        let n = 0
        for (let i = 3; i < d.length; i += 4) if (d[i] > 40) n++
        return n
      }
      /** 逐帧采样：每个 rAF 记录一次 */
      const rafSample = (ms) => new Promise((resolve) => {
        const seq = []
        const t0 = performance.now()
        const loop = () => {
          seq.push([Math.round(performance.now() - t0), ink()])
          if (performance.now() - t0 < ms) requestAnimationFrame(loop)
          else resolve(seq)
        }
        requestAnimationFrame(loop)
      })

      const playBtn = document.querySelector('.icon-btn--primary')
      if (!playBtn) return JSON.stringify({ error: 'no play button' })

      // 1) 播放并等分析器稳定（3s，确保不是半预热状态）
      document.querySelectorAll('.track__main')[0].click()
      await sleep(3000)
      const playing = await rafSample(400)

      // 2) 暂停：采样衰减曲线
      playBtn.click()
      const pause = await rafSample(1400)

      // 3) 恢复：采样爬升曲线
      await sleep(300)
      playBtn.click()
      const resume = await rafSample(900)

      return JSON.stringify({ playing, pause, resume })
    })()`)

    let D = null
    try {
      D = JSON.parse(raw)
    } catch {
      D = { error: 'bad json' }
    }

    if (!D || D.error) {
      check('采样频谱数据', false, D?.error ?? '解析失败')
      return finish()
    }

    const median = (arr) => {
      const s = [...arr].sort((a, b) => a - b)
      return s.length ? s[Math.floor(s.length / 2)] : 0
    }

    // 播放基线：取最后 5 帧的中位数（此时分析器已稳定）
    const vals = (samples) => samples.map((x) => x[1])
    const playVals = vals(D.playing)
    const base = median(playVals.slice(-5))
    check('播放时频谱有内容', base > 500, `基线着墨量 ${base}（像素）`)

    // ---- 暂停：必须出现中间态，并最终归零 ----
    const pauseVals = vals(D.pause)
    const intermediates = pauseVals.filter((v) => v > base * 0.05 && v < base * 0.8)
    const pEnd = median(pauseVals.slice(-5))

    check(
      '暂停后不是瞬间归零（存在中间态帧）',
      intermediates.length >= 3,
      `中间态 ${intermediates.length} 帧，前几帧：${intermediates.slice(0, 4).join(', ')}（基线 ${base}）`
    )
    check(
      '暂停后呈衰减趋势',
      pauseVals[0] > pauseVals[Math.floor(pauseVals.length / 2)] && pauseVals[Math.floor(pauseVals.length / 2)] >= pEnd,
      `起始=${pauseVals[0]} → 中段=${pauseVals[Math.floor(pauseVals.length / 2)]} → 结束=${pEnd}`
    )
    check('暂停约 1.4s 后基本归零', pEnd < base * 0.05, `结束值 ${pEnd}（基线 ${base}）`)

    // ---- 恢复：逐帧看爬升，而不是"一帧到顶" ----
    const resumeVals = vals(D.resume)
    const steady = median(resumeVals.slice(-5))
    // 落在 15%~85% 之间的帧数：瞬间跳变时最多 1 帧，渐变时会有好几帧
    const rampFrames = resumeVals.filter((v) => v > steady * 0.15 && v < steady * 0.85)

    check('恢复播放后能回到稳定水平', steady > base * 0.5, `稳定值 ${steady}（之前基线 ${base}）`)
    check(
      '恢复播放时是渐变爬升（不是一帧到顶）',
      rampFrames.length >= 3,
      `过渡帧 ${rampFrames.length} 个：${rampFrames.slice(0, 5).join(', ')}（稳定值 ${steady}）`
    )
    check(
      '恢复播放从接近 0 开始',
      resumeVals[0] < steady * 0.3,
      `首帧=${resumeVals[0]} vs 稳定值 ${steady}`
    )

    finish()
  })

  function finish() {
    const failed = results.filter((r) => !r.ok)
    console.log(`\n=== ${results.length - failed.length}/${results.length} 通过 ===`)
    if (failed.length) console.log('失败项: ' + failed.map((f) => f.name).join(', '))
    fs.writeFileSync(path.join(ROOT, 'verify-viz-anim.json'), JSON.stringify(results, null, 2))
    app.exit(failed.length === 0 ? 0 : 1)
  }
}
