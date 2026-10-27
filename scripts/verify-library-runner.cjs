/**
 * 编排 verify-library 的两个阶段：
 *   phase1：准备临时音乐库 → 导入 / 多选 / 删除 / 频谱断言 → 退出
 *   phase2：全新进程启动 → 检查歌单是否从磁盘恢复
 *
 * 为什么要两个进程：单实例锁不允许同一份 userData 跑两个实例，
 * 而"关闭后歌曲还在"只有真正重启才能验证。
 *
 * 音乐库通过 AURORA_LIBRARY_DIR 指向临时目录，因此不会碰到用户真实的
 * 「音乐」文件夹，也不会改写用户的 settings.json。
 *
 * 用法：node scripts/verify-library-runner.cjs
 */
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { spawnSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const SCRIPT = path.join(__dirname, 'verify-library.cjs')
const STATE = path.join(ROOT, 'verify-library-state.json')
const TEST_LIB = path.join(os.tmpdir(), 'aurora-library-test')

const env = {
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE')),
  AURORA_LIBRARY_DIR: TEST_LIB
}

const run = (flag) =>
  spawnSync(ELECTRON, [SCRIPT, flag], { cwd: ROOT, encoding: 'utf-8', timeout: 180000, env })

try {
  fs.unlinkSync(STATE)
} catch {
  /* ignore */
}

console.log('=== phase 1：音乐库 / 导入 / 多选 / 删除 / 频谱 ===')
const p1 = run('--phase1')
process.stdout.write(p1.stdout || '')
if (p1.stderr) process.stderr.write(p1.stderr)

let state = null
try {
  state = JSON.parse(fs.readFileSync(STATE, 'utf-8'))
} catch {
  state = null
}

console.log('\n=== phase 2：重启后检查歌单 ===')
const p2 = run('--phase2')
const line = (p2.stdout || '').split(/\r?\n/).find((l) => l.startsWith('PHASE2 '))

let restored = null
try {
  restored = line ? JSON.parse(line.slice('PHASE2 '.length)) : null
} catch {
  restored = null
}

const ok = !!state && !!restored && state.remaining > 0 && restored.rows === state.remaining
console.log(
  `${ok ? 'PASS' : 'FAIL'}  重启后歌单未丢失 :: ` +
    (restored
      ? `重启前 ${state ? state.remaining : '?'} 首 → 重启后 ${restored.rows} 首：${(restored.names || []).join(', ')}`
      : `phase2 无输出 ${(p2.stdout || p2.stderr || '').slice(-200)}`)
)

const p1Failed = p1.status !== 0
if (p1Failed) console.log('\n(phase 1 有失败项，详见上面输出)')

const exitCode = ok && !p1Failed ? 0 : 1
console.log(`\n=== 结论：${exitCode === 0 ? '全部通过' : '存在失败'} ===`)
process.exit(exitCode)
