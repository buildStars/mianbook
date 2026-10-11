---
difficulty: 2
tags: [高频, 原理, 对比]
---

# Go Modules 是怎么管理依赖的？

::: tip 一句话回答
一个模块由根目录的 **go.mod** 描述：声明模块路径、要求的 Go 版本和依赖的**最低版本**；**go.sum** 记录每个依赖内容的哈希，下载时校验，防止被篡改。版本选择用**最小版本选择（MVS）**：对每个依赖，取所有 require 里要求的最高的那个"最低版本"，不会自动升级到最新版，所以不需要 lock 文件也能得到可复现的构建。v2 及以上的大版本要把 `/v2` 写进导入路径，不同大版本被当作不同的模块。
:::

## 详细解析

### go.mod 和 go.sum

```text
module example.com/shop

go 1.24.0

require (
	github.com/go-sql-driver/mysql v1.8.1
	golang.org/x/sync v0.10.0
)

require (
	golang.org/x/text v0.21.0 // indirect
	golang.org/x/tools v0.29.0 // indirect
)

replace example.com/shared => ../shared // 用本地目录替换，只在主模块生效

exclude golang.org/x/sync v0.9.0 // 排除某个有问题的版本

tool golang.org/x/tools/cmd/stringer // Go 1.24 起：把工具也作为依赖管理
```

（版本号仅作示例。`// indirect` 表示本模块的包没有直接导入它：x/text 是依赖的依赖，x/tools 只是 tool 指令用到的工具所在的模块，所以也标成 indirect）

| 指令 | 作用 |
| --- | --- |
| `module` | 模块路径，也是包导入路径的前缀 |
| `go` | 模块要求的最低 Go 版本。Go 1.21 起是硬性要求，本地版本不够时 go 命令会自动下载对应的工具链（受 `GOTOOLCHAIN` 控制） |
| `toolchain` | Go 1.21 起，建议使用的工具链版本，可以比 go 行更新，只在当前模块是主模块时生效 |
| `require` | 依赖及其最低版本，`// indirect` 表示间接依赖 |
| `replace` / `exclude` | 替换依赖的来源（本地目录、fork）/ 排除某个版本，**只在主模块生效**，作为依赖被别人引用时会被忽略 |
| `retract` | 模块作者声明自己发布的某些版本有问题，不要再用 |
| `tool` | Go 1.24 起，记录项目用到的工具（代码生成器、lint），用 `go tool stringer` 运行，取代以前的 tools.go 空导入写法 |

go.sum 的每一行是"模块路径 版本 哈希"，版本以 `/go.mod` 结尾的只是那个 go.mod 文件的哈希，否则是整个模块 zip 内容的哈希。它是校验清单，不是 lock 文件，要和 go.mod 一起提交。

### 最小版本选择，和 npm 有什么不同

假设主模块依赖 A 和 B，A 要求 C v1.3，B 要求 C v1.5，C 已经发布到 v1.9。MVS 选 C v1.5：所有要求里最高的那个，而不是可用的最新版。只要 go.mod 不变，结果就不变，新发布的版本不会悄悄混进构建。

| | Go Modules | npm |
| --- | --- | --- |
| 版本声明 | 写的是最低版本 `v1.5.0` | 常写范围 `^1.5.0` |
| 怎么选 | MVS，取要求里的最大值 | 在范围内选最新的，再写进 lock 文件锁定 |
| 可复现靠什么 | go.mod 本身就够了，go.sum 负责校验内容 | 必须依赖 package-lock.json 等 lock 文件 |
| 同一依赖多版本 | 同一大版本只有一个版本；v1 和 v2 路径不同，可以共存 | 嵌套的 node_modules 里可以有多个版本 |

升级是显式的：`go get example.com/pkg@v1.6.0` 或 `go get -u ./...`。npm 的依赖管理见 [包管理器](/basics/node/10-package-managers)。

### 语义导入版本

Go 要求"导入路径相同的包必须向后兼容"。不兼容的改动要发新的大版本，v2 起模块路径要加大版本后缀：`module github.com/foo/bar/v2`，使用方导入 `github.com/foo/bar/v2/xxx`。v0、v1 不加后缀。v2 以上却没有 go.mod 的老仓库，版本号会显示成 `v4.1.2+incompatible`。

### 常用命令

- `go get pkg@version`：添加、升级或降级依赖，`@none` 删除；`go get -tool` 添加工具依赖
- `go mod tidy`：根据代码里实际的 import 补上缺的依赖、删掉没用的依赖，同时整理 go.sum，提交前应该跑一次。go 行为 1.27 及以上时，它还会把零散的 require 块合并成直接依赖、间接依赖两块
- `go mod vendor`：把依赖复制到 vendor 目录；go 版本不低于 1.14 且存在 vendor 目录时，构建默认使用 vendor
- `go mod why`、`go mod graph`、`go list -m all`：查依赖为什么被引入、依赖图、最终选中的版本

### 代理、校验和私有仓库

- `GOPROXY` 默认是 `https://proxy.golang.org,direct`：先从官方代理下载，代理返回 404 或 410 时直接从版本控制仓库拉取。国内常改成国内的镜像，例如 `go env -w GOPROXY=https://goproxy.cn,direct`
- `GOSUMDB` 默认是 `sum.golang.org`：第一次下载某个版本时，用全局的校验和数据库核对哈希，保证所有人拿到的同一个版本内容一致
- 私有仓库设置 `GOPRIVATE=*.corp.example.com`，匹配的模块不走公共代理，也不查公共校验和数据库（它是 `GONOPROXY` 和 `GONOSUMDB` 的默认值）。还要让 git 能访问私有仓库，比如配置 SSH 或访问令牌

## 代码示例

用 workspace 同时开发两个本地模块，不用改 go.mod 里的 replace：

```bash
# 目录结构：./shop 依赖 example.com/shared，shared 在 ./shared
go work init ./shop ./shared   # 生成 go.work，两个模块都成为主模块
go work use ./another          # 再加入一个模块

# shop 里 import 的 example.com/shared 会直接使用本地的 ./shared
cd shop && go build ./...
```

Go 1.18 起支持 workspace。官方文档一般不建议提交 go.work：它会让 CI 用本地组合的模块测试，测不出模块单独被别人依赖时的情况。

## 面试官可能追问

::: details 为什么 replace 只在主模块生效？
如果依赖里的 replace 也生效，任何一个第三方库都能偷偷把某个公共依赖换成别的代码，构建结果就不受你控制了。所以只有正在构建的主模块能决定替换；库作者调试时用的 replace，发布前要删掉，否则使用方会遇到版本不符合预期的问题。
:::

::: details MVS 选的不是最新版，安全漏洞修复怎么办？
需要主动升级：`go get -u` 或指定版本。可以用官方的 govulncheck 扫描，它会结合代码的调用关系，只报告实际调用到有漏洞函数的依赖。MVS 的取舍是"升级是显式的决定"，换来构建的可预测。
:::

::: details go.sum 里为什么有很多没直接用到的模块？
它记录的是构建过程中需要校验的所有模块，包括间接依赖，以及只需要读取 go.mod 来计算依赖图的模块，后者只有 `/go.mod` 那一行哈希。不要手动编辑 go.sum，用 `go mod tidy` 维护。
:::

## 易错点

- 发布 v2 时只打了 v2.0.0 的 tag，没有把 go.mod 的 module 改成 `.../v2`：使用方 `go get` 会失败或得到 `+incompatible`
- 把 go.sum 加进 .gitignore：其他人和 CI 下载时缺少校验依据，失去了防篡改的作用
- 以为 `go get -u` 只升级指定的包：它会把相关依赖都升级到最新的次版本或补丁版本，升级后要跑完整测试
