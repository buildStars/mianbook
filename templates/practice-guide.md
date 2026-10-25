# 默写练习编写规范

默写练习是手写题的练习模式：页面上只给"要求"和函数签名，用户自己写实现，点"运行测试"看哪些用例通过。参考答案在用户通过或放弃后才显示。

## 文件

`practice/<题目路径>.md`，路径和题目一一对应：`content/basics/handwriting/13-promisify.md` 的练习是 `practice/basics/handwriting/13-promisify.md`。格式（解析在 `shared/utils/practice-spec.ts`）：

````markdown
---
title: 手写 promisify
---

## 要求

（Markdown）要实现什么、签名、行为规则。

## 提示

- 第一条提示
- 第二条提示

## 起始代码

```js
function promisify(fn) {
  // 返回一个新函数，调用它得到 Promise
}
```

## 测试

```js
test('成功时 resolve 回调的结果', async () => {
  await expect(promisify(divide)(6, 3)).resolves.toBe(2)
})
```

## 参考答案

```js
function promisify(fn) { /* 能通过全部测试的实现 */ }
```
````

- `title`：练习标题，"手写 xxx"，简短。
- `dom: true`：测试要用 `document`（比如渲染虚拟 DOM）时加上。这种练习只能在浏览器里跑，`npm run practice:check` 只检查格式。
- 例子：`practice/basics/handwriting/13-promisify.md`。

## 怎么写

**选题**：一个练习练一个核心实现，就是这道题最常被要求手写的那个函数或类。名字、参数和题目里的参考代码保持一致。题目讲了好几个函数（比如 curry 和 compose）时，可以都放进来，但起始代码里每个都要有签名，测试也要都覆盖。

**要求**：写清楚输入、输出和行为规则，特别是边界情况（空数组、出错、`this`、异步顺序）。用户只看要求就能写出能通过测试的代码，不需要猜测试在测什么。不要在要求里写实现思路。

**提示**：2～4 条，由浅到深：第一条点出整体思路，后面的提示关键 API 或容易漏的地方。不要直接给出代码。

**起始代码**：只有签名和空的函数体（或者空的类），可以加一行注释说明要返回什么。必须是合法的 JavaScript，并且不能通过全部测试。

**测试**：5～8 条，名字用中文写清楚测的是什么行为（"空数组返回空数组""保留调用时的 this"）。覆盖正常用法、边界情况和题目"易错点"里提到的坑。

- 运行环境是浏览器（沙箱，不能联网）：不能用 `import`、`require`、`process`、`fs`、`fetch`
- 测试之间不要共享会被修改的状态；需要的辅助函数写在测试代码最上面
- 异步测试用 `async` 函数加 `await`；时间相关的测试用 10～100ms 的小延迟，单条测试控制在 1 秒内（超过 3 秒算失败，可以 `test(name, fn, 5000)` 放宽）。不要依赖两个相同延迟的定时器谁先触发
- 失败信息要能帮用户定位：一条测试只测一个行为，断言写具体的期望值

**参考答案**：基于题目里的参考实现，改成和起始代码一样的签名。写法和项目一致：两格缩进、不写分号、注释简短、用中文。

## 测试里能用的

| 写法 | 说明 |
| --- | --- |
| `test(名字, 函数, 超时毫秒?)` | 一条用例，函数可以是 async |
| `expect(x).toBe(y)` | `Object.is` 相等 |
| `expect(x).toEqual(y)` | 深度相等（值为 undefined 的属性当作没有，Map、Set、Date 都比较内容） |
| `toBeTruthy()` `toBeFalsy()` `toBeNull()` `toBeUndefined()` `toBeDefined()` | |
| `toBeGreaterThan(n)` `toBeGreaterThanOrEqual(n)` `toBeLessThan(n)` `toBeLessThanOrEqual(n)` | |
| `toContain(item)` `toHaveLength(n)` `toMatch(正则或字符串)` `toBeInstanceOf(类)` | |
| `expect(() => f()).toThrow(消息片段、正则或错误类?)` | 同步抛错 |
| `await expect(promise).resolves.toBe(1)` / `await expect(promise).rejects.toThrow('x')` | 异步结果 |
| `expect(x).not.toBe(y)` | 所有断言都可以加 `.not` |
| `delay(ms, 值?, 失败?)` | `delay(50, 'a')` 50ms 后得到 'a'；`delay(50, 'e', true)` 50ms 后以 `Error('e')` 失败 |
| `fn(实现?)` | 假函数，`spy.calls` 是每次调用的参数数组；配合 `toHaveBeenCalled()`、`toHaveBeenCalledTimes(n)`、`toHaveBeenCalledWith(...参数)` |

## 检查

```bash
npm run practice:check -- 13-promisify
```

检查格式、对应的题目存在、参考答案通过全部测试、起始代码不能全部通过、至少 4 条测试。全部显示 ✓ 才算写完。单元测试会跑全部练习。
