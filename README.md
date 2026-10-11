# 全栈面试手册

面试题手册网站：按目录系统复习前端、后端、AI 应用的高频面试题，带 **AI 模拟面试官**。

- **阅读端**：分类目录、题目详解（代码高亮、提示块、折叠追问、本页目录）、中文搜索、自测模式、深色模式
- **学习记录**：每道题标记"不会 / 模糊 / 掌握"、收藏、笔记；登录后存在数据库里，多设备同步；未登录时先存在本地，登录后自动合并
- **AI 模拟面试官**：用自己的话作答，AI 对照题库参考答案打分（0～10）、指出遗漏和错误，再追问，最多 3 轮；点评流式输出，低分题自动加入复习
- **整场模拟面试**：按方向（前端、Go / Java / Node.js 后端、AI 应用等）和难度抽题，连续作答、追问，结束后给出各题得分、分类得分和 AI 总结；可以中途停下，下次接着答
- **间隔复习**：用 FSRS 算法安排复习时间，标记掌握程度、AI 面试得分都会更新计划；"今日复习"页逐题回忆、对照一句话回答、评分
- **学习周报**：本周学习时长、学习天数、复习和面试成绩（和上周对比）、每天的学习时长、最近 8 周趋势、最卡的题、各分类情况和下周建议。阅读时长只算页面在前台、并且最近一分钟内有操作的时间；只记登录用户，事件存在自己的数据库里（`events` 表），不记录回答内容，不接第三方统计
- **自带 API Key**：用户可以在面试面板里填自己的 Key（只存在浏览器里），不受站点每日次数限制
- **管理后台**：运营看板（AI 用量和估算花费、每日活跃、学习数据、题目难度榜）；题目编辑（Markdown 实时预览、和 `content:check` 同一套规则的边写边检查、修改历史对比和恢复、未保存提醒）；批量发布 / 转草稿 / 移动 / 删除；分类管理；用户和最近活跃；AI 设置在线修改（模型、次数、是否允许自带 Key、价格）

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
3. 重启 `npm run dev`，到"管理后台 → AI 设置"点"测试当前填写的模型"，确认可用

下表里的模型、次数、额外域名是默认值，可以在"管理后台 → AI 设置"里在线修改，保存后立即生效（存在数据库的 `settings` 表里）；那里还能关闭"用户自带 Key"、填写模型价格来估算花费。接口地址和 API Key 只能在 `.env` 里改。

| 变量 | 说明 |
| --- | --- |
| `NUXT_AI_API_KEY` | API Key，只在服务端使用，不会发到浏览器 |
| `NUXT_AI_BASE_URL` | 接口地址，默认 `https://api.moonshot.cn/v1` |
| `NUXT_AI_MODEL` | 模型名，可用列表见后台"AI 设置" |
| `NUXT_AI_DAILY_LIMIT` | 每个用户 24 小时内最多调用几次，默认 30 |
| `NUXT_AI_EXTRA_HOSTS` | 用户自带 Key 时，除内置服务商外额外允许的域名，逗号分隔 |

换成 DeepSeek、通义千问等服务商时，修改 `NUXT_AI_BASE_URL` 和 `NUXT_AI_MODEL` 即可。

## 后台修改和 content/ 目录

`content/` 里的 Markdown 是题库的源文件，可以用 Git 管理。在管理后台新建、修改、移动、删除题目或分类时，改动会同时写回 `content/` 下对应的文件和 `outline.json`，所以之后再 `db:import` 不会冲掉后台的修改。部署环境里没有 `content/` 目录时只保存到数据库（后台侧栏会显示"仅保存到数据库"），记得定期 `db:export` 备份。

后台每次保存题目都会记一个历史版本（每题最多 50 个），可以在编辑页的"历史"里和当前内容逐行对比，并载入旧版本。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 启动开发服务器 |
| `npm run db:start` / `db:stop` / `db:status` | 启动、停止、查看项目内的 MySQL |
| `npm run db:import` | 把 `content/` 里的 Markdown 题目导入数据库（按 slug 更新）。数据库里的题比文件新、内容又不一样时跳过并提示，确认要用文件覆盖时加 `-- --force` |
| `npm run db:export` | 把数据库里的题目导出到 `content/`，方便备份和用 Git 管理 |
| `npm run db:rerender` | 修改了 Markdown 渲染规则后，重新生成所有题目的 HTML |
| `npm run content:check` | 检查 `content/` 里题目的格式（结构、链接、表格等），可以只传分类名，如 `npm run content:check -- react` |
| `npm run typecheck` | 用 vue-tsc 检查前端、服务端、`shared/` 和 `nuxt.config.ts` 的类型 |
| `npm run db:generate` | 修改 `server/db/schema.ts` 后生成迁移文件 |
| `npm run db:migrate` | 执行迁移 |
| `npm run build` | 构建生产版本，输出到 `.output/` |
| `npm test` | 单元测试：提示词拼接和防注入、分数解析、复习排期、Key 校验、SSE 解析等，不需要数据库，1 秒内跑完 |
| `npm run test:api` | 接口测试：构建并启动真实服务，连独立的测试库 `handbook_test` 和测试里自带的模拟大模型，覆盖登录权限、单题面试、复习计划、模拟面试、按简历出题等流程。需要先 `npm run db:start`；不读写正式数据，也不影响正在运行的开发服务器 |
| `npm run test:all` | 两类测试一起跑 |

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
