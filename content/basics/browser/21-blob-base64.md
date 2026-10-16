---
difficulty: 2
tags: [实践, 对比]
---

# Blob、File、ArrayBuffer、Base64、ObjectURL 有什么区别？怎么互相转换？

::: tip 一句话回答
**ArrayBuffer** 是一段原始二进制内存，要通过 `Uint8Array` 这类视图读写；**Blob** 是不可变的二进制数据块，带 MIME 类型，可以切片；**File** 继承自 Blob，多了文件名和修改时间。**Base64** 把二进制编码成文本，体积会**增大约 1/3**；**ObjectURL** 是 `URL.createObjectURL(blob)` 生成的 `blob:` 临时地址，指向内存里的 Blob，用完要 `revokeObjectURL` 释放。
:::

## 详细解析

### 各自是什么

| 类型 | 本质 | 典型来源 | 适合做什么 |
| --- | --- | --- | --- |
| ArrayBuffer | 定长的原始字节 | `fetch().arrayBuffer()`、`blob.arrayBuffer()` | 按字节解析、计算哈希、处理音视频 |
| Blob | 不可变的二进制块 + `type` | `new Blob([...])`、`canvas.toBlob`、`res.blob()` | 下载、上传、切片 |
| File | Blob + `name`、`lastModified` | `<input type="file">`、拖拽 | 用户选择的文件 |
| Base64 | 文本编码的二进制 | `FileReader.readAsDataURL`、`btoa` | 嵌进 JSON、CSS、小图内联 |
| ObjectURL | 指向 Blob 的 `blob:` 地址 | `URL.createObjectURL` | 给 `img`、`a`、`video` 当 src |

ArrayBuffer 本身不能直接读写，要套一个 TypedArray（`Uint8Array` 等）或 `DataView`。Blob 不一定在 JS 堆里，大文件可能由浏览器存在磁盘上，所以 Blob 更适合传递"整块数据"。

### Base64 为什么大 1/3

Base64 每 3 个字节（24 位）拆成 4 组 6 位，每组映射成一个可见字符，所以 3 字节变 4 字符，体积约为原来的 4/3。Data URL 就是 `data:image/png;base64,...` 这种形式。小图标内联能省一次请求，大文件转 Base64 既占内存又慢，不划算。

### 互相转换

```text
File ⊂ Blob
Blob → ArrayBuffer   blob.arrayBuffer() 或 FileReader.readAsArrayBuffer
Blob → 文本          blob.text()
Blob → Base64        FileReader.readAsDataURL
Blob → ObjectURL     URL.createObjectURL(blob)
ArrayBuffer → Blob   new Blob([buffer], { type })
Base64 → Blob        atob 解码成字节，再 new Blob；或 fetch(dataURL).then(r => r.blob())
```

`FileReader` 是回调风格的老 API，现在 Blob 自带 Promise 风格的 `arrayBuffer()`、`text()`，读 Base64 时才还需要它。另外 `btoa` 只接受 Latin-1 字符，直接传中文会抛 `InvalidCharacterError`，要先编码成字节。

## 代码示例

```js
// 1. 图片预览：ObjectURL 比 Base64 更快、更省内存
input.addEventListener('change', () => {
  const file = input.files[0]
  const url = URL.createObjectURL(file)
  img.src = url
  img.onload = () => URL.revokeObjectURL(url) // 用完释放
})

// 2. 前端下载文件
function download(data, filename) {
  const blob = new Blob([data], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// 3. 上传前压缩图片
async function compress(file, maxWidth = 1280, quality = 0.8) {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxWidth / bitmap.width)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width * scale
  canvas.height = bitmap.height * scale
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
}
```

大文件切片上传、断点续传用的是 `blob.slice`，流程见 [大文件上传](/basics/network/18-large-file-upload)。

## 面试官可能追问

::: details ObjectURL 不 revoke 会怎样？
ObjectURL 会让浏览器一直持有对应的 Blob，直到页面卸载。单页应用里反复预览图片又不释放，内存会一直涨，属于一种内存泄漏，见 [内存泄漏](/basics/javascript/16-memory-leak)。图片加载完、下载触发后就可以 revoke。
:::

::: details 下载接口返回的二进制文件怎么处理？
请求时把响应类型设成 blob（`fetch` 用 `res.blob()`，axios 设 `responseType: 'blob'`），再用 ObjectURL + `a.download` 触发下载。文件名通常从 `Content-Disposition` 响应头里解析，跨域时后端要在 `Access-Control-Expose-Headers` 里暴露这个头。
:::

::: details Blob 和 ArrayBuffer 怎么选？
只是搬运数据（上传、下载、预览、存 IndexedDB），用 Blob，它不可变、可以切片、浏览器能优化存储。要逐字节读或改（解析文件头、计算 MD5、拼接协议包），转成 ArrayBuffer 配合 TypedArray。
:::

## 易错点

- File 是 Blob 的子类，能用 Blob 的地方都能直接传 File，不用转换
- Base64 不是加密，只是编码，任何人都能解码
- `URL.createObjectURL` 每调一次生成一个新地址，不会复用，要各自释放
