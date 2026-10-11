# 全栈面试手册

面试题手册网站：按目录系统复习前端、后端、AI 应用的高频面试题，带 **AI 模拟面试官**。

- **阅读端**：分类目录、题目详解（代码高亮、提示块、折叠追问、本页目录）、中文搜索、自测模式、深色模式
- **学习记录**：每道题标记"不会 / 模糊 / 掌握"、收藏、笔记；登录后存在数据库里，多设备同步；未登录时先存在本地，登录后自动合并
- **AI 模拟面试官**：用自己的话作答，AI 对照题库参考答案打分（0～10）、指出遗漏和错误，再追问，最多 3 轮；点评流式输出，低分题自动加入复习
- **管理后台**：题目增删改查（Markdown 编辑器 + 实时预览）、草稿和发布、分类管理、用户角色、AI 配置检查

技术栈：Nuxt 4（Vue 3 + Nitro）、MySQL 8、Drizzle ORM、nuxt-auth-utils、Element Plus、Shiki、MiniSearch。大模型走 OpenAI 兼容接口，默认接 Kimi（Moonshot）。

界面采用"编辑部手册"风格（暖白纸色、思源宋体标题、克莱因蓝点缀、AI 功能用渐变标识），颜色、字体、组件和题目正文的排版规则见 [DESIGN.md](DESIGN.md)。

## 本地运行

需要 Node.js 22.21+ 或 24 LTS，以及本机安装的 MySQL 8.0（Windows 默认路径 `C:\Program Files\MySQL\MySQL Server 8.0`，其他位置用环境变量 `MYSQL_HOME` 指定）。

```bash
npm install
npm run setup
npm run dev
```

`npm run setup` 会做三件事：在项目的 `.mysql/` 目录里初始化一个独立的 MySQL 实例（端口 3307，只监听本机，不注册系统服务），生成数据库账号和登录密钥写入 `.env`，然后建表并导入 `content/` 里的题目。

打开 http://localhost:3000 ，**第一个注册的账号会自动成为管理员**。

以后每次开发前先启动数据库：

```bash
npm run db:start
```

## 开启 AI 模拟面试官

1. 在 Kimi 开放平台（platform.moonshot.cn）创建 API Key
2. 打开 `.env`，填写 `NUXT_AI_API_KEY=你的 Key`
3. 重启 `npm run dev`，到"管理后台 → AI 设置"点"重新检查"，确认模型可用

| 变量 | 说明 |
| --- | --- |
| `NUXT_AI_API_KEY` | API Key，只在服务端使用，不会发到浏览器 |
| `NUXT_AI_BASE_URL` | 接口地址，默认 `https://api.moonshot.cn/v1` |
| `NUXT_AI_MODEL` | 模型名，可用列表见后台"AI 设置" |
| `NUXT_AI_DAILY_LIMIT` | 每个用户 24 小时内最多调用几次，默认 30 |

换成 DeepSeek、通义千问等服务商时，修改 `NUXT_AI_BASE_URL` 和 `NUXT_AI_MODEL` 即可。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 启动开发服务器 |
| `npm run db:start` / `db:stop` / `db:status` | 启动、停止、查看项目内的 MySQL |
| `npm run db:import` | 把 `content/` 里的 Markdown 题目导入数据库（按 slug 覆盖更新） |
| `npm run db:export` | 把数据库里的题目导出到 `content/`，方便备份和用 Git 管理 |
| `npm run db:rerender` | 修改了 Markdown 渲染规则后，重新生成所有题目的 HTML |
| `npm run content:check` | 检查 `content/` 里题目的格式（结构、链接、表格等），可以只传分类名，如 `npm run content:check -- react` |
| `npm run db:generate` | 修改 `server/db/schema.ts` 后生成迁移文件 |
| `npm run db:migrate` | 执行迁移 |
| `npm run build` | 构建生产版本，输出到 `.output/` |

## 目录结构

```text
app/                 前端（Nuxt 4）
├─ pages/            页面：首页、题目页、我的进度、登录注册、管理后台
├─ components/       组件：目录、学习面板、AI 面试面板、Markdown 编辑器……
├─ composables/      目录数据、学习记录、自测模式
└─ assets/css/       全局样式和正文样式
server/              后端（Nitro）
├─ api/              接口：题目、搜索、学习记录、AI 面试（SSE 流式）、管理后台
├─ db/               表结构和迁移文件
└─ utils/            数据库、Markdown 渲染、搜索索引、AI 调用和提示词
shared/types/        前后端共用的类型
content/             题库 Markdown（初始数据，outline.json 定义部分和分类）
scripts/             MySQL 实例管理、导入导出脚本
templates/           新题目的 Markdown 模板和写作规范（writing-guide.md）
```

## AI 模拟面试官是怎么实现的

1. 前端把回答 POST 到 `/api/interviews/stream`，用 `fetch` + `ReadableStream` 解析 SSE（`EventSource` 不支持 POST）
2. 服务端校验登录和 24 小时调用次数，取出题目的参考答案（去掉代码块以节省 token），拼成提示词
3. 回答放在 `<answer>` 标签里并去掉伪造的标签，系统提示词要求把其中的指令当作内容评价，防止提示注入
4. 以流式方式调用大模型，边收边转发给前端；用户点"停止"或关闭页面时同时中断上游请求
5. 生成结束后解析得分和追问，保存面试记录；低于 8 分的题自动标记为"不会"或"模糊"
6. 前端渲染 AI 输出时转义原始 HTML、禁用图片，防止 XSS 和通过图片地址外传数据

## 部署

`npm run build` 后，用 `node --env-file=.env .output/server/index.mjs` 运行（默认端口 3000，可用 `PORT` 修改）。生产环境请使用正式的 MySQL 实例，修改 `NUXT_DATABASE_URL`，并执行 `npm run db:migrate` 和 `npm run db:import`。
