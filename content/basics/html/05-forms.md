---
difficulty: 2
tags: [实践]
---

# 原生表单有哪些容易被忽略的能力？

::: tip 一句话回答
`<label>` 关联输入框后，点文字就能聚焦，读屏也能读出字段名；`type` 和 `inputmode` 决定手机弹出什么键盘；`autocomplete` 让浏览器自动填充，`one-time-code` 在支持的浏览器里还能帮用户填短信验证码。`required`、`pattern`、`min`/`max` 等属性提供**约束校验**，配合 `:user-invalid` 和 `setCustomValidity` 就能做出不错的校验体验；提交时用 `FormData` 一次收集所有字段。另外要注意：表单里的 `<button>` **默认是 submit**。
:::

## 详细解析

### label 关联输入框

```html
<!-- 用 for 指向 id，或者直接把输入框包在 label 里 -->
<label for="email">邮箱</label>
<input id="email" name="email" type="email" autocomplete="email" required>

<label><input type="checkbox" name="agree"> 我已阅读并同意协议</label>
```

点击 label 会聚焦对应的输入框（复选框会切换勾选），点击区域变大了；读屏聚焦输入框时会读出 label 的文字。`placeholder` 不能代替 label：一输入就消失，颜色通常也偏淡。

### type 和 inputmode

| 写法 | 手机键盘 | 额外能力 |
| --- | --- | --- |
| `type="email"` | 带 @ 的键盘 | 校验邮箱格式 |
| `type="tel"` | 拨号键盘 | 不校验格式，各地号码格式不同 |
| `type="url"` | 带 / 和 . 的键盘 | 校验 URL 格式 |
| `type="number"` | 数字键盘 | 支持 `min`、`max`、`step`，有上下箭头 |
| `type="date"` | 系统日期选择器 | 值固定是 `yyyy-mm-dd` 格式 |
| `inputmode="numeric"` | 纯数字键盘 | 只改变键盘，不做任何校验 |

验证码、卡号、身份证号这类"由数字组成的字符串"不要用 `type="number"`：它允许输入 `e`，会显示上下箭头，鼠标滚轮还可能改掉值。用 `type="text" inputmode="numeric"` 配合 `pattern` 更合适。

### autocomplete

- 常用值：`name`、`email`、`tel`、`street-address`、`postal-code`
- 登录表单用 `username` 加 `current-password`；注册或修改密码用 `new-password`，浏览器会提示生成强密码，而不是填入旧密码
- 短信验证码用 `one-time-code`，支持的浏览器（例如 iOS 和 macOS 上的 Safari）会在键盘上方或自动填充菜单里提示收到的验证码，点一下就能填入；不支持的浏览器把它当普通输入框，不影响使用

### 约束校验

- 属性：`required`、`pattern`、`min`/`max`/`step`、`minlength`/`maxlength`，以及 `type` 自带的格式校验
- `pattern` 必须匹配**整个值**，相当于自动加了 `^(?:` 和 `)$`；值为空时不检查 pattern，必填要另外加 `required`
- 提交时浏览器自动校验，不通过就阻止提交，聚焦第一个错误字段并显示提示
- JS 接口：`el.validity` 里有 `valueMissing`、`patternMismatch`、`typeMismatch` 等状态；`checkValidity()` 只返回结果，`reportValidity()` 还会显示提示；`el.validationMessage` 是浏览器生成的提示文字
- CSS：`:invalid` 只看当前值，页面一打开空的必填项就匹配，直接标红体验很差；`:user-invalid` 要等用户和这个字段交互过，或者尝试提交表单之后才匹配，更适合用来显示错误样式

### 自定义校验和自己接管

`setCustomValidity(msg)` 传非空字符串表示不合法，并把它作为提示文案；传空字符串才恢复合法。适合"两次密码一致"这类跨字段规则。

`<form novalidate>` 会关掉浏览器的提示气泡和提交拦截，但约束本身仍然生效，`validity` 和 `:invalid` 照样能用，可以用它们的结果渲染自己的错误提示。只想让某个按钮（比如"保存草稿"）跳过校验，就给它加 `formnovalidate`。前端校验只是为了体验，服务端必须再校验一遍。

### button 的默认类型和 Enter 提交

- 表单里的 `<button>` 不写 `type` 时默认是 `submit`。"显示密码""添加一行"这类按钮一点就会提交表单，要写成 `type="button"`
- 在文本框里按 Enter，浏览器会触发表单的**默认按钮**（第一个提交按钮）的点击。第一个按钮如果是没写 type 的"取消"，按 Enter 就会触发取消
- 表单里没有提交按钮时，只有一个文本类输入框才会在按 Enter 时直接提交
- 所以提交逻辑应该写在 form 的 `submit` 事件里，点击按钮和按 Enter 都会走到这里，不需要自己监听回车

## 代码示例

```js
const form = document.querySelector('#signup')
const { password, confirm } = form.elements

function checkConfirm() {
  // 非空字符串表示不合法，合法时一定要设回空字符串，否则表单永远提交不了
  confirm.setCustomValidity(confirm.value === password.value ? '' : '两次输入的密码不一致')
}
// 两个字段改动时都要重新检查，否则先填确认密码、再改密码就漏掉了
password.addEventListener('input', checkConfirm)
confirm.addEventListener('input', checkConfirm)

form.addEventListener('submit', async (e) => {
  e.preventDefault()
  // 收集所有带 name、没有 disabled 的字段；未勾选的复选框不会出现
  const data = new FormData(form)
  console.log(Object.fromEntries(data)) // 同名字段只保留最后一个值
  console.log(data.getAll('tags')) // 多选的同名字段用 getAll 取数组
  // 直接把 FormData 作为 body，会按 multipart/form-data 发送，可以带文件
  await fetch('/api/signup', { method: 'POST', body: data })
})
```

## 面试官可能追问

::: details form.submit() 和 form.requestSubmit() 有什么区别？
`submit()` 直接提交：不做约束校验，也不触发 `submit` 事件，写在 submit 事件里的逻辑会被跳过。`requestSubmit()` 的效果和用户点击提交按钮一样：先校验，再触发 `submit` 事件，可以被 `preventDefault` 阻止。还可以传入一个提交按钮，作为这次提交的 `submitter`。
:::

::: details disabled 和 readonly 有什么区别？
`disabled` 的字段不能聚焦，不参与校验，**也不会被提交**，`FormData` 里也没有它。`readonly` 的字段可以聚焦、可以选中复制，会被提交，但同样不参与约束校验。想让用户看到但不能改、又需要提交的值，用 `readonly`。
:::

::: details 原生校验的提示气泡样式改不了，怎么办？
在 form 上加 `novalidate` 关掉气泡，提交时遍历 `form.elements`，读每个字段的 `validity` 和 `validationMessage`，把错误渲染在字段下方。错误文字用 `aria-describedby` 关联到输入框，同时设置 `aria-invalid="true"`，读屏用户也能知道哪里错了。这样既复用了浏览器的校验规则，又能完全控制样式。
:::

## 易错点

- 用 `placeholder` 代替 `<label>`，输入后用户就不知道这一栏填的是什么了
- 调用 `setCustomValidity` 设置错误后，值改对了却没有设回空字符串，表单一直无法提交
- 用 `:invalid` 写错误样式，页面一打开所有必填项都是红的，应该用 `:user-invalid`
- 表单里的普通按钮没写 `type="button"`，一点就提交、页面刷新
