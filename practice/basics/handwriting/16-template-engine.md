---
title: 手写模板引擎
---

## 要求

实现 `render(tpl, data)`：把模板 `tpl` 里的插值换成 `data` 里的值，返回渲染好的字符串。

- `{{ path }}`：花括号里两边可以有空格，也可以没有；`path` 由字母、数字、下划线和点组成，按点号逐层取值，比如 `{{ user.name }}` 取 `data.user.name`
- 取不到值（值是 `null`、`undefined`，或者中间某一层不存在）时输出空串，不能报错；`0` 和 `false` 要照常输出
- `{{ }}` 的值输出前要做 HTML 转义：`&` `<` `>` `"` `'` 分别换成 `&amp;` `&lt;` `&gt;` `&quot;` `&#39;`
- `{{{ path }}}`（三个花括号）原样输出，不转义
- 插值以外的文字原样保留，同一个插值可以出现多次

```js
render('你好，{{ user.name }}！你有 {{count}} 条消息', { user: { name: '小明' }, count: 0 })
// '你好，小明！你有 0 条消息'
render('<p>{{ bio }}</p>', { bio: '<b>粗</b>' }) // '<p>&lt;b&gt;粗&lt;/b&gt;</p>'
render('{{{ bio }}}', { bio: '<b>粗</b>' }) // '<b>粗</b>'
```

## 提示

- 用 `tpl.replace(正则, 替换函数)` 一次换掉全部插值，正则要带 `g`；双花括号的正则也能匹配到三花括号的一部分，所以要先匹配 `{{{ }}}`：用 `|` 写成两个分支、两个捕获组，替换函数里看是哪一组匹配上了
- 路径按 `.` 拆开，用 reduce 加可选链 `?.` 逐层取值，中间层是 null 也不会报错
- 判断空值用 `value == null`，不要用 `!value`，否则 0 和 false 也被吞掉了
- 转义用一张"字符 → 实体"的映射表，一个正则匹配这五个字符一次换完；如果分几次 replace，`&` 必须最先换，否则 `&lt;` 里的 `&` 会被再转义一次

## 起始代码

```js
function render(tpl, data) {
  // 返回替换好插值的字符串
}
```

## 测试

```js
test('替换模板里全部的插值', () => {
  expect(render('{{name}}有{{count}}条消息，{{name}}请查收', { name: '小明', count: 3 })).toBe('小明有3条消息，小明请查收')
})

test('花括号里两边可以有空格', () => {
  expect(render('{{ a }}-{{b }}-{{  c}}', { a: 1, b: 2, c: 3 })).toBe('1-2-3')
})

test('按点号逐层取嵌套的值', () => {
  expect(render('住在{{ user.address.city }}', { user: { address: { city: '杭州' } } })).toBe('住在杭州')
})

test('取不到值时输出空串，中间层不存在也不报错', () => {
  expect(render('[{{ missing }}][{{ missing.deep }}][{{ a.b.c }}][{{ n }}]', { a: null, n: undefined })).toBe('[][][][]')
})

test('0 和 false 照常输出', () => {
  expect(render('未读 {{ count }} 条，已读：{{ read }}', { count: 0, read: false })).toBe('未读 0 条，已读：false')
})

test('默认转义 HTML 特殊字符', () => {
  const bio = `<a href="x" title='y'>Tom & Jerry</a>`
  expect(render('<p>{{ bio }}</p>', { bio })).toBe('<p>&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;Tom &amp; Jerry&lt;/a&gt;</p>')
})

test('三花括号原样输出，不转义', () => {
  expect(render('{{{ html }}}|{{ html }}', { html: '<b>粗</b>' })).toBe('<b>粗</b>|&lt;b&gt;粗&lt;/b&gt;')
})
```

## 参考答案

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
```
