/** 验证 koffi 传 HWND 的各种方式，找出哪一种是 DWM 认可的 */
const path = require('node:path')
const { app, BrowserWindow } = require('electron')

app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 600, height: 400, frame: false, show: true })
  const koffi = require(path.resolve(__dirname, '..', 'node_modules', 'koffi'))
  const dwm = koffi.load('dwmapi.dll')

  const raw = win.getNativeWindowHandle()
  const value = Number(raw.readBigUInt64LE(0)) // HWND 的整数值
  console.log('HWND value =', value, '0x' + value.toString(16))

  const corner = Buffer.alloc(4)
  corner.writeInt32LE(2, 0)

  const attempts = [
    ['void* + Buffer(原样)', () => dwm.func('int __stdcall DwmSetWindowAttribute(void *h, unsigned long a, void *pv, unsigned long cb)'), raw],
    ['intptr_t + 数值', () => dwm.func('int __stdcall DwmSetWindowAttribute(intptr_t h, unsigned long a, void *pv, unsigned long cb)'), value],
    ['uint64 + BigInt', () => dwm.func('int __stdcall DwmSetWindowAttribute(uint64_t h, unsigned long a, void *pv, unsigned long cb)'), raw.readBigUInt64LE(0)],
    ['void* + koffi.as(raw)', () => dwm.func('int __stdcall DwmSetWindowAttribute(void *h, unsigned long a, void *pv, unsigned long cb)'), koffi.as(raw, 'void *')],
    ['intptr_t + BigInt', () => dwm.func('int __stdcall DwmSetWindowAttribute(intptr_t h, unsigned long a, void *pv, unsigned long cb)'), raw.readBigUInt64LE(0)]
  ]

  for (const [name, mk, arg] of attempts) {
    try {
      const fn = mk()
      const hr = fn(arg, 33, corner, 4)
      console.log(`${name.padEnd(26)} hr = ${hr}  ${hr === 0 ? '<<< OK' : ''}`)
    } catch (e) {
      console.log(`${name.padEnd(26)} 抛错: ${e.message}`)
    }
  }

  app.exit(0)
})
