/**
 * 用临时音乐库跑频谱动画验证（避免碰用户真实的 Music 文件夹）。
 *
 * 用法：node scripts/verify-viz-anim-runner.cjs
 */
const path = require('node:path')
const os = require('node:os')
const { spawnSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const SCRIPT = path.join(__dirname, 'verify-viz-anim.cjs')
const TEST_LIB = path.join(os.tmpdir(), 'aurora-viz-lib')

const env = {
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE')),
  AURORA_LIBRARY_DIR: TEST_LIB
}

const r = spawnSync(ELECTRON, [SCRIPT], { cwd: ROOT, encoding: 'utf-8', timeout: 180000, env })
process.stdout.write(r.stdout || '')
if (r.stderr) process.stderr.write(r.stderr)
process.exit(r.status ?? 1)
