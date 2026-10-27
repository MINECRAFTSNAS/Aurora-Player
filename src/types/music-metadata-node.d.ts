/**
 * music-metadata 是 ESM-only 包，且 exports 分为 node / default 两套入口。
 * `parseFile`、`parseStream` 只存在于 node 入口（lib/index.js），
 * 而 TS 的推荐解析会落到 default 入口（core.d.ts），因此这里补一个声明。
 */
declare module 'music-metadata/lib/index.js' {
  export * from 'music-metadata'
  import type { IAudioMetadata, IOptions } from 'music-metadata'
  import type { Readable } from 'node:stream'

  export function parseFile(filePath: string, options?: IOptions): Promise<IAudioMetadata>
  export function parseStream(
    stream: Readable,
    fileInfo?: unknown,
    options?: IOptions
  ): Promise<IAudioMetadata>
}
