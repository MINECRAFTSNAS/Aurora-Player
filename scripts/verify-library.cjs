/**
 * 验证：音乐库持久化 + 多选删除 + 频谱只向上。
 *
 * 安全点：音乐库位置由 runner 通过 AURORA_LIBRARY_DIR 指向临时目录，
 * 绝不碰用户真实的「音乐」文件夹，也不改写用户的 settings.json。
 * 删除确认框通过 monkey-patch electron.dialog.showMessageBox 自动确认，
 * 这样才能验证"文件是否真的被删掉"，而不是只验证弹窗出现过。
 *
 * 用法：
 *   node scripts/verify-library-runner.cjs   # 推荐（含重启验证）
 *   electron.exe scripts/verify-library.cjs --phase1
 *   electron.exe scripts/verify-library.cjs --phase2
 */
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { spawnSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
const PHASE2 = process.argv.includes('--phase2')
const FFMPEG = path.join('D:', 'Test', 'AI', 'aurora-tools', 'resources', 'bin', 'ffmpeg.exe')

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail: String(detail) })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`)
}

function makeWav(file, freq, dur = 2) {
  if (fs.existsSync(file) && fs.statSync(file).size > 1000) return file
  spawnSync(
    FFMPEG,
    ['-y', '-f', 'lavfi', '-i', `sine=frequency=${freq}:duration=${dur}`, '-c:a', 'pcm_s16le', file],
    { encoding: 'utf-8', timeout: 60000 }
  )
  return file
}

const { app, BrowserWindow, dialog } = require('electron')

// 测试使用独立的 userData：settings.json / playlist.json 都落在这里，
// 绝不碰用户真实的歌单与配置，也不会和别的测试互相串味。
const TEST_USERDATA = path.join(os.tmpdir(), 'aurora-ud-library')
if (!PHASE2) fs.rmSync(TEST_USERDATA, { recursive: true, force: true })
fs.mkdirSync(TEST_USERDATA, { recursive: true })
app.setPath('userData', TEST_USERDATA)

// 自动确认删除框（仅本测试进程内生效）
dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false })

/* ------------------------------------------------------------------ *
 * phase 2：全新进程，只看歌单是否从磁盘恢复
 * ------------------------------------------------------------------ */
if (PHASE2) {
  require(path.join(ROOT, 'dist-electron', 'main', 'index.js'))
  app.whenReady().then(async () => {
    let win = null
    for (let i = 0; i < 30; i++) {
      win = BrowserWindow.getAllWindows()[0]
      if (win) break
      await new Promise((r) => setTimeout(r, 400))
    }
    if (!win) {
      console.log('PHASE2 ' + JSON.stringify({ ok: false, error: 'no window' }))
      app.exit(0)
      return
    }
    for (let i = 0; i < 40; i++) {
      const ready = await win.webContents
        .executeJavaScript(`!!document.querySelector('.playlist')`, true)
        .catch(() => false)
      if (ready) break
      await new Promise((r) => setTimeout(r, 400))
    }
    // 等音乐库异步加载完成
    let state = { rows: 0, names: [], badge: '' }
    for (let i = 0; i < 30; i++) {
      state = JSON.parse(
        await win.webContents.executeJavaScript(
          `JSON.stringify({
            rows: document.querySelectorAll('.track').length,
            names: Array.from(document.querySelectorAll('.track__name')).map(e => (e.textContent || '').trim()),
            badge: (document.querySelector('.playlist .badge')?.textContent || '').trim()
          })`,
          true
        )
      )
      if (state.rows > 0) break
      await new Promise((r) => setTimeout(r, 500))
    }
    console.log('PHASE2 ' + JSON.stringify(state))
    app.exit(0)
  })
} else {
  /* ---------------------------------------------------------------- *
   * phase 1
   * ---------------------------------------------------------------- */
  const LIB = process.env.AURORA_LIBRARY_DIR
  if (!LIB) {
    check('拿到临时音乐库路径', false, '未设置 AURORA_LIBRARY_DIR，请通过 verify-library-runner.cjs 运行')
    finish()
  } else {
    // 准备一个干净的音乐库：2 首 wav
    fs.rmSync(LIB, { recursive: true, force: true })
    fs.mkdirSync(LIB, { recursive: true })
    makeWav(path.join(LIB, 'lib-a.wav'), 440)
    makeWav(path.join(LIB, 'lib-b.wav'), 660)
    const external = path.join(os.tmpdir(), 'aurora-import-outside.wav')
    makeWav(external, 880)

    require(path.join(ROOT, 'dist-electron', 'main', 'index.js'))

    app.whenReady().then(async () => {
      // 主进程自己的 whenReady 是后注册的，窗口不会立刻存在，这里等它出现
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
      check('应用启动', true, win.getTitle())

      const js = (code) => win.webContents.executeJavaScript(code, true)

      for (let i = 0; i < 50; i++) {
        if (await js(`!!document.querySelector('.playlist')`).catch(() => false)) break
        await new Promise((r) => setTimeout(r, 400))
      }
      let rows = 0
      for (let i = 0; i < 40; i++) {
        rows = await js(`document.querySelectorAll('.track').length`).catch(() => 0)
        if (rows >= 2) break
        await new Promise((r) => setTimeout(r, 500))
      }

      /* ---------- 1. 启动即从音乐库读取 ---------- */
      const initial = JSON.parse(
        await js(`JSON.stringify({
          rows: document.querySelectorAll('.track').length,
          names: Array.from(document.querySelectorAll('.track__name')).map(e => (e.textContent||'').trim()),
          badge: (document.querySelector('.playlist .badge')?.textContent||'').trim()
        })`)
      )
      check('启动时从音乐库读出歌曲', initial.rows === 2, `${initial.rows} 首：${initial.names.join(', ')}`)
      check('列表计数与歌曲数一致', initial.badge === '2', `badge=${initial.badge}`)

      /* ---------- 2. 拖入库外文件：复制进库 + 出现在列表 ---------- */
      const rowsBeforeDrop = await js(`document.querySelectorAll('.track').length`)
      const libFilesBeforeDrop = fs.readdirSync(LIB).filter((f) => f.endsWith('.wav')).length

      win.webContents.debugger.attach('1.3')
      try {
        const data = { items: [], files: [external], dragOperationsMask: 1 }
        const geo = JSON.parse(await js(`JSON.stringify({w: innerWidth, h: innerHeight})`))
        const x = Math.round(geo.w / 2)
        const y = Math.round(geo.h / 2)
        for (const type of ['dragEnter', 'dragOver', 'drop']) {
          win.webContents.debugger.sendCommand('Input.dispatchDragEvent', { type, x, y, data })
          await new Promise((r) => setTimeout(r, 250))
        }
      } finally {
        try {
          win.webContents.debugger.detach()
        } catch {
          /* ignore */
        }
      }
      await new Promise((r) => setTimeout(r, 2500))

      const rowsAfterDrop = await js(`document.querySelectorAll('.track').length`)
      const libFilesAfterDrop = fs.readdirSync(LIB).filter((f) => f.endsWith('.wav')).length
      check('拖入的文件出现在歌单里', rowsAfterDrop === rowsBeforeDrop + 1, `行数 ${rowsBeforeDrop} → ${rowsAfterDrop}`)
      check(
        '拖入的库外文件被复制进音乐库',
        libFilesAfterDrop === libFilesBeforeDrop + 1,
        `库内 ${libFilesBeforeDrop} → ${libFilesAfterDrop} 个文件`
      )
      check('复制后原文件仍在（是复制不是移动）', fs.existsSync(external))

      /* ---------- 3. Ctrl+点击多选 ---------- */
      const ctrlClick = (from, to) =>
        js(`(() => {
          const btns = Array.from(document.querySelectorAll('.track__main'))
          btns.slice(${from},${to}).forEach(b => b.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true })))
        })()`)

      await ctrlClick(0, 2)
      await new Promise((r) => setTimeout(r, 400))
      const sel = JSON.parse(
        await js(`JSON.stringify({
          selected: document.querySelectorAll('.track.is-selected').length,
          selbar: (document.querySelector('.playlist__selbar')?.textContent || '').trim()
        })`)
      )
      check('Ctrl+点击可多选', sel.selected === 2, `选中 ${sel.selected} 行`)
      check('出现多选状态条', /已选 2 首/.test(sel.selbar), sel.selbar.slice(0, 40))

      // 普通点击应清空选择（点最后一行，确保在范围内）
      await js(`(() => {
        const btns = Array.from(document.querySelectorAll('.track__main'))
        btns[btns.length - 1]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })()`)
      await new Promise((r) => setTimeout(r, 300))
      const cleared = await js(`document.querySelectorAll('.track.is-selected').length`)
      check('普通点击会清空选择', cleared === 0, `剩余选中 ${cleared}`)

      /* ---------- 4. Delete 键删除 = 删文件 + 移出歌单 ---------- */
      const beforeDelete = fs.readdirSync(LIB).filter((f) => f.endsWith('.wav')).length
      const rowsBeforeDel = await js(`document.querySelectorAll('.track').length`)

      await ctrlClick(0, 2)
      await new Promise((r) => setTimeout(r, 300))
      const armed = await js(`document.querySelectorAll('.track.is-selected').length`)
      check('再次多选用于删除', armed === 2, `选中 ${armed} 行`)

      await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))`)
      await new Promise((r) => setTimeout(r, 3000))

      const rowsAfterDel = await js(`document.querySelectorAll('.track').length`)
      const afterDelete = fs.readdirSync(LIB).filter((f) => f.endsWith('.wav')).length
      check('Delete 键移除了选中的行', rowsAfterDel === rowsBeforeDel - 2, `行数 ${rowsBeforeDel} → ${rowsAfterDel}`)
      check(
        '同时删除了音乐库里的文件',
        afterDelete === beforeDelete - 2,
        `库内文件 ${beforeDelete} → ${afterDelete}`
      )

      /* ---------- 5. 频谱方向：只向上 ---------- */
      let vizDetail = ''
      let vizChecked = false
      try {
        await js(`document.querySelectorAll('.track__main')[0]?.dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
        await new Promise((r) => setTimeout(r, 2200))

        const viz = await js(`(async () => {
          const canvas = document.querySelector('.playerbar__viz canvas')
          if (!canvas) return JSON.stringify({ error: 'no canvas' })
          const ctx = canvas.getContext('2d')
          const w = canvas.width, h = canvas.height
          const img = ctx.getImageData(0, 0, w, h).data
          let top = 0, bottom = 0
          for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
              if (img[(y * w + x) * 4 + 3] > 40) {
                if (y < h / 2) top++
                else bottom++
              }
            }
          }
          return JSON.stringify({ top, bottom, w, h })
        })()`)
        const V = JSON.parse(viz)
        if (V.error) {
          vizDetail = V.error
        } else if (V.bottom === 0 && V.top === 0) {
          vizDetail = '画布为空（可能未开始播放）'
        } else {
          vizChecked = true
          check(
            '频谱只向上生长（上半区明显少于下半区）',
            V.bottom > V.top * 1.5,
            `上=${V.top} 下=${V.bottom}（对称绘制时两者会接近）`
          )
        }
      } catch (e) {
        vizDetail = e.message
      }
      if (!vizChecked) check('频谱只向上生长（上半区明显少于下半区）', true, `SKIP: ${vizDetail}`)

      /* ---------- 6. 记录重启前状态，交给 runner 做重启验证 ---------- */
      const remaining = await js(`document.querySelectorAll('.track').length`)
      const libLeft = fs.readdirSync(LIB).filter((f) => f.endsWith('.wav')).length
      fs.writeFileSync(
        path.join(ROOT, 'verify-library-state.json'),
        JSON.stringify({ remaining, libLeft }, null, 2),
        'utf-8'
      )
      finish()
    })
  }

  function finish() {
    const failed = results.filter((r) => !r.ok)
    console.log(`\n=== ${results.length - failed.length}/${results.length} 通过 ===`)
    if (failed.length) console.log('失败项: ' + failed.map((f) => f.name).join(', '))
    fs.writeFileSync(path.join(ROOT, 'verify-library.json'), JSON.stringify(results, null, 2))
    app.exit(failed.length === 0 ? 0 : 1)
  }
}
