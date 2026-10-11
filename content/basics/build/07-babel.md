---
difficulty: 2
tags: [高频, 原理, 手写题]
---

# Babel 的原理是什么？polyfill 应该怎么引入？

::: tip 一句话回答
Babel 是一个源码到源码的编译器，分三步：**parse** 把代码解析成 AST，**transform** 用**访问者模式**遍历 AST、由各个**插件**修改节点，**generate** 把新的 AST 生成代码和 source map。Babel 只能转换**语法**（箭头函数、可选链、class 私有字段），`Promise`、`Array.prototype.includes` 这类新 **API** 要靠 **core-js** 的 polyfill 补上。应用项目一般按目标浏览器**按需注入**全局 polyfill；库要用 **`@babel/plugin-transform-runtime`** 配合不污染全局的 polyfill，避免改动使用方的全局环境。
:::

## 详细解析

### 三个阶段

```text
源代码 ──parse──► AST ──transform──► 新 AST ──generate──► 目标代码 + source map
        @babel/parser   @babel/traverse          @babel/generator
                        插件在这里修改节点
```

1. **parse**：先做词法分析，把代码切成 token；再做语法分析，组装成 AST。比如 `const a = 1` 是一个 `VariableDeclaration` 节点，里面有 `VariableDeclarator`、`Identifier`、`NumericLiteral`
2. **transform**：深度优先遍历 AST。插件提供一个 `visitor` 对象，key 是节点类型，遍历到这类节点时调用对应函数。函数拿到的是 `path`，它包装了节点和它的父节点、作用域，提供 `replaceWith`、`remove`、`insertBefore` 等修改方法
3. **generate**：把 AST 重新输出成字符串，同时生成 [source map](/basics/build/08-source-map)

### 插件和预设

- **插件**：一个插件只做一件事，比如 `@babel/plugin-transform-arrow-functions` 只转箭头函数
- **预设**：一组插件的集合，比如 `@babel/preset-env`（按目标环境决定要转哪些语法）、`@babel/preset-typescript`、`@babel/preset-react`
- **执行顺序**：插件先于预设执行；插件按数组**从前往后**执行，预设按数组**从后往前**执行

### 语法转换和 API polyfill

| | 语法转换 | API polyfill |
| --- | --- | --- |
| 解决什么 | 旧浏览器**解析不了**的写法 | 旧浏览器**没有**的全局对象和方法 |
| 例子 | 箭头函数、`?.`、`class`、`async/await` | `Promise`、`Map`、`Array.prototype.includes`、`Object.hasOwn` |
| 谁来做 | Babel 插件改写代码 | core-js 提供实现，Babel 负责按需插入 `import` |

### 目标环境：browserslist

`@babel/preset-env` 根据目标环境决定转换哪些语法、注入哪些 polyfill。目标可以写在 `targets` 选项里，没写时读取项目的 browserslist 配置（`.browserslistrc` 或 `package.json` 的 `browserslist` 字段），例如 `> 0.5%, last 2 versions, not dead`。autoprefixer 等工具也读同一份配置，目标环境只需维护一处。

### polyfill 的几种引入方式

| 方式 | 做法 | 优缺点 | 适合 |
| --- | --- | --- | --- |
| entry | 在入口写 `import 'core-js/stable'`，Babel 按目标环境把它替换成需要的模块 | 不会漏，但包含很多实际没用到的 polyfill | 担心漏掉第三方代码用到的 API |
| usage | 扫描每个文件用到的 API，按需插入 `import` | 体积小；但通常不编译 `node_modules`，依赖里用到的新 API 可能漏掉 | 大多数应用 |
| runtime（pure） | 把 `Promise` 改写成从 `core-js-pure` 导入的局部变量，helper 函数也从 `@babel/runtime` 导入 | 不修改全局对象，不重复内联 helper | 发布到 npm 的库 |

Babel 7 中前两种通过 `@babel/preset-env` 的 `useBuiltIns: 'entry' | 'usage'` 加 `corejs` 选项开启，第三种用 `@babel/plugin-transform-runtime` 的 `corejs: 3` 选项。Babel 8 移除了 preset-env 的 `useBuiltIns` 和 transform-runtime 的 `corejs` 选项，改为直接使用 `babel-plugin-polyfill-corejs3`，分别对应 `method: 'entry-global'`、`'usage-global'`、`'usage-pure'`。升级时要留意：Babel 8 里继续写 `useBuiltIns` 会直接报错，但 transform-runtime 的 `corejs: 3` 不报错，只是不再注入 polyfill，容易在不知不觉中丢掉 polyfill。

## 代码示例

polyfill 配置，Babel 7 的写法：

```js
// babel.config.js（应用）
module.exports = {
  presets: [['@babel/preset-env', { useBuiltIns: 'usage', corejs: '3.40' }]],
}

// babel.config.js（库）：@babel/runtime-corejs3 要装在 dependencies 中
module.exports = {
  presets: ['@babel/preset-env'],
  plugins: [['@babel/plugin-transform-runtime', { corejs: 3 }]],
}
```

Babel 8 的写法：

```js
// babel.config.mjs
export default {
  presets: ['@babel/preset-env'],
  plugins: [
    // 应用用 usage-global；库改成 usage-pure，并加上 @babel/plugin-transform-runtime
    ['babel-plugin-polyfill-corejs3', { method: 'usage-global', version: '3.40' }],
  ],
}
```

`corejs` / `version` 要写到安装的 core-js 的次版本号，只写 `3` 时会按 3.0 计算，较新的 API 不会被补上。

手写一个去掉 `console.log` 的 Babel 插件：

```js
// babel-plugin-remove-console.js
module.exports = function removeConsole({ types: t }) {
  return {
    name: 'remove-console',
    visitor: {
      // 遍历到每个函数调用节点时执行
      CallExpression(path, state) {
        const methods = state.opts.methods ?? ['log', 'debug']
        const callee = path.get('callee')
        if (!callee.isMemberExpression() || callee.node.computed) return

        const { object, property } = callee.node
        if (!t.isIdentifier(object, { name: 'console' })) return
        if (path.scope.hasBinding('console')) return // 局部变量叫 console，不是全局的，跳过
        if (!t.isIdentifier(property) || !methods.includes(property.name)) return

        if (path.parentPath.isExpressionStatement()) {
          path.parentPath.remove() // 独立的语句：整句删除
        } else {
          path.replaceWith(t.unaryExpression('void', t.numericLiteral(0))) // 用在表达式里：换成 undefined
        }
      },
    },
  }
}
// 配置 plugins: [['./babel-plugin-remove-console.js', { methods: ['log'] }]] 后：
// const fn = () => console.log('a'); console.info('b') → const fn = () => void 0; console.info('b')
```

## 面试官可能追问

::: details 为什么库不应该用 useBuiltIns: 'usage' 注入全局 polyfill？
全局 polyfill 会修改 `Promise`、`Array.prototype` 等全局对象，库的使用方可能有自己的 polyfill 方案，版本冲突或重复注入都会带来问题。库应该用 runtime 的方式，把 API 改写成局部引用，不碰全局环境；是否给全局打补丁，交给最终的应用决定。
:::

::: details transform-runtime 除了 polyfill 还解决了什么问题？
Babel 转换 class、async 函数等语法时会生成 `_classCallCheck` 这类辅助函数（helper），默认内联在每个文件里，文件多了就会重复很多份。transform-runtime 把它们改成从 `@babel/runtime` 导入，整个项目只保留一份。Babel 7 中要把它的 `version` 选项设成实际安装的 `@babel/runtime` 版本，否则较新的 helper 仍会被内联。
:::

::: details 用了 TypeScript，还需要 Babel 吗？
`tsc` 本身就能把 TS 编译到较低的 ES 版本，但它不注入 API polyfill。很多项目的做法是 `tsc --noEmit` 只做类型检查，编译交给 Babel、esbuild 或 SWC 这类更快的工具，它们只删除类型注解、不做类型检查。需要 polyfill 时，再由 Babel 或在入口手动引入 core-js。
:::

## 易错点

- `@babel/preset-env` 只做语法转换，不加任何 polyfill 相关配置时，`Promise`、`includes` 等 API 不会被补上
- usage 模式只分析经过 Babel 编译的文件，而 babel-loader 一般会配置 `exclude: /node_modules/`，第三方库用到的新 API 可能被漏掉，需要把这些库加入编译范围，或改用 entry 方式
- `corejs` 只写 `3` 会被当成 3.0，较新 API 的 polyfill 不会被注入；同时 core-js 要作为 dependencies 安装
- 插件按数组从前往后执行、预设从后往前执行，顺序写错可能导致某个插件拿到的是已经被转换过的代码
