/**
 * 歌单顺序持久化验证的编排器：两个进程（加完立刻关 → 全新启动比对）。
 *
 * 用法：node scripts/verify-playlist-order-runner.cjs
 */
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { spawnSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const SCRIPT = path.join(__dirname, 'verify-playlist-order.cjs')
const STATE = path.join(ROOT, 'verify-order-state.json')
const TEST_LIB = path.join(os.tmpdir(), 'aurora-order-lib')
// 每轮一个全新的 userData，避免上一轮的歌单残留影响判定
const TEST_UD = path.join(os.tmpdir(), 'aurora-ud-order-' + Date.now().toString(36))
fs.rmSync(TEST_UD, { recursive: true, force: true })

const env = {
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE')),
  AURORA_LIBRARY_DIR: TEST_LIB,
  AURORA_TEST_USERDATA: TEST_UD,
  // 把写盘防抖拉到 5 秒，保证退出时数据一定还在内存里没落盘，
  // 从而确定性验证"退出时同步 flush"这条路径（而不是靠抢时间）。
  AURORA_SAVE_DEBOUNCE: '5000'
}

try {
  fs.unlinkSync(STATE)
} catch {
  /* ignore */
}

const run = (flag) =>
  spawnSync(ELECTRON, [SCRIPT, flag], { cwd: ROOT, encoding: 'utf-8', timeout: 180000, env })

console.log('=== phase 1：拖入 3 首（zz→mm→aa）后立刻关闭 ===')
const p1 = run('--phase1')
process.stdout.write(p1.stdout || '')
if (p1.stderr) process.stderr.write(p1.stderr)

let state = null
try {
  state = JSON.parse(fs.readFileSync(STATE, 'utf-8'))
} catch {
  state = null
}

console.log('\n=== phase 2：全新进程启动，检查顺序 ===')
const p2 = run('--phase2')
const line = (p2.stdout || '').split(/\r?\n/).find((l) => l.startsWith('PHASE2 '))
let after = null
try {
  after = line ? JSON.parse(line.slice('PHASE2 '.length)) : null
} catch {
  after = null
}

const expected = state?.expected ?? ['order-zz', 'order-mm', 'order-aa']
const ok = !!after && JSON.stringify(after.names) === JSON.stringify(expected)

console.log(
  `${ok ? 'PASS' : 'FAIL'}  重启后顺序保持不变 :: ` +
    (after
      ? `重启前 [${(state?.namesInPhase1 ?? []).join(', ')}] → 重启后 [${after.names.join(', ')}]`
      : `phase2 无输出 ${(p2.stdout || p2.stderr || '').slice(-200)}`)
)

const p1Failed = p1.status !== 0
if (p1Failed) console.log('\n(phase 1 有失败项，详见上面输出)')
const exitCode = ok && !p1Failed ? 0 : 1
console.log(`\n=== 结论：${exitCode === 0 ? '全部通过' : '存在失败'} ===`)
process.exit(exitCode)
