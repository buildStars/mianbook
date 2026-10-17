---
difficulty: 2
tags: [实践, 场景题]
---

# 拖放 API 怎么用？拖拽上传和粘贴上传怎么做？

::: tip 一句话回答
HTML 拖放靠一组事件：被拖元素上触发 `dragstart`、`drag`、`dragend`，放置目标上触发 `dragenter`、`dragover`、`dragleave`、`drop`。**`dragover` 里必须 `preventDefault()`**，否则元素不算可放置目标，`drop` 不会触发。拖拽上传在 `drop` 里从 `dataTransfer.files` 取文件，粘贴上传在 `paste` 里从 `clipboardData` 取文件；同时保留 `<input type="file">` 作为点击和键盘可用的入口。
:::

## 详细解析

### 事件顺序

```text
被拖元素：dragstart ──> drag（持续触发）────────────────────────> dragend
放置目标：         dragenter ──> dragover（持续触发）──> drop 或 dragleave
```

- 从桌面拖文件进浏览器时，没有页面内的被拖元素，只有放置目标上的事件
- `dragover` 和 `drop` 的默认行为是"不允许放置"和"浏览器打开这个文件"，所以两个都要 `preventDefault()`。很多人忘了在整个页面兜底，用户拖偏了，浏览器就直接打开文件，离开了当前页面
- `dragenter`、`dragleave` 在进出**子元素**时也会触发，直接用它们切换高亮会闪烁。常见做法是用计数器，或者判断 `relatedTarget` 是否还在区域内

### DataTransfer：files 和 items

- `dataTransfer.files`：拖进来的文件列表（`FileList`），最常用
- `dataTransfer.items`：更底层的列表，每一项有 `kind`（`file` 或 `string`）和 `type`，能区分拖进来的是文件还是文本、链接
- 数据只在事件处理函数**同步执行期间**可读。先 `await` 再去读 `dataTransfer`，拿到的就是空的，所以要先把文件或 entry 取出来保存好

### 拖文件夹

`files` 里文件夹只会表现为一个看不出内容的条目。要读取目录结构，用 `item.webkitGetAsEntry()` 拿到 entry，目录 entry 通过 `createReader().readEntries()` 读取子项。`readEntries` 一次可能只返回一部分，要**循环调用直到返回空数组**。这个 API 带 webkit 前缀，但主流浏览器都支持。

### 粘贴上传

监听 `paste` 事件，从 `event.clipboardData.files`（或遍历 `items` 找 `kind === "file"` 的项）取文件。截图工具复制的图片、从文件管理器复制的文件都会走这里。只有文本时不要拦截默认行为，否则输入框里正常粘贴也被吃掉。

### 校验、预览和兜底入口

- **校验**：检查 `file.type` 和扩展名、`file.size`。前端校验只是体验优化，服务端必须重新检查文件类型和内容
- **预览**：`URL.createObjectURL(file)` 生成本地 URL，用完 `URL.revokeObjectURL()` 释放，否则文件一直占着内存，原理见 [Blob 和 Base64](/basics/browser/21-blob-base64)
- **兜底入口**：拖放只能用鼠标或触摸完成。要保留一个按钮触发 `<input type="file" accept="image/*" multiple>`，键盘和读屏用户才能上传，表单控件的更多能力见 [原生表单](/basics/html/05-forms)

## 代码示例

```js
const zone = document.querySelector('#drop-zone')
const MAX = 10 * 1024 * 1024

// 整个页面兜底：拖偏了也不要让浏览器打开文件
window.addEventListener('dragover', (e) => e.preventDefault())
window.addEventListener('drop', (e) => e.preventDefault())

zone.addEventListener('dragover', (e) => {
  e.preventDefault() // ✅ 不写就不会触发 drop
  e.dataTransfer.dropEffect = 'copy'
})

zone.addEventListener('drop', (e) => {
  e.preventDefault()
  // 同步取出 entry，await 之后 dataTransfer 就不可读了
  const entries = [...e.dataTransfer.items]
    .filter((item) => item.kind === 'file')
    .map((item) => item.webkitGetAsEntry())
  Promise.all(entries.map(collect)).then((lists) => handleFiles(lists.flat()))
})

async function collect(entry) {
  if (!entry) return []
  if (entry.isFile) return [await new Promise((res, rej) => entry.file(res, rej))]
  const reader = entry.createReader()
  const result = []
  while (true) {
    const batch = await new Promise((res, rej) => reader.readEntries(res, rej))
    if (batch.length === 0) break // readEntries 要循环读到空为止
    for (const child of batch) result.push(...(await collect(child)))
  }
  return result
}

document.addEventListener('paste', (e) => {
  const files = [...e.clipboardData.files]
  if (files.length === 0) return // 纯文本粘贴不拦截
  e.preventDefault()
  handleFiles(files)
})

function handleFiles(files) {
  for (const file of files) {
    if (!file.type.startsWith('image/') || file.size > MAX) continue
    const img = new Image()
    img.src = URL.createObjectURL(file)
    img.onload = () => URL.revokeObjectURL(img.src) // ✅ 加载完就释放
    zone.append(img)
  }
}
```

## 面试官可能追问

::: details 大文件拖进来之后怎么上传？
拖放和粘贴只负责拿到 `File` 对象，之后和普通上传一样。大文件需要分片、并发控制和断点续传，见 [大文件上传](/basics/network/18-large-file-upload)。
:::

::: details 页面内的元素拖拽排序也用这套 API 吗？
可以，给元素加 `draggable="true"`，在 `dragstart` 里用 `setData` 存 ID，在 `drop` 里读出来。但原生拖放在移动端触摸设备上支持不好，拖拽预览也难定制，所以排序列表常用基于 Pointer Events 的库实现。
:::

::: details 怎么判断拖进来的是文件还是文本？
看 `dataTransfer.types` 是否包含 `"Files"`，或者遍历 `items` 看 `kind`。`dragover` 阶段出于隐私不能读取内容，但可以读 `types`，据此决定是否显示"松开上传"的提示。
:::

## 易错点

- `dragover` 不调用 `preventDefault()`，`drop` 永远不触发
- 在异步操作之后才读 `dataTransfer`，拿到空数据
- `readEntries` 只调用一次，文件多的目录只读到一部分
- 只做了拖放，没有点击和键盘可用的上传按钮
