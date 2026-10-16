---
difficulty: 3
tags: [原理, 安全]
---

# Electron 的进程模型是什么？主进程和渲染进程怎么安全地通信？

::: tip 一句话回答
Electron 沿用了 Chromium 的多进程模型：**主进程**只有一个，运行在 Node.js 环境里，负责应用生命周期、创建窗口和调用菜单、对话框等系统能力；每个窗口有自己的**渲染进程**，就是一个 Chromium 页面，默认不能访问 Node.js；**preload 脚本**在页面加载前运行在渲染进程里，权限比页面高，用 `contextBridge` 向页面暴露受控的 API。安全通信的基线是：保持 **`nodeIntegration` 关闭、`contextIsolation` 和 `sandbox` 开启**，preload 只暴露最小的业务 API，用 **`ipcRenderer.invoke` 配合 `ipcMain.handle`**，主进程**校验参数和发送方来源**，不加载不可信的远程内容，并设置 CSP。
:::

## 详细解析

### 三种角色

```text
主进程（Node.js，一个）
  app 生命周期、BrowserWindow、菜单、托盘、文件系统、ipcMain.handle
        ▲  IPC（invoke / handle、send / on）
        │
渲染进程（每个窗口一个，Chromium）
  ├─ preload 脚本：隔离的上下文，可用 ipcRenderer、contextBridge
  │      contextBridge.exposeInMainWorld('api', {...})
  └─ 页面脚本：只能看到 window.api，碰不到 Node.js 和 Electron 内部对象
```

- **主进程**：应用的入口，能用全部 Node.js 和 Electron API。它被长任务或同步 I/O 阻塞时整个应用都会卡住，CPU 密集的任务要放到 worker 线程或单独的进程里
- **渲染进程**：按 Web 标准写界面，可以用任何前端框架
- **preload**：在页面内容加载前执行。开启上下文隔离后，它和页面运行在不同的 JS 上下文里，往 `window` 上挂变量页面是看不到的，必须通过 `contextBridge` 显式暴露

### 为什么要严格隔离

渲染进程加载的是网页内容。如果页面能直接 `require('child_process')`，一个 XSS 漏洞就等于攻击者可以在用户电脑上执行任意命令，后果远比浏览器里的 XSS 严重。所以 Electron 的安全模型就是：**页面不可信，能力全部收在主进程，中间只留一条窄而可控的通道**。

### 安全基线

| 项目 | 要求 |
| --- | --- |
| `nodeIntegration` | 保持关闭（默认），渲染进程不能直接用 Node.js |
| `contextIsolation` | 保持开启（默认），preload 和页面的 JS 上下文分开，页面无法篡改 preload 用到的对象 |
| `sandbox` | 保持开启（默认），渲染进程受 Chromium 沙箱限制，preload 里也只能用有限的模块 |
| 暴露的 API | 用 `contextBridge` 只暴露具体的业务方法，不要把 `ipcRenderer` 或它的 `on` 原样暴露 |
| IPC | 用 `invoke` / `handle`；主进程校验参数类型和范围，校验 `event.senderFrame` 的来源 |
| 远程内容 | 不在有 preload 能力的窗口里加载不可信的远程页面 |
| CSP | 设置严格的 `Content-Security-Policy`，如 `script-src 'self'` |
| 导航和新窗口 | 用 `will-navigate` 阻止意外跳转，用 `setWindowOpenHandler` 拒绝意外弹窗 |
| `shell.openExternal` | 只传固定或校验过的 URL，传入不可信内容可能被利用来执行命令 |
| 其他 | 不关闭 `webSecurity`；本地页面优先用自定义协议加载，少用 `file://` |

CSP 的写法和原理见 [CSP 是什么](/basics/web-security/01-csp)。

## 代码示例

```js
// main.js
const { app, BrowserWindow, ipcMain, shell } = require('electron')
const path = require('node:path')
const fs = require('node:fs/promises')

const TRUSTED_ORIGINS = new Set(['app://bundle']) // 按页面的实际加载方式填写；自定义协议要注册成 standard，origin 才是这个值

function isTrustedSender(frame) {
  // 官方建议比较 origin 而不是 URL（about:blank、blob: 的 URL 看不出来源）；frame 可能已经销毁，是 null
  return Boolean(frame && TRUSTED_ORIGINS.has(frame.origin))
}

ipcMain.handle('notes:read', async (event, name) => {
  if (!isTrustedSender(event.senderFrame)) throw new Error('来源不可信')
  // 只允许简单文件名，防止 ../ 这类路径穿越
  if (typeof name !== 'string' || !/^[\w-]{1,64}$/.test(name)) throw new Error('参数不合法')
  return fs.readFile(path.join(app.getPath('userData'), 'notes', `${name}.md`), 'utf-8')
})

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (event) => event.preventDefault()) // 不允许页面跳走
  contents.setWindowOpenHandler(({ url }) => {
    // 只把白名单里的链接交给系统浏览器打开
    if (URL.canParse(url) && new URL(url).origin === 'https://docs.example.com') shell.openExternal(url)
    return { action: 'deny' } // 一律不在应用内开新窗口
  })
})

app.whenReady().then(() => {
  const win = new BrowserWindow({
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // 下面三项都是默认值，显式写出来防止被误改
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  })
  win.loadURL('app://bundle/index.html') // 自定义协议的注册省略
})
```

```js
// preload.js：只暴露具体的业务方法
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('notesAPI', {
  read: (name) => ipcRenderer.invoke('notes:read', name),
  // ✅ 包一层，只把需要的数据传给页面，不泄露 event 对象
  onSaved: (callback) => ipcRenderer.on('notes:saved', (_event, name) => callback(name)),
})

// 页面里：const text = await window.notesAPI.read('todo')
```

## 面试官可能追问

::: details contextIsolation 关掉会有什么风险？
关掉后 preload 和页面共用同一个 JS 上下文。页面可以改写内置对象的原型、覆盖全局函数，借此篡改 preload 的行为，或者拿到 preload 里引用的 `ipcRenderer` 等对象，绕过你精心设计的 API。官方安全文档还提醒，关闭上下文隔离会让这个进程的沙箱一起失效。
:::

::: details 为什么不能直接把 ipcRenderer 暴露给页面？
那样页面可以向任意频道发消息、监听任意频道，主进程的所有 IPC 接口都对页面敞开了。即使只暴露 `ipcRenderer.on`，回调收到的 `event` 对象上也带着 `sender`，同样会泄露 `ipcRenderer`。正确做法是每个业务动作暴露一个函数，内部写死频道名，只把需要的数据传给页面的回调。
:::

::: details 一定要加载远程网页怎么办？
用单独的窗口或 `WebContentsView` 加载，不给它 preload，保持 Node 集成关闭和上下文隔离开启；用 `session.setPermissionRequestHandler` 控制摄像头、通知等权限请求，因为默认情况下 Electron 会自动批准这些请求。和主应用的交互只通过主进程中转，并且对它发来的消息做同样严格的校验。
:::

::: details Electron 和 Tauri 有什么区别？
Electron 把 Chromium 和 Node.js 一起打包进应用，各平台渲染一致，但安装包和内存占用都比较大。Tauri 用系统自带的 WebView、后端用 Rust，不打包浏览器内核，应用体积小得多，代价是各系统的 WebView 内核不同，要处理兼容差异。
:::

## 易错点

- 只关掉 `nodeIntegration` 还不够，不开启 `contextIsolation`，页面仍有办法拿到 preload 里的特权对象
- `sendSync` 会阻塞渲染进程直到主进程回复，需要返回值时用 `invoke` / `handle`
- IPC 校验要放在主进程，preload 和页面里的检查都可能被绕过
