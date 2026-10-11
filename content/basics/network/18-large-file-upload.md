---
difficulty: 3
tags: [高频, 场景题]
---

# 大文件上传怎么做？分片、断点续传和秒传

::: tip 一句话回答
核心是**分片**：前端用 `Blob.slice` 把文件切成几 MB 的块，限制并发数上传，全部完成后通知服务端按顺序合并。再用文件内容的 **hash** 作为唯一标识：上传前先问服务端，文件已经存在就直接返回成功，这是**秒传**；只上传服务端还没有的分片，这是**断点续传**。hash 放在 Web Worker 里计算，避免页面卡顿；条件允许的话，前端直接把分片传到对象存储。
:::

## 详细解析

### 整体流程

直接上传大文件，一个请求要传很久，容易超时，还可能被请求体大小限制拦下（如 Nginx 的 `client_max_body_size`，超过会返回 413）；中途失败只能从头再传，也无法暂停。分片上传的流程如下：

```text
选择文件
  ├─ 1. 切片：用 Blob.slice 按固定大小（如 5 MB）切分
  ├─ 2. 计算文件 hash（在 Web Worker 中增量计算）
  ├─ 3. 带着 hash 询问服务端
  │     ├─ 文件已存在 → 秒传，直接成功
  │     └─ 返回已收到的分片序号 → 只上传缺失的分片（断点续传）
  ├─ 4. 限制并发数上传分片，每片带上文件 hash 和分片序号；失败的分片单独重试
  └─ 5. 全部完成后请求合并：服务端按序号合并，再用整体 hash 校验
```

第 3 步的检查接口是秒传和断点续传的关键：文件已经存在（自己或别人传过），直接返回成功，这就是秒传；否则返回已经收到的分片序号，前端只补传缺失的分片，这就是断点续传。服务端需要按 hash 记录收到了哪些分片，比如按 hash 建临时目录，或者记在 Redis 里。

### 文件 hash

- 用文件**内容**计算 hash，而不是文件名：同名文件的内容可能不同，不同名的文件内容可能相同
- 浏览器自带的 `crypto.subtle.digest` 只能一次性计算整段数据，大文件不适合全部读进内存，所以常用 spark-md5 这类库，按分片读取、增量计算
- 计算 hash 是 CPU 密集型任务，放到 [Web Worker](/basics/browser/15-web-worker) 里执行，不阻塞页面
- 想更快可以用**抽样 hash**：只取文件开头、结尾和中间的若干片段，再加上文件大小一起计算。速度快很多，但没抽到的内容不参与计算：两个大小相同的文件，只要差异不在抽样片段里，就会被当成同一个文件，直接用于秒传有误判风险。前后端还要约定好同样的抽样规则

### 进度、暂停、重试和校验

- **进度**：XHR 的 `xhr.upload.onprogress` 能拿到每个分片已上传的字节数，汇总后就是总进度。`fetch` 目前没有原生的上传进度事件，用 fetch 时只能按完成的分片数粗略计算
- **暂停和取消**：用 `AbortController`（fetch）或 `xhr.abort()` 中断正在上传的请求；恢复时重新走一遍"检查已上传分片"的流程即可
- **失败重试**：单个分片失败只重试这一片，并设置重试次数上限
- **校验**：合并后计算整个文件的 hash，和前端算出的比对，确认文件完整

### 更好的方案：直传对象存储

前端先向业务服务端申请上传凭证（临时凭证或预签名 URL），再调用 OSS、S3 等对象存储提供的分片上传接口，直接上传各个分片，完成后通知业务服务端保存文件信息。文件不经过自己的服务器，节省带宽和计算资源，分片的接收和合并也交给了对象存储。

### 下载方向的断点续传

下载时用 `Range` 请求头只请求文件的一部分，比如 `Range: bytes=1048576-`，服务端返回 `206 Partial Content` 和 `Content-Range` 头（见 [HTTP 常见状态码](/basics/network/09-status-codes)）。可以再配合 `If-Range` 带上 ETag：文件变了，服务端就返回完整内容，避免拼出错误的文件。

## 代码示例

切片和限制并发上传的核心代码（限制并发的通用写法见 [Promise](/basics/javascript/11-promise)）：

```js
const CHUNK_SIZE = 5 * 1024 * 1024 // 每片 5 MB

// 上传单个分片，失败后重试，最多尝试 3 次
async function uploadChunk(hash, index, blob, signal, retries = 3) {
  const form = new FormData()
  form.append('hash', hash)
  form.append('index', index)
  form.append('chunk', blob)
  try {
    const res = await fetch('/upload/chunk', { method: 'POST', body: form, signal })
    if (!res.ok) throw new Error(`分片 ${index} 上传失败：${res.status}`)
  } catch (err) {
    if (signal?.aborted || retries <= 1) throw err // 用户取消或次数用完，不再重试
    return uploadChunk(hash, index, blob, signal, retries - 1)
  }
}

// uploaded：服务端返回的已上传分片序号；limit：最大并发数
async function uploadFile(file, hash, { uploaded = [], limit = 4, signal, onProgress } = {}) {
  const total = Math.ceil(file.size / CHUNK_SIZE)
  const done = new Set(uploaded)
  // 断点续传：只上传服务端还没有的分片
  const queue = Array.from({ length: total }, (_, i) => i).filter((i) => !done.has(i))

  // 启动 limit 个并发的"工作者"，每个传完一片，再从队列里领下一片
  const work = async () => {
    while (queue.length > 0) {
      const index = queue.shift()
      const blob = file.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE)
      try {
        await uploadChunk(hash, index, blob, signal)
      } catch (err) {
        queue.length = 0 // 有分片彻底失败，其他工作者不再领取新分片
        throw err
      }
      done.add(index)
      onProgress?.(done.size / total)
    }
  }
  await Promise.all(Array.from({ length: limit }, work))

  // 所有分片上传完成，通知服务端合并
  const res = await fetch('/upload/merge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hash, filename: file.name, total }),
    signal,
  })
  if (!res.ok) throw new Error(`合并失败：${res.status}`)
}

// 使用：先检查，文件已存在就是秒传，否则只传缺失的分片（calcHash 在 Web Worker 中计算，这里省略）
const hash = await calcHash(file)
const { exists, uploaded } = await fetch(`/upload/check?hash=${hash}`).then((r) => r.json())
if (!exists) await uploadFile(file, hash, { uploaded, onProgress: (p) => console.log(p) })
```

## 面试官可能追问

::: details 计算 hash 太慢怎么办？
- 放到 Web Worker 里计算：页面不卡，但总耗时不变
- 用抽样 hash，只计算部分内容，速度快很多，但有误判风险
- 换用 WebAssembly 实现的哈希库，通常比纯 JS 实现快
:::

::: details 分片大小怎么选？
- 太小：请求数量多，每个请求都有请求头和网络往返的开销，服务端要合并的分片也多
- 太大：单个分片失败后重传的成本高，弱网下单个请求更容易超时
- 常见是几 MB，也可以根据网速动态调整。用对象存储时要遵守它的限制，比如 S3 要求除最后一片外，每片不小于 5 MB，最多 10000 片
:::

::: details 合并分片时怎么保证顺序和完整性？
- **顺序**：每个分片带序号，服务端按序号依次追加写入目标文件；用流式写入，不要把所有分片一次读进内存
- **完整性**：合并前检查分片是否齐全；每个分片也可以带上自己的 hash，接收时校验；合并后计算整个文件的 hash，和前端算的比对，不一致就删掉重传
- **并发**：前端重试可能导致同一个文件重复请求合并，合并操作要加锁，并做到幂等
:::

## 易错点

- `Blob.slice` 只是创建一个指向原文件某个范围的引用，不会立刻读取数据，切片本身很快；慢的是读取内容和计算 hash
- 不要用文件名或"文件名 + 大小"作为秒传的依据，内容不同的文件会被误判为同一个
- 并发数不是越大越好：HTTP/1.1 下浏览器对同一个域名最多约 6 个连接，多出来的请求只会排队，还会挤占页面上其他请求的带宽
