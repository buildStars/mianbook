---
difficulty: 2
tags: [手写题, 原理]
---

# 手写一个简易模板引擎：`{{name}}` 这类插值怎么解析？

::: tip 一句话回答
最简单的版本用**正则替换**：匹配 `{{ path }}`，把 `a.b.c` 按点拆开逐层取值，取不到输出空串。插值默认要做 **HTML 转义**，把 `<`、`>`、`&`、引号换成实体，否则用户数据会变成可执行的 HTML，造成 XSS。要支持表达式、if 和 each，正则替换就不够了，要把模板**编译成函数**：文本部分拼成字符串，标签部分翻译成 JS 代码，再用 `new Function` 生成渲染函数。Vue 的模板编译走的是同一条路，只是生成的是渲染虚拟 DOM 的函数。
:::

## 详细解析

### 正则替换版

1. 正则 `/\{\{\s*([\w.]+)\s*\}\}/g` 匹配插值，捕获里面的路径
2. 路径按 `.` 拆开，用 reduce 加可选链逐层取值
3. 值是 `null` 或 `undefined` 时输出空串，避免页面上出现 "undefined"；`0` 和 `false` 要正常输出
4. 输出前做 HTML 转义

这里的路径取值只支持点号，带下标和方括号的完整版见 [手写 lodash 的 get](/basics/handwriting/08-lodash-get)。

### 为什么默认要转义

模板常用来拼用户数据。用户昵称里如果带着一段 `<script>` 标签，不转义就会被浏览器当成 HTML 执行。所以主流模板引擎都是"默认转义，显式声明才原样输出"：Vue 的 `{{ }}` 会转义，`v-html` 不转义；这里用三花括号 `{{{ }}}` 表示原样输出。XSS 的完整防御见 [XSS 和 CSRF](/basics/browser/06-xss-csrf)。

### 编译成函数

要支持 `{{ list.length * 2 }}`、`{{#if}}`、`{{#each}}`，思路是把模板翻译成一段 JS 代码：

```text
模板：  <ul>{{#each list}}<li>{{ item.name }}</li>{{/each}}</ul>
代码：  out += "<ul>"; for (const item of list) { out += "<li>"; out += $escape(item.name); out += "</li>"; } out += "</ul>"
```

文本用 `JSON.stringify` 变成安全的字符串字面量，插值变成 `out += $escape(表达式)`，`#if` 变成 `if (...) {`，`#each` 变成 `for ... of`，结束标签变成 `}`。最后 `new Function` 生成函数，编译一次可以渲染多次。

## 代码示例：手写模板引擎

```js
const ESCAPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ESCAPE[c])

function render(tpl, data) {
  // {{{ x }}} 原样输出，{{ x }} 转义输出；先匹配三花括号
  return tpl.replace(/\{\{\{\s*([\w.]+)\s*\}\}\}|\{\{\s*([\w.]+)\s*\}\}/g, (_, raw, safe) => {
    const value = (raw || safe).split('.').reduce((obj, key) => obj?.[key], data)
    if (value == null) return '' // 取不到值输出空串，不输出 "undefined"
    return raw ? String(value) : escapeHtml(value)
  })
}

render('你好，{{ user.name }}！你有 {{count}} 条消息', { user: { name: '小明' }, count: 0 })
// 你好，小明！你有 0 条消息
render('<p>{{ bio }}</p>', { bio: '<b>加粗</b>' }) // <p>&lt;b&gt;加粗&lt;/b&gt;</p>
render('{{{ html }}}|{{ missing.deep }}|', { html: '<b>粗</b>' }) // <b>粗</b>||

// 编译版：把模板拆成代码，生成一个渲染函数
function compile(tpl) {
  let code = 'let out = "";\nwith (data) {\n'
  let last = 0
  const re = /\{\{\s*(#each|#if|\/each|\/if)?\s*([^}]*?)\s*\}\}/g
  let m
  while ((m = re.exec(tpl))) {
    code += `out += ${JSON.stringify(tpl.slice(last, m.index))};\n`
    const [, tag, expr] = m
    if (tag === '#if') code += `if (${expr}) {\n`
    else if (tag === '#each') code += `for (const item of ${expr}) {\n`
    else if (tag) code += '}\n'
    else code += `out += $escape(${expr});\n`
    last = re.lastIndex
  }
  code += `out += ${JSON.stringify(tpl.slice(last))};\n}\nreturn out;`
  const fn = new Function('data', '$escape', code)
  return (data) => fn(data, (v) => (v == null ? '' : escapeHtml(v)))
}

const view = compile('<ul>{{#each list}}<li>{{ item.name }}{{#if item.price > 100}}(贵){{/if}}</li>{{/each}}</ul>')
view({ list: [{ name: '键盘', price: 299 }, { name: '鼠标', price: 59 }] })
// <ul><li>键盘(贵)</li><li>鼠标</li></ul>
compile('共 {{ list.length * 2 }} 件')({ list: [1, 2] }) // 共 4 件
```

`with (data)` 让表达式里可以直接写 `list` 而不是 `data.list`。`new Function` 创建的函数体默认是非严格模式，所以能用 with。

## 面试官可能追问

::: details new Function 有什么安全问题？
它和 eval 一样，会把字符串当代码执行。模板本身如果来自用户（比如允许用户自定义邮件模板），用户就能写任意 JS，拿到全局对象、发请求。所以编译版只能用于开发者写的模板；用户提供的模板只能用不执行代码的方案，比如只支持路径取值的正则版。另外，设置了禁止 `unsafe-eval` 的 CSP 时，`new Function` 会直接被浏览器拦截，见 [CSP](/basics/web-security/01-csp)。
:::

::: details 和 Vue 的模板编译有什么关系？
思路一致：模板 → 解析 → 生成渲染函数代码 → `new Function`。区别在于 Vue 先把模板解析成 AST，做静态节点标记等优化，生成的函数返回虚拟 DOM 而不是 HTML 字符串，之后由 diff 更新真实 DOM。Vue 提供不含编译器的运行时版本，构建时就把模板编译好，浏览器里不需要 `new Function`。
:::

::: details 属性里的插值转义够用吗？
HTML 实体转义只保证在标签内容和带引号的属性值里安全。插值放在 `href` 里，`javascript:` 开头的地址不含任何需要转义的字符，转义拦不住；放在 `<script>` 或事件属性里更不行。不同上下文要用不同的编码或校验，这也是推荐交给成熟框架处理的原因。
:::

## 易错点

- 用 `if (!value) return ''` 判断空值，把 `0` 和 `false` 也吞掉了
- 默认不转义，用户数据直接拼进 HTML
- 编译版文本部分直接拼进代码字符串，遇到引号或换行代码就坏了，要用 `JSON.stringify`
- 以为 HTML 转义在任何位置都安全，忽略了 URL 和脚本上下文
