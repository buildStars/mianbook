---
difficulty: 3
tags: [实践, 综合]
---

# 怎么设计和发布一个组件库？按需引入是怎么实现的？

::: tip 一句话回答
设计上用**设计令牌**加 CSS 变量做主题，组件 API 保持一致，表单类组件同时支持**受控和非受控**，可访问性内置在组件里。工程上一般用 **monorepo** 管理组件、主题、图标和文档站，构建出**保留模块结构的 ESM 产物**（每个组件一个文件）、类型声明和**按组件拆分的样式**。按需引入靠两件事：ESM 的具名导入让打包工具能静态分析，`package.json` 的 **`sideEffects`** 声明 JS 没有副作用，没用到的组件就会被 tree shaking 整体跳过；CSS 要在 `sideEffects` 里标成有副作用，否则 webpack 这类打包工具会把它删掉，也可以交给**自动导入插件**处理。最后配上文档示例站、视觉回归测试和规范的版本发布。
:::

## 详细解析

### 设计：主题和组件 API

- **设计令牌**：颜色、间距、圆角、字号先定义成一层令牌，再落地成 CSS 变量，例如 `--ui-color-primary`。组件只引用语义变量，换主题就是换一组变量值，暗色模式也在这一层解决，见 [CSS 变量和主题切换](/basics/css/13-variables-theme)
- **API 一致**：同一个概念全库同名，比如尺寸都叫 `size`、取值都是 `small | medium | large`，禁用都叫 `disabled`；事件命名统一（Vue 用 `update:modelValue`，React 用 `onChange`）；未声明的原生属性和 ref 透传到根元素，使用方才能加 `aria-*`、`data-*`、拿到 DOM
- **受控与非受控**：传了 `value` 就由使用方完全控制，组件只通过 `onChange` 通知；只传 `defaultValue` 时组件自己维护状态。两种模式都支持，简单场景少写代码，复杂场景（联动、校验）也能接管
- **可访问性**：优先用原生元素，自定义下拉、弹窗要处理键盘操作、焦点管理和 ARIA 属性，这些做在组件里，使用方就不用每次重复，见 [Web 可访问性](/basics/html/04-a11y-aria)
- **样式可覆盖**：类名带统一前缀，组件的默认样式写成低优先级（放进 `@layer` 或用 `:where()`），使用方不用拼选择器优先级就能覆盖，原理见 [选择器优先级](/basics/css/03-specificity)

### 工程：仓库结构和构建产物

常见的 monorepo 结构是 `packages/components`、`packages/theme`、`packages/icons`、`apps/docs`，组件改动在文档站里立即可见，发布时各包单独出版本，见 [monorepo](/basics/build/11-monorepo)。

```text
my-ui/dist
├── es/
│   ├── index.js             export { default as Button } from './button/index.js' ...
│   ├── button/index.js      每个组件一个模块（构建时开启 preserveModules 保留目录结构）
│   ├── button/style.css     这个组件自己的样式
│   └── select/...
├── types/                   .d.ts 类型声明，和 es 目录结构对应
└── index.css                全量样式，给不在意体积、想一次引入的使用方
```

- **只发 ESM 或 ESM 为主**：tree shaking 依赖 ESM 的静态结构；需要兼容 CommonJS 使用方时再加一份 CJS，入口的写法见 [main、module、exports](/basics/build/18-package-exports)
- **框架不打进产物**：vue、react 放在 `peerDependencies`，构建时设为 external，否则使用方的应用里会有两份框架，Hooks、`provide/inject` 全部失效
- **类型声明**：用 `tsc` 或 `vue-tsc` 只生成声明文件，和 JS 产物一起发布
- **样式按组件拆分**：每个组件一份 CSS，加一份全量 CSS

### 按需引入是怎么实现的

1. 使用方写 `import { Button } from 'my-ui'`，入口 `es/index.js` 里只有一串 `export ... from`
2. 打包工具读到 `"sideEffects"` 声明 JS 文件没有副作用，就知道没被用到的组件模块可以**整体跳过**，连同它的依赖一起不打包，原理见 [Tree Shaking](/basics/build/04-tree-shaking)
3. 样式有三种处理方式：
   - 组件模块里 `import './style.css'`，用到组件就带上样式。CSS 文件要写进 `sideEffects` 的白名单，否则 webpack 这类打包工具会在生产构建里把这个只为副作用存在的导入删掉（Vite 会保留 CSS 导入，但组件库不能假设使用方都用 Vite）
   - 使用方在入口手动引入全量 `index.css`，简单但没有按需
   - **自动导入插件**，例如 Vue 生态的 unplugin-vue-components 配合组件库提供的 resolver：编译时扫描模板里用到的组件，自动插入对应组件和样式的导入，使用方连 `import` 都不用写

早期很多组件库只发 CommonJS 产物，没法 tree shaking，只能靠 babel-plugin-import 在编译时把 `import { Button } from 'lib'` 改写成按路径导入单个文件。产物改成 ESM 并写好 `sideEffects` 后，这一步就不需要了。

### 文档、测试和发布

- **文档示例站**：Storybook、VitePress 这类工具，每个组件的每种状态都有示例，示例也是后面测试的素材
- **测试**：交互逻辑用组件测试覆盖（见 [前端测试](/basics/build/15-frontend-testing)）；样式改动用**视觉回归测试**，对每个示例截图并和基准图对比，一个改动有没有误伤其他组件一眼就能看出来
- **版本发布**：严格按语义化版本，删除或改名属性属于破坏性变更，要升主版本，并且先在旧版本里给出弃用警告；用 changesets 生成变更记录；测试版用 npm 的 dist-tag（如 `next`）发布，不影响 `latest`

## 代码示例

组件库的 `package.json` 关键字段：

```json
{
  "name": "my-ui",
  "type": "module",
  "exports": {
    ".": { "types": "./dist/types/index.d.ts", "import": "./dist/es/index.js" },
    "./es/*": "./dist/es/*",
    "./index.css": "./dist/index.css"
  },
  "sideEffects": ["**/*.css"],
  "files": ["dist"]
}
```

`./es/*` 让自动导入插件能直接引用 `my-ui/es/button/style.css` 这样的单个文件。框架写在 `peerDependencies` 里，版本范围按组件库实际支持的大版本填写。

受控和非受控两种模式共用的写法（React）：

```jsx
import { useState } from 'react'

function useControllableState(value, defaultValue, onChange) {
  const [inner, setInner] = useState(defaultValue)
  const isControlled = value !== undefined // 传了 value 就是受控模式
  const setValue = (next) => {
    if (!isControlled) setInner(next) // 非受控时自己保存状态
    onChange?.(next) // 两种模式都通知使用方
  }
  return [isControlled ? value : inner, setValue]
}
```

## 面试官可能追问

::: details 组件库的样式用 CSS-in-JS 还是普通 CSS？
运行时 CSS-in-JS 会带来渲染开销和 SSR 配置成本，还强制使用方装同一个运行时，组件库里越来越少用。更通用的做法是构建期就产出普通 CSS 文件，配合类名前缀和 CSS 变量：不限制使用方的技术栈，主题定制只需要覆盖变量。各种方案的对比见 [CSS 模块化方案](/basics/css/14-css-architecture)。
:::

::: details 怎么验证按需引入真的生效了？
建一个最小的使用方项目，只导入一个组件，生产构建后用体积分析工具看产物里有没有其他组件的代码和样式（见 [打包体积优化](/basics/build/09-bundle-size)）。也可以把这个检查放进 CI：对"只用 Button"的示例项目设一个体积上限，一旦有人在入口加了副作用代码，体积就会超标。
:::

::: details 组件库要支持 SSR 需要注意什么？
组件在渲染阶段不能访问 `window`、`document`，要放到挂载之后；自动生成的 id（用于 `aria-labelledby`）在服务端和客户端要一致，否则会出现水合不匹配；弹层挂载到 `body` 的逻辑只在客户端执行。另外组件 JS 里直接 `import './style.css'` 的产物，在 Node.js 里不经构建工具处理就加载时会报错，SSR 框架需要把这个包交给构建工具编译。
:::

## 易错点

- `"sideEffects": false` 一刀切，组件里 `import './style.css'` 的样式在用 webpack 等工具的使用方那里，生产构建后全部丢失
- 把 vue、react 写进 `dependencies` 并打进产物，使用方出现两份框架实例
- 只发一个打包好的单文件，样式没法按组件拆分，文件里的顶层副作用代码还会把它引用到的组件一起保留下来
- 改了属性名或默认值却只升了小版本，使用方升级后页面直接出问题
