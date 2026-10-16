# 全栈面试手册

面试题手册网站：按目录系统复习前端、后端、AI 应用的高频面试题，带 **AI 模拟面试官**。

- **阅读端**：分类目录、题目详解（代码高亮、提示块、折叠追问、本页目录）、中文搜索、自测模式、深色模式
- **学习记录**：每道题标记"不会 / 模糊 / 掌握"、收藏、笔记；登录后存在数据库里，多设备同步；未登录时先存在本地，登录后自动合并
- **AI 模拟面试官**：用自己的话作答，AI 对照题库参考答案打分（0～10）、指出遗漏和错误，再追问，最多 3 轮；点评流式输出，低分题自动加入复习
- **问手册（RAG）**：用自己的话提问，先从题库里检索相关段落（关键词 + 向量混合检索），再让 AI 根据这些段落回答，每句话标出处、点编号直达原题；支持连续追问，搜索框里也能一键转去问
- **整场模拟面试**：按方向（前端、Go / Java / Node.js 后端、AI 应用等）和难度抽题，连续作答、追问，结束后给出各题得分、分类得分和 AI 总结；可以中途停下，下次接着答
- **间隔复习**：用 FSRS 算法安排复习时间，标记掌握程度、AI 面试得分都会更新计划；"今日复习"页逐题回忆、对照一句话回答、评分
- **学习周报**：本周学习时长、学习天数、复习和面试成绩（和上周对比）、每天的学习时长、最近 8 周趋势、最卡的题、各分类情况和下周建议。阅读时长只算页面在前台、并且最近一分钟内有操作的时间；只记登录用户，事件存在自己的数据库里（`events` 表），不记录回答内容，不接第三方统计
- **自带 API Key**：用户可以在面试面板里填自己的 Key（只存在浏览器里），不受站点每日次数限制
- **管理后台**：运营看板（AI 用量和估算花费、每日活跃、学习数据、题目难度榜）；题目编辑（Markdown 实时预览、和 `content:check` 同一套规则的边写边检查、修改历史对比和恢复、未保存提醒）；AI 写题（按写作规范起草正文、修复检查问题、参考面试反馈改写、按要求修改，改写稿先对比再采用；推荐分类里缺的题）；批量发布 / 转草稿 / 移动 / 删除；分类管理；用户和最近活跃；AI 设置在线修改（模型、次数、是否允许自带 Key、价格）

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

后台的 AI 写题也用这个 Key，提示词里带上 `templates/writing-guide.md` 写作规范和同分类的一道题作参考；管理员写题不占每日次数，用量在概览的按功能里单独统计。

| 变量 | 说明 |
| --- | --- |
| `NUXT_AI_API_KEY` | API Key，只在服务端使用，不会发到浏览器 |
| `NUXT_AI_BASE_URL` | 接口地址，默认 `https://api.moonshot.cn/v1` |
| `NUXT_AI_MODEL` | 模型名，可用列表见后台"AI 设置" |
| `NUXT_AI_DAILY_LIMIT` | 每个用户 24 小时内最多调用几次，默认 30 |
| `NUXT_AI_EXTRA_HOSTS` | 用户自带 Key 时，除内置服务商外额外允许的域名，逗号分隔 |

换成 DeepSeek、通义千问等服务商时，修改 `NUXT_AI_BASE_URL` 和 `NUXT_AI_MODEL` 即可。

## 问手册的向量检索

问手册不配置也能用（只用关键词检索）。配置向量模型后，换个说法提问也能找到对应的题：

1. 在硅基流动（siliconflow.cn）注册并创建 API Key，费用以它的定价页为准
2. 在 `.env` 里填写 `NUXT_EMBED_API_KEY=你的 Key`，重启服务
3. 服务启动后会在后台给所有题目生成向量，进度在"管理后台 → 知识库"里看；那里还能输入问题调试检索结果

换成其他 OpenAI 兼容的向量接口时，修改 `NUXT_EMBED_BASE_URL` 和 `NUXT_EMBED_MODEL`。换了模型会自动重新生成全部向量。

## 注册邮箱验证码

配置了发信邮箱后，注册时要先填邮件里的 6 位验证码，防止用随便编的邮箱批量注册。没配置时注册照常，不需要验证码。已有账号不受影响，登录也不需要验证码。

以 QQ 邮箱为例：

1. 登录 QQ 邮箱网页版，在设置里找到"POP3/IMAP/SMTP 服务"并开启，按提示生成授权码（授权码不是 QQ 密码）
2. 在 `.env` 里填写：

   ```bash
   NUXT_MAIL_HOST=smtp.qq.com
   NUXT_MAIL_PORT=465
   NUXT_MAIL_USER=你的邮箱@qq.com
   NUXT_MAIL_PASS=刚才生成的授权码
   NUXT_MAIL_FROM=全栈面试手册 <你的邮箱@qq.com>
   ```

3. 重启应用，到"管理后台 → 用户"点"发测试邮件给我"，收到邮件就说明配置好了

云服务器一般封了 25 端口，要用 465（SSL）或 587。QQ 邮箱要求发件人地址和 `NUXT_MAIL_USER` 一致。发信出问题时，可以在"管理后台 → 用户"里临时关掉"注册需要邮箱验证码"，不用改配置。

验证码 10 分钟内有效，输错 5 次作废。发送频率有限制：同一个邮箱 60 秒一次、一小时 5 次；同一个 IP 一小时 10 次、一天 30 次；全站一天 500 封（保护发信邮箱不被服务商限制）。这些数字可以用 `NUXT_AUTH_CODE_COOLDOWN_SECONDS`、`NUXT_AUTH_CODE_PER_EMAIL_HOURLY`、`NUXT_AUTH_CODE_PER_IP_HOURLY`、`NUXT_AUTH_CODE_PER_IP_DAILY`、`NUXT_AUTH_CODE_DAILY_TOTAL` 调整。

本地开发想试验证码又不想真发邮件时，设置 `NUXT_MAIL_OUTBOX_DIR=.data/outbox`，邮件会写成 JSON 文件放在这个目录里。

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
| `npm run eval:retrieval` | 评测问手册的检索效果（见下面"问手册是怎么实现的"），加 `-- --verbose` 看没找回来的问题排在前面的是什么 |
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

## 问手册（RAG）是怎么实现的

代码在 `server/utils/rag-core.ts`（切块、检索、融合、评测指标，纯函数）、`server/utils/rag.ts`（索引同步、内存检索器）和 `server/api/ask.post.ts`。

1. **切块**：每道题按二级标题切开，"一句话回答"单独一块（整题的摘要），"面试官可能追问"里每个折叠块各成一块（用户常直接问追问的内容），超过 900 字的小节按段落再切。送去生成向量的文本带上题目和小节标题，单独一块也知道在讲什么。462 道题切成约 4100 块
2. **增量同步**：每块存内容的 SHA-256。服务启动和后台改题后几秒内自动同步，哈希没变的块沿用旧向量，只给新增和改过的块调用向量接口；换了向量模型时全部重新生成。向量接口出错不影响关键词检索，下次同步接着生成
3. **混合检索**：关键词一路用 MiniSearch（BM25），中文用 `Intl.Segmenter` 分词，去掉"怎么""什么""说说"这类口头词，被切成单字的词两两拼回双字词；向量一路在内存里和所有块算余弦相似度（4000 块只要几毫秒，到几十万块再换向量数据库）。两路结果用 RRF（`Σ 1 / (60 + 排名)`）按排名融合，不用处理两种分数量纲不同的问题。每道题最多取 2 块，取前 6 块
4. **生成**：资料带编号放进提示词，要求每句话标出处、资料里没有的明确说"手册里没有直接讲到"；资料和问题里的指令一律当普通文字（防提示注入）。多轮对话时，短追问（"那它的缺点呢"）补上上一个问题再检索，历史回答里的旧编号去掉。一段资料都没检索到时直接回复，不调用大模型、不占次数
5. **展示**：先推送检索到的资料（SSE 的 `sources` 事件），页面马上显示"找到几段资料"，再流式输出回答；回答里的 `[n]` 换成指向原题的链接，模型编出的不存在的编号直接去掉

**评测**：`evals/retrieval.json` 有 60 个问题，覆盖全部 34 个分类，分四类：换个说法问（paraphrase）、工作场景（scenario）、问的是追问或易错点（followup）、口语化（colloquial），都不照抄题目标题。`npm run eval:retrieval` 对比只用关键词、只用向量、混合检索三种方式的 Recall@1/3/5 和 MRR，并列出没找回来的问题。没有配置向量模型时，只用关键词的成绩是 Recall@5 96.7%、MRR 0.84，没找回来的两个都是字面上不重合的场景题（"翻到几千页以后很慢"→ 深分页），正是向量检索要解决的。

## 部署

线上用一台 Ubuntu 24.04 服务器（2 核 4G 够用），Docker 跑三个容器：MySQL 8.4、应用、Caddy。Caddy 负责自动申请和续期 HTTPS 证书。配置都在 `deploy/` 目录里。

**第一次准备**

1. 服务器装好 Docker，用 SSH 密钥登录，防火墙放行 22、80、443
2. 给域名添加 A 记录（`@` 和 `www`），指向服务器 IP
3. 在项目根目录新建 `.env.deploy`（不会提交）：

   ```bash
   DEPLOY_HOST=ubuntu@服务器IP
   DEPLOY_KEY=~/.ssh/私钥文件
   DEPLOY_DOMAIN=你的域名
   ```

4. 执行 `npm run deploy -- --import`：上传代码，在服务器上构建镜像，建表并导入 `content/` 里的题目

第一次部署时，会在服务器的 `/opt/handbook/.env` 里随机生成数据库密码和登录密钥。AI Key 和发信邮箱（`NUXT_MAIL_*`，见上面的"注册邮箱验证码"）也填在这个文件里，填好后在服务器上执行 `cd /opt/handbook && docker compose up -d app` 生效。

**以后发布**：执行 `npm run deploy`。只发布已经提交的代码，有未提交的修改会提示，但不会上传。上一版代码保留在服务器的 `/opt/handbook/src.prev`。

**题目以线上后台为准**：上线后在线上后台改题。服务器上没有 `content/` 目录，修改只保存在数据库里。本地新写的题要发布时，先提交再执行 `npm run deploy -- --import`。导入不会覆盖线上比文件新的题。

**备份**：服务器每天 03:30 自动备份数据库到 `/opt/handbook/backups`，保留 14 天。`npm run deploy:backup` 会立即备份一次，并下载到本地的 `backups/` 目录。

**常用运维命令**（在服务器的 `/opt/handbook` 目录里执行）：

| 命令 | 作用 |
| --- | --- |
| `docker compose ps` | 查看各容器状态 |
| `docker compose logs -f app` | 查看应用日志 |
| `docker compose logs caddy` | 查看证书申请情况 |
| `docker compose up -d app` | 改了 `.env` 之后重启应用 |
| `docker compose run --rm tools npx tsx scripts/db.ts export /tmp/out` | 把线上题目导出成 Markdown |
