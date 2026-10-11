---
difficulty: 2
tags: [高频, 原理]
---

# async/await 的原理是什么？

::: tip 一句话回答
async 函数**总是返回 Promise**：return 的值会成为 fulfilled 的结果，抛出的错误会让它变成 rejected。`await` 会暂停函数执行，等 Promise 落定后，把函数剩下的部分作为**微任务**继续执行。原理上可以看作 **Generator + 自动执行器**的语法糖：`async` 对应 `function*`，`await` 对应 `yield`，执行器负责在 Promise 落定后恢复函数执行。
:::

## 详细解析

### 基本行为

- return 一个普通值，返回的 Promise 以它为结果变成 fulfilled；return 一个 Promise，就跟随它的状态
- 函数里抛出的错误不会同步抛给调用方，而是让返回的 Promise 变成 rejected
- 第一个 `await` 之前的代码同步执行。遇到 `await` 时函数暂停，控制权交还给调用方；Promise 落定后，剩下的代码作为微任务恢复执行，顺序见[事件循环](/basics/javascript/01-event-loop)
- Promise 成功时，`await` 表达式的值就是结果；失败时，错误在 `await` 这一行抛出。所以既可以用 try/catch 包住 `await` 处理错误，也可以由调用方在返回的 Promise 上 `.catch()`

### 原理：Generator + 自动执行器

Generator 函数可以用 `yield` 暂停，外部调用 `next(值)` 恢复，传入的值会成为 `yield` 表达式的结果。如果每次 `yield` 一个 Promise，再由执行器在它落定后自动调用 `next`，就得到了 async/await 的效果。co 库就是这个思路：

```js
function run(genFn) {
  return new Promise((resolve, reject) => {
    const gen = genFn()
    function step(method, arg) {
      let result
      try {
        result = gen[method](arg) // next 把结果送回 yield 处；throw 让 yield 处抛错
      } catch (err) {
        return reject(err) // Generator 内部没有捕获的错误
      }
      if (result.done) return resolve(result.value)
      Promise.resolve(result.value).then(
        (val) => step('next', val),
        (err) => step('throw', err),
      )
    }
    step('next')
  })
}

async function getUser() {
  const res = await fetch('/api/user')
  return res.json()
}

// 等价写法：async 换成 function*，await 换成 yield，交给 run 执行
function* getUserGen() {
  const res = yield fetch('/api/user')
  return res.json()
}
run(getUserGen).then((user) => console.log(user))
```

执行器替 Generator 做的，正是引擎替 async 函数做的事：Promise 成功时调用 `gen.next(结果)` 恢复执行，失败时调用 `gen.throw(错误)` 让 `yield` 处抛错，函数结束时用返回值 resolve。引擎原生实现了 async 函数，并不会真的把它转成 Generator；但 Babel、TypeScript 把 async 函数编译到不支持它的低版本时，产物就是 Generator（或由它再转成的状态机）加一个类似 `run` 的辅助函数。

### 串行与并行

```js
// ❌ 串行：两个请求互不依赖，却要等第一个完成才发出第二个
async function loadSerial() {
  const user = await getUser()
  const posts = await getPosts()
  return [user, posts]
}

// ✅ 并行：同时发起，总耗时取决于较慢的那个
async function loadParallel() {
  return Promise.all([getUser(), getPosts()])
}
```

也可以先同时发起再分别 await：`const p1 = getUser()`、`const p2 = getPosts()`，然后依次 `await p1`、`await p2`。但如果 `p2` 在等待 `p1` 期间先失败，它当时还没有处理函数，会被报告为未处理的拒绝，所以一般优先用 `Promise.all`。几个静态方法的区别见 [Promise](/basics/javascript/11-promise)。

### forEach 里的 await

`forEach` 只管调用回调，不处理回调返回的 Promise，所以不会等待：

```js
// ❌ 三个 save 同时发起，done 在它们完成之前就打印了
ids.forEach(async (id) => {
  await save(id)
})
console.log('done')

// ✅ 顺序执行：上一个完成再执行下一个
for (const id of ids) {
  await save(id)
}
// ✅ 并发执行，全部完成后再继续
await Promise.all(ids.map((id) => save(id)))
```

### 顶层 await

ES Module 中可以直接在模块顶层写 `await`，不用包在 async 函数里；导入这个模块的其他模块会等它执行完再执行。CommonJS 模块和普通 `<script>` 不支持，见 [ES Module 和 CommonJS](/basics/javascript/17-esm-vs-cjs)。

## 面试官可能追问

::: details await 一个非 Promise 的值会怎样？
会先被包装成已解决的 Promise（相当于 `Promise.resolve(值)`），函数照样暂停，后面的代码照样放进微任务执行。所以 `await null` 也会让出执行权，调用方后面的同步代码会先执行。如果值是带 `then` 方法的对象（thenable），会调用它的 `then`，按 Promise 的方式处理。
:::

::: details 在 try/catch 中，return await 和直接 return 有什么区别？
```js
async function load() {
  try {
    return getUser() // ❌ getUser 失败时，下面的 catch 捕获不到
    // return await getUser() // ✅ 失败时在这一行抛错，进入 catch
  } catch {
    return null
  }
}
```

直接 return 时，Promise 被原样交出去，函数已经离开了 try 块，之后的拒绝发生在函数外面，只会让 `load()` 返回的 Promise 变成 rejected。`return await` 在 try 块里等待结果，拒绝变成这一行抛出的错误，才能被 catch 捕获。不在 try/catch 里时，两种写法的结果相同。
:::

::: details async 函数里有个 Promise 既没被 await 也没被 catch，失败了会怎样？
比如在 async 函数里调用了 `sendLog()`，既没有 `await` 也没有 `.catch()`。它失败时，函数里的 try/catch 和调用方的 `.catch()` 都捕获不到，它会成为一个未处理的拒绝：浏览器会触发 `unhandledrejection` 事件并在控制台报错；Node.js 会触发 `process` 的 `unhandledRejection` 事件，Node.js 15 起，没有监听时默认会把它当作未捕获的异常，导致进程退出。所以不需要等待的 Promise 也要加上 `.catch()`。
:::

## 易错点

- async 函数在第一个 `await` 之前是**同步**执行的；`await` 只暂停当前函数，不会阻塞主线程
- try/catch 只能捕获被 `await` 的 Promise 的错误
- 在 `forEach` 里 `await` 不会等待；需要顺序执行就用 `for...of`
