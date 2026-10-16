---
difficulty: 2
tags: [实践]
---

# 构建产物的浏览器兼容怎么控制？browserslist 是什么？

::: tip 一句话回答
**browserslist** 用一份查询语句描述项目要支持哪些浏览器，比如 `> 0.5%, last 2 versions, not dead`，写在 `.browserslistrc` 或 `package.json` 的 `browserslist` 字段里。Babel 的 preset-env、autoprefixer、postcss-preset-env、SWC 等工具**共用这一份配置**，据此决定转换哪些语法、注入哪些 polyfill、给 CSS 加哪些前缀。兼容要分清两件事：**语法转换**和 **API polyfill**。Vite 用 **`build.target`** 控制语法降级，默认面向现代浏览器、不注入 polyfill；要支持不认识 ES Module 的老浏览器，用官方的 legacy 插件**额外生成一套兼容产物**，通过 `module` / `nomodule` 让新旧浏览器各取所需。兼容范围越大产物越大，应该按真实用户的浏览器数据来定。
:::

## 详细解析

### browserslist 的写法

```ini
# .browserslistrc
[production]
> 0.5%
last 2 versions
not dead

[development]
last 1 chrome version
```

- **常用查询**：`> 0.5%`（全球使用率高于 0.5% 的版本）、`> 1% in CN`（按国家或地区统计）、`last 2 versions`（每种浏览器的最后两个版本）、`not dead`（排除 24 个月没有官方更新的浏览器）、`Firefox ESR`、`supports es6-module`（支持某个特性的浏览器）、`baseline widely available`
- **组合**：逗号或 `or` 取并集，`and` 取交集，`not` 排除
- **`defaults`**：等于 `> 0.5%, last 2 versions, Firefox ESR, not dead`，找不到任何配置时就用它
- **分环境**：按 `BROWSERSLIST_ENV` 或 `NODE_ENV` 选择对应的段，都没设置时用 `production`。开发环境只针对新版 Chrome，转换更少、构建更快
- **查看结果**：`npx browserslist` 列出当前配置选中的浏览器，`npx browserslist --coverage "> 0.5%, not dead"` 显示覆盖了多少用户

使用率和版本数据来自 caniuse-lite 包。构建时提示浏览器数据已经过旧，就按提示执行 `npx update-browserslist-db@latest` 更新。

### 谁在读这份配置

| 工具 | 用它做什么 |
| --- | --- |
| `@babel/preset-env` | 决定转换哪些语法、按需注入哪些 core-js polyfill |
| autoprefixer | 决定给 CSS 加哪些厂商前缀 |
| postcss-preset-env | 决定把哪些新的 CSS 写法转换成旧写法 |
| SWC | 没有指定 `env.targets` 时读取 browserslist |
| eslint-plugin-compat | 检查代码里用了目标浏览器不支持的 API |

Babel 的转换原理和 polyfill 的几种引入方式见 [Babel 的原理](/basics/build/07-babel)，这里只强调区别：可选链、箭头函数这类**语法**，老浏览器解析都解析不了，要靠编译器改写；`Promise`、`Array.prototype.at` 这类 **API**，语法上没问题，只是运行时不存在，要靠 polyfill 补上。CSS 也一样，前缀和部分新语法能转换，但容器查询、`:has()` 这类特性没法 polyfill，只能用 `@supports` 做渐进增强，见 [现代 CSS 新特性](/basics/css/10-modern-css)。

### Vite 的 build.target

- 默认值面向一组现代浏览器（以 Baseline 广泛可用为准），具体版本随 Vite 的大版本调整，以文档为准
- 可以写成 `'es2015'`、`'chrome100'` 这样的值或数组；`'esnext'` 表示几乎不做转换
- **只做语法转换，不注入 polyfill**
- 最低只能写到 `es2015`；而且不管写多低，产物本身都依赖原生 ES Module、动态 `import()` 和 `import.meta`，不支持这些的浏览器要靠下面的 legacy 插件
- `build.target` 不读 browserslist，项目里同时配了 browserslist（比如给 autoprefixer 用）时，要注意两边的范围保持一致

### legacy 插件和 module / nomodule

`@vitejs/plugin-legacy` 在正常的现代产物之外，再用 `@babel/preset-env` 生成一套**兼容产物**（SystemJS 格式，代码分割照常可用），以及一个按实际用到的 API 生成的 **polyfill 文件**。它的 `targets` 没有显式配置时读取项目的 browserslist。生成的 HTML 大致是这样：

```html
<!-- 支持 ES Module 的浏览器：执行这个 -->
<script type="module" src="/assets/index-modern.js"></script>
<!-- 支持 ES Module 的浏览器会跳过 nomodule 脚本；老浏览器不认识 type="module"，只执行这里 -->
<script nomodule src="/assets/polyfills-legacy.js"></script>
<script nomodule src="/assets/index-legacy.js"></script>
```

插件实际还会注入几段内联脚本，让支持 ES Module、但缺少动态 `import()` 等能力的浏览器也回退到兼容产物；页面配了严格的 CSP 时，要把插件导出的 `cspHashes` 加进 `script-src`。

这就是 **module / nomodule 双产物**的思路：现代浏览器拿到体积小、几乎没有转换的代码，老浏览器拿到完整转换加 polyfill 的代码，谁都不用为对方买单。webpack 项目也能这样做：用两套 Babel 目标各构建一次，再把两组脚本按上面的方式注入 HTML。代价是构建时间和产物文件都多了一份。

### 兼容范围怎么定

1. 看真实数据：从统计平台或监控里拿到用户的浏览器和版本分布，toB 产品、海外用户、嵌在 App 或小程序里的 WebView 差异都很大，见 [前端监控](/basics/browser/20-monitoring)
2. 用 caniuse 或 MDN 的兼容性表查具体特性，用 eslint-plugin-compat 在开发时发现问题
3. 按收益取舍：范围每扩大一档，产物更大、构建更慢、一些新特性用不了；但范围之外的用户可能直接白屏
4. 范围之外的浏览器给一个兜底：检测到不支持时显示"请升级浏览器"的提示，而不是一片空白

## 面试官可能追问

::: details 配了 browserslist，老浏览器上还是报语法错误，可能是什么原因？
最常见的是依赖没有被转换：webpack 项目给 babel-loader 配了 `exclude: /node_modules/`，而某个依赖发布的就是新语法，需要把它加进转换范围。另一种是工具之间的目标不一致，比如 Vite 的 `build.target` 没跟着 browserslist 调整。还有一种是语法转换了，但用到的 API 没有 polyfill，报错信息会是"xxx is not a function"或"xxx is not defined"。可以在报错的浏览器里打开对应的产物文件，看报错位置是哪个依赖。
:::

::: details 升级了依赖，没改代码，产物却变了，为什么？
`> 0.5%`、`last 2 versions` 这类查询是动态的，结果取决于 caniuse-lite 里的数据。更新了 caniuse-lite，选中的浏览器列表就会变化，转换和前缀也跟着变。这本身是预期行为，让兼容范围随时间自然前移；需要构建结果稳定时，要提交 lockfile，并有计划地更新数据。
:::

::: details 能不能按浏览器动态下发 polyfill？
可以。思路是服务端根据请求的 User-Agent 只返回这个浏览器缺的 polyfill，现代浏览器几乎拿到空文件。但如果用的是公共的第三方 polyfill 服务，它的脚本运行在你的页面里，权限和你自己的代码一样；曾有这类公共服务的域名易主后被用来投放恶意代码。要用的话尽量自己部署，见 [供应链安全](/basics/web-security/05-supply-chain)。
:::

## 易错点

- 把语法转换和 polyfill 混为一谈：`build.target` 调到很低，`Promise.allSettled`、`Array.prototype.at` 在老浏览器里照样不存在
- 只写 `last 2 versions`：它会把 IE 这类早已停止维护的浏览器也选进来，要配合 `not dead` 和使用率查询
- 开发环境的 browserslist 段只写了新版 Chrome，却没在目标浏览器里测试生产构建
- 以为 legacy 插件能让 Vite 开发服务器在老浏览器里运行，它只作用于生产构建
