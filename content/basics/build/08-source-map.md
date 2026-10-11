---
difficulty: 2
tags: [高频, 原理, 实践]
---

# Source Map 是什么？生产环境应该怎么用？

::: tip 一句话回答
Source Map 是一个 JSON 文件，记录了**编译后代码的每个位置对应源码的哪个文件、哪一行哪一列**，浏览器开发者工具和错误监控平台用它把压缩、转译后的代码还原成源码来调试。位置信息存在 `mappings` 字段里，用分号分隔行、逗号分隔片段，每个片段用 **Base64 VLQ** 编码记录相对上一个位置的偏移。生产环境推荐生成 **`hidden-source-map`**：产物里不带 `sourceMappingURL` 注释，map 文件只**上传到错误监控平台**、不部署到公开服务器，既能还原线上报错，又不对外暴露源码。
:::

## 详细解析

### 文件结构

```json
{
  "version": 3,
  "file": "main.js",
  "sources": ["webpack://app/./src/utils.js", "webpack://app/./src/index.js"],
  "sourcesContent": ["export function used() {...}", "..."],
  "names": ["used", "console", "log"],
  "mappings": "oBAAAA,EAAAC,QAAA,CACAC,EAAA,IAAQ,Q,GCAR...",
  "sourceRoot": ""
}
```

| 字段 | 含义 |
| --- | --- |
| `sources` | 源文件列表 |
| `sourcesContent` | 源文件的完整内容，有了它不需要原始文件也能还原；也是泄露源码的主要来源 |
| `names` | 压缩前的变量名、属性名 |
| `mappings` | 位置映射，下面展开 |

### mappings 的原理

- 用 `;` 分隔**生成代码的行**，用 `,` 分隔同一行里的**片段**
- 每个片段有 1、4 或 5 个数：生成代码的列、`sources` 的下标、源码的行、源码的列、`names` 的下标
- 所有数字都记录**相对前一个片段的差值**，差值通常很小；再用 **Base64 VLQ** 编码成变长字符，小数字只占一个字符

记录差值加变长编码，让 map 文件比逐个记录绝对坐标小得多。面试时讲到这里就够了，不需要现场解码。

### 怎么关联

- 产物末尾的注释 `//# sourceMappingURL=main.js.map` 告诉浏览器去哪里加载 map 文件，也可以用 `SourceMap` HTTP 响应头指定
- 开发者工具**打开时**才会去请求 map 文件，普通用户访问页面不会下载它，所以 source map 不影响页面加载性能，只影响构建速度和产物目录的大小

### webpack devtool 常见取值

`devtool` 的值由几个关键字组合而成：

| 关键字 | 含义 |
| --- | --- |
| `eval` | 每个模块用 `eval` 包起来，map 内联在模块里，重新构建最快 |
| `cheap` | 只映射到行，不映射到列 |
| `module` | 映射到 loader 处理之前的源码（如 TS、Vue 原文）；没有它只能看到 loader 转换后的代码 |
| `inline` | map 以 data URL 的形式内联在产物里 |
| `hidden` | 生成 map 文件，但产物里不加 `sourceMappingURL` 注释 |
| `nosources` | map 里不包含 `sourcesContent`，能看到文件名和行号，看不到源码 |

| 取值 | 构建 / 重新构建 | 质量 | 适合 |
| --- | --- | --- | --- |
| `eval` | 快 / 最快 | 生成后的代码 | 开发（development 模式默认值） |
| `eval-cheap-module-source-map` | 慢 / 快 | 源码，只到行 | 开发，速度和质量的折中 |
| `eval-source-map` | 最慢 / 一般 | 源码，精确到列 | 开发，需要精确断点 |
| `source-map` | 最慢 / 最慢 | 源码 | 生产，map 公开 |
| `hidden-source-map` | 最慢 / 最慢 | 源码 | 生产，只给错误监控用 |
| `nosources-source-map` | 最慢 / 最慢 | 只有位置，没有源码内容 | 生产，愿意公开位置但不公开源码 |
| `false` | 最快 | 无 | 生产模式默认值 |

Vite 对应的配置是 `build.sourcemap`，可选 `true`、`'inline'`、`'hidden'`，默认 `false`。

### 生产环境的做法

```text
构建（hidden-source-map）
   ├── main.abc123.js（没有 sourceMappingURL）──► 部署到 CDN
   └── main.abc123.js.map ──► 上传到错误监控平台（和发布版本号关联）──► 从产物目录删除
```

线上报错时，监控 SDK 上报压缩后的堆栈（文件名、行、列），平台用对应版本的 map 还原出源码位置，见 [前端监控](/basics/browser/20-monitoring)。关键点：

- map 要和发布版本一一对应，上传时带上 release 版本号，否则会用错误版本的 map 还原
- 上传后从部署目录里删掉 `.map` 文件，或者在 Web 服务器上禁止外网访问
- 内部系统或开源项目可以直接用 `source-map`，方便线上调试；愿意公开报错位置、但不想公开源码内容时，可以用 `nosources-source-map`

## 代码示例

监控平台还原堆栈的核心逻辑，可以用 `source-map` 库演示：

```js
// resolve-stack.mjs：node resolve-stack.mjs dist/main.js.map 288
import fs from 'node:fs'
import { SourceMapConsumer } from 'source-map'

const rawMap = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const column = Number(process.argv[3]) // 压缩后代码通常只有一行，关键是列号

const consumer = await new SourceMapConsumer(rawMap)
// line 从 1 开始，column 从 0 开始
console.log(consumer.originalPositionFor({ line: 1, column }))
// 输出类似 { source: 'webpack://app/src/utils.js', line: 7, column: 26, name: 'globalThis' }
consumer.destroy()
```

不想删 map 文件时，也可以在 Nginx 上只允许内网访问：

```nginx
location ~* \.map$ {
    allow 10.0.0.0/8;
    deny all;
}
```

## 面试官可能追问

::: details 生产环境用 source-map 有什么风险？
任何人打开开发者工具都能看到完整的源码，包括注释、内部接口地址和业务逻辑，相当于把代码开源了。前端代码本来就能被下载和格式化，但压缩后的代码可读性差很多，source map 会把这层门槛完全去掉。代码中不应该有密钥这类敏感信息，这一点和是否开放 source map 无关。
:::

::: details 为什么开发环境常用 eval 系列？
`eval` 系列把每个模块单独包在 `eval` 里，模块的 map 也放在一起。修改一个文件后只需要重新生成这一个模块的代码和 map，不用重新生成整个 chunk 的 map，重新构建很快。代价是产物里都是 `eval` 字符串，只适合开发环境。
:::

::: details 配置了 source map，开发者工具里看到的还是编译后的代码，可能是什么原因？
常见原因：开发者工具里关闭了 JavaScript source map；`sourceMappingURL` 的路径不对，或者 map 文件请求 404；用了不带 `module` 的取值，只能看到 loader 转换后的代码；某个 loader 或插件没有传递上一步的 source map，导致链条断开。
:::

## 易错点

- source map 不会被普通用户下载，不影响页面加载性能；它的成本在构建时间和泄露源码的风险
- `hidden-source-map` 只是不在产物里写引用注释，map 文件本身还在产物目录里，部署时没删掉的话照样能被猜到地址直接下载
- `nosources-source-map` 不包含源码内容，监控平台只能还原出文件名和行列号，看不到报错位置附近的代码
- 每次发布的 map 都要和版本对应保存，覆盖上传或漏传，线上报错就无法还原
