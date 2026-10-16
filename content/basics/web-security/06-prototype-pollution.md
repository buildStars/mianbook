---
difficulty: 3
tags: [安全, 原理]
---

# 原型污染是什么？怎么防御？

::: tip 一句话回答
JS 读属性时，对象自己没有就沿原型链往上找。如果代码拿**外部传入的键名**去读写对象，键名恰好是 `__proto__`，或者是 `constructor` 再接 `prototype`，写入就会落到 `Object.prototype` 上，之后**所有普通对象**都"多出"这个属性，这就是原型污染。常见入口是**不安全的深合并、按路径赋值、把查询参数解析成嵌套对象**。后果是 `if (options.xxx)` 这类判断被改变，在浏览器里可能被串成 XSS，在 Node 服务里则影响整个进程的所有请求。防御：**过滤危险键名**，外部数据用 **`Map` 或 `Object.create(null)`** 存，用 **`Object.hasOwn`** 只认自有属性，用 schema 校验输入，及时升级有漏洞的依赖。
:::

## 详细解析

### 为什么会被污染

普通对象的 `__proto__` 是 `Object.prototype` 上的一个访问器属性，用字符串键访问它，拿到的就是原型本身；`constructor.prototype` 也指向同一个原型。原型链的基础见[原型和原型链](/basics/javascript/03-prototype-chain)。

```js
const plain = {}
console.log(plain['__proto__'] === Object.prototype) // true：用字符串键也能拿到原型
console.log(plain.constructor.prototype === Object.prototype) // true

// 模拟"被污染之后"的效果：直接给原型加一个普通属性
const user = { name: 'tom' }
console.log(user.isAdmin) // undefined
Object.prototype.isAdmin = true
console.log(user.isAdmin) // true：自己没有，沿原型链读到了
console.log({}.isAdmin) // true：之后新建的对象也一样
console.log(Object.hasOwn(user, 'isAdmin')) // false：自有属性的判断不受影响
delete Object.prototype.isAdmin // 演示完清理掉
```

真实的污染不是开发者自己写的这一行，而是通用的工具函数在处理外部数据时，把外部提供的键名当成了路径：遍历到 `__proto__` 这样的键时，`target[key]` 取到的是全局原型，接下来的赋值就写到了原型上。

### 常见入口

- **深合并**：把请求体、用户配置、导入的 JSON 递归合并进默认配置，遍历键时没有过滤
- **按路径赋值**：`set(obj, 'a.b.c', value)` 的路径来自外部，比如表单字段名、导入的配置，实现方法见[手写 get 和 set](/basics/handwriting/08-lodash-get)
- **查询参数解析**：支持 `a[b][c]=1` 这种嵌套语法的解析函数，会把 URL 变成深层对象。主流解析库大多已经默认拦截危险键名，但旧版本和自己写的解析函数仍然可能有问题
- **克隆、扩展函数**：深拷贝、`extend` 这类会递归写入属性的工具

`JSON.parse` 本身不会污染：它把 `__proto__` 当成普通的自有属性创建出来。危险在于后续拿这些键去写对象的代码。

### 影响

- **逻辑被改变**：`if (user.isAdmin)`、`options.debug` 这类读取"不存在的属性"的代码，读到了原型上的值，权限判断可能被绕过
- **浏览器端**：很多库读配置时，可选项不存在就走默认逻辑。原型被污染后这些可选项"有了值"，如果它最终流入 `innerHTML`、脚本地址、请求参数这类危险位置，就可能演变成 XSS 或请求被篡改。这种"会读取未定义选项"的代码位置常被称为 gadget
- **服务端更严重**：Node 进程常驻，所有请求共享同一个 `Object.prototype`，一次污染会影响之后的所有请求，直到进程重启。轻则大量报错导致服务不可用，重则绕过权限，见 [Node.js 服务的安全问题](/basics/node/16-security)

### 防御

1. **过滤键名**：所有处理外部数据的合并、按路径赋值函数，拒绝 `__proto__`、`constructor`、`prototype` 三个键
2. **外部键值不用普通对象存**：用 `Map`；或者用 `Object.create(null)`、`{ __proto__: null }` 创建没有原型的对象（对象字面量里的 `__proto__: null` 是设置原型的语法，是安全的）
3. **读取时只认自有属性**：用 `Object.hasOwn(obj, key)` 判断，配置项给出明确的默认值，`for...in` 改成 `Object.keys`
4. **schema 校验**：只接收声明过的字段，多余的字段直接拒绝，见[运行时校验](/basics/typescript/18-runtime-validation)
5. **及时升级依赖**：合并、克隆、解析类的工具库都出过原型污染漏洞，`npm audit` 报出来要尽快处理

## 代码示例

按路径赋值时过滤危险键名，中间层只认自有属性：

```js
const BLOCKED = new Set(['__proto__', 'constructor', 'prototype'])

function setByPath(obj, path, value) {
  const keys = path.split('.')
  if (keys.some((k) => BLOCKED.has(k))) throw new Error(`不允许的键：${path}`)
  let cur = obj
  for (const k of keys.slice(0, -1)) {
    // 中间层不是自己的对象属性（比如继承来的 toString），就新建一个
    if (!Object.hasOwn(cur, k) || typeof cur[k] !== 'object' || cur[k] === null) cur[k] = {}
    cur = cur[k]
  }
  cur[keys.at(-1)] = value
  return obj
}

console.log(setByPath({}, 'theme.color', 'dark')) // { theme: { color: 'dark' } }

// 存外部提供的键值对：Map 的键是什么都不会碰到原型
const settings = new Map([['theme', 'dark']])
console.log(settings.get('isAdmin')) // undefined，不会读到原型上的属性
```

## 面试官可能追问

::: details 前端的原型污染只影响当前用户，为什么也算高危？
污染源如果是 URL 参数或 hash，攻击者只要构造一个链接诱导别人打开，受害者的页面就会被污染。再配合页面里某个 gadget 把污染的值写进 DOM，就成了针对受害者的 XSS，效果和反射型 XSS 一样。所以要看的不只是"污染了什么"，还有"污染的值会流到哪里"。
:::

::: details 直接冻结 Object.prototype 能一劳永逸吗？
`Object.freeze(Object.prototype)` 确实能让写入失效，但要谨慎评估：polyfill 和一些老库需要修改内置原型，必须在冻结之前加载；非严格模式下写入是静默失败，严格模式下会抛 `TypeError`，依赖修改原型的代码会直接报错；连 `Foo.prototype.toString = ...`、`obj.constructor = ...` 这种给其他对象赋同名属性的写法也会失败，因为继承来的只读属性会阻止赋值；它只冻结这一个对象，`Array.prototype`、`Function.prototype` 等要另外处理。Node 的 `--disable-proto=delete` 只删掉 `__proto__` 访问器，`constructor.prototype` 这条路径依然存在。这些都只能作为额外的一层。
:::

::: details Object.create(null) 创建的对象用起来有什么不便？
它没有 `toString`、`hasOwnProperty` 这些继承来的方法：`String(obj)`、模板字符串拼接会抛错，`obj.hasOwnProperty(k)` 也不能用，要改成 `Object.hasOwn(obj, k)`。`JSON.stringify`、`Object.keys` 正常可用。有的库会假设传入的是普通对象，所以它更适合作为内部的字典，键值对多、要频繁增删时直接用 `Map`。
:::

::: details 怎么在项目里发现原型污染的风险？
先跑 `npm audit`，看依赖里有没有已知的原型污染漏洞。再在代码里找"用变量作为键、连续多层写入对象"的地方，比如递归合并、`obj[a][b] = v`，确认键名是否可能来自外部。给这类工具函数写单元测试，覆盖三个危险键名。测试环境也可以冻结 `Object.prototype`，让意外的原型写入直接报错暴露出来。
:::

## 易错点

- 只过滤了 `__proto__`，漏掉了 `constructor` 加 `prototype` 这条路径
- 用 `'key' in obj` 判断属性是否存在：`in` 也会查原型链，被污染后照样返回 `true`
- 以为展开运算符和 `Object.assign` 一样：展开不会触发 `__proto__` 的 setter；`Object.assign` 会触发，把目标对象自己的原型改掉
- 用 `obj.hasOwnProperty(key)` 判断：对象可能没有原型，这个方法也可能被同名属性覆盖，应该用 `Object.hasOwn`
