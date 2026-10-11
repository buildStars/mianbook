---
difficulty: 3
tags: [系统设计, 场景题]
---

# 设计一个网盘或文件存储服务

::: tip 一句话回答
核心是**元数据和内容分离**：MySQL 存目录树、文件名、大小这些元数据，文件内容放对象存储。内容按**哈希去重**，一份内容（blob）可以被很多用户文件引用，靠**引用计数**决定什么时候真正删除。上传走**分片直传对象存储**，服务端只负责签发预签名 URL 和记录进度，支持断点续传；哈希已存在就**秒传**，只加一条元数据。下载返回**短期有效的预签名 URL**，热门文件走 **CDN**。分享是一条带随机分享码、提取码和有效期的记录；**配额**用条件更新原子扣减；小文件合并存储、冷数据转低频存储来降低成本。
:::

## 详细解析

### 第一步：澄清需求

- **功能**：上传、下载、目录管理（新建、移动、重命名、删除）、回收站、分享、预览、搜索
- **文件**：从几 KB 的文档到几十 GB 的视频；要不要多端自动同步（同步盘）？先不做
- **非功能**：文件不能丢、不能被未授权的人访问，上传下载要快

量级估算（以下数字都是假设）：注册用户 1000 万，人均 1000 个文件，平均每个 2 MB。

- 元数据：1000 万 × 1000 = 100 亿条，每条约 300 字节，约 3 TB，要按 `user_id` 分库分表
- 文件内容：100 亿 × 2 MB = 20 PB（去重前），只能放对象存储
- 上传：日活 100 万，每人每天传 10 个文件，每天 1000 万次，平均约 116 次/秒；流量 1000 万 × 2 MB = 20 TB / 天，平均约 1.85 Gbps，所以文件内容不能经过应用服务器中转

### 第二步：整体架构

```text
客户端 ── ① 申请上传（文件名、大小、内容哈希）──> 文件服务（无状态）
          │ 哈希已存在：秒传，只写元数据
          │ 不存在：在对象存储创建分片上传，签发每个分片的预签名 URL
客户端 ── ② 并发上传分片（直传，不经过文件服务）──> 对象存储
客户端 ── ③ 完成上传 ──> 文件服务：通知对象存储合并 → 校验 → 写 blob、用户文件，扣配额

下载：客户端 ──> 文件服务（鉴权）──> 返回预签名 URL 或 CDN 地址 ──> CDN ──回源──> 对象存储
元数据：MySQL（按 user_id 分片）+ Redis（目录列表缓存、上传进度）
异步：缩略图和转码、病毒和内容扫描、引用为 0 的 blob 延迟删除、过期分享清理
```

### 第三步：核心模块和数据模型

```sql
CREATE TABLE file_blob (                 -- 一份实际内容，多个用户文件可以共用
  id          BIGINT PRIMARY KEY,
  hash        CHAR(64) NOT NULL UNIQUE,  -- 内容的 SHA-256
  size        BIGINT NOT NULL,
  storage_key VARCHAR(255) NOT NULL,     -- 在对象存储里的 key
  ref_count   INT NOT NULL DEFAULT 0,
  status      VARCHAR(16) NOT NULL       -- ACTIVE / DELETING
);
CREATE TABLE user_file (                 -- 用户看到的文件和目录，按 user_id 分片
  id         BIGINT PRIMARY KEY,
  user_id    BIGINT NOT NULL,
  parent_id  BIGINT NOT NULL,            -- 所在目录，0 表示根目录
  name       VARCHAR(255) NOT NULL,
  is_dir     TINYINT NOT NULL,
  blob_id    BIGINT,                     -- 目录没有内容
  size       BIGINT NOT NULL DEFAULT 0,
  deleted_at DATETIME,                   -- 放进回收站的时间
  UNIQUE KEY uk_name (user_id, parent_id, name)  -- 同一目录下不重名
);
-- 另有 upload_task（上传任务和已完成的分片）、share（分享）、user_quota（已用和总配额）
```

**目录树怎么存**：

| 方案 | 做法 | 列出目录 | 移动目录 | 查完整路径 |
| --- | --- | --- | --- | --- |
| 邻接表 | 每个节点存 `parent_id` | 快，按 `(user_id, parent_id)` 查 | 快，只改一行 | 要逐级往上查 |
| 路径枚举 | 每个节点存完整路径，如 `/a/b/c` | 前缀匹配 | 慢，子树里每个节点的路径都要改 | 直接有 |
| 闭包表 | 另一张表存所有"祖先-后代"对 | 快 | 慢，要重建子树的关系 | 快 |

网盘里移动、重命名目录很常见，一般用邻接表；面包屑路径逐级向上查，层级通常不深，可以缓存。放进回收站时把文件移出原目录（比如挂到回收站节点下），否则它会一直占着原来的文件名。

### 第四步：关键难点

**分片上传和断点续传**：客户端怎么切片、算哈希、控制并发见[大文件上传](/basics/network/18-large-file-upload)，这里讲服务端：

- 上传任务记录对象存储返回的上传 ID 和已完成的分片号；客户端中断后重新申请，服务端返回已完成的分片，只补传剩下的
- 分片大小受对象存储限制，以 S3 为例：一次分片上传最多 10000 个分片，除最后一片外每片 5 MiB～5 GiB，超大文件要相应调大分片
- 没完成的分片上传会一直占用存储：上传任务设过期时间，到期调用中止接口；对象存储侧再配置生命周期规则，自动清理长时间未完成的分片上传

**秒传的安全问题**：只凭客户端报上来的哈希就秒传，别人拿到一个文件的哈希，就能"秒传"出这个文件，等于绕过了权限。防法是服务端随机指定文件里的一段范围，让客户端计算这一段的哈希，证明它确实有这个文件。正常上传的内容也不能直接信任客户端给的哈希，服务端校验通过之前，不能作为别人秒传的来源。

**引用计数和删除**：

1. 用户删除文件：进入回收站（记录 `deleted_at`），配额暂不释放
2. 回收站到期或用户彻底删除：在一个事务里删除 `user_file` 记录、blob 的 `ref_count` 减 1、释放配额。删除整个目录时子树可能很大，交给后台任务分批执行，界面上先显示"删除中"
3. 清理任务找 `ref_count = 0` 的 blob，用条件更新标记为 `DELETING`，过一段时间再删除对象存储里的内容，最后删记录
4. 秒传给 blob 加引用时也带上 `status = 'ACTIVE'` 条件（见代码示例），清理和秒传同时发生时只有一方能成功

**下载和分享**：

- 下载：服务端鉴权后返回预签名 URL，有效期设短一些（几分钟到几小时），签名里可以指定下载时的文件名；文件内容不经过应用服务器
- CDN：公开分享的热门文件走 CDN（见 [CDN](/basics/network/12-cdn)）；私有文件用 CDN 的 URL 鉴权（签名 + 过期时间），不能给永久公开的地址
- 分享：分享码要随机且足够长（自增 ID 会被遍历），可选提取码、有效期和访问次数上限；"保存到我的网盘"就是给同一个 blob 加一个引用，瞬间完成

**配额**：`UPDATE user_quota SET used = used + ? WHERE user_id = ? AND used + ? <= total`，影响 0 行就是空间不足，并发上传也不会超额。

### 第五步：扩展与优化

- **小文件**：海量小文件各存一个对象，元数据和请求次数的开销都大。可以把很多小文件追加写进一个大文件，元数据记录"大文件 + 偏移 + 长度"，Facebook 的 Haystack 就是这个思路；删除时先标记，定期压缩回收空间
- **冷热分层**：长期没人访问的文件转到低频或归档存储，成本更低，代价是读取更慢、可能有取回费用
- **自建还是上云**：云对象存储省心；自建可以用 MinIO、Ceph 这类系统，内部用多副本或纠删码保证可靠性
- **同步盘**：多端同步要处理文件版本、增量同步（只传变化的块）和冲突，复杂度高很多

## 代码示例

秒传（或上传完成后）把文件挂到用户目录下：加引用、扣配额、写用户文件，在一个事务里完成（Node.js + mysql2）：

```js
export async function addFileByHash(pool, { userId, parentId, name, hash }) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [[blob]] = await conn.query("SELECT id, size FROM file_blob WHERE hash = ? AND status = 'ACTIVE'", [hash])
    // 条件更新：清理任务可能刚把这个 blob 标记为删除中，这时不能再引用它
    const [r1] = blob
      ? await conn.query("UPDATE file_blob SET ref_count = ref_count + 1 WHERE id = ? AND status = 'ACTIVE'", [blob.id])
      : [{ affectedRows: 0 }]
    if (r1.affectedRows === 0) {
      await conn.rollback()
      return null // 没有可复用的内容，走正常上传
    }
    const [r2] = await conn.query('UPDATE user_quota SET used = used + ? WHERE user_id = ? AND used + ? <= total',
      [blob.size, userId, blob.size])
    if (r2.affectedRows === 0) throw new Error('空间不足')
    // 同一目录下重名由唯一索引 (user_id, parent_id, name) 拦住
    const [r3] = await conn.query('INSERT INTO user_file (user_id, parent_id, name, is_dir, blob_id, size) VALUES (?, ?, ?, 0, ?, ?)',
      [userId, parentId, name, blob.id, blob.size])
    await conn.commit()
    return r3.insertId
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
}
// 清理任务：UPDATE file_blob SET status = 'DELETING' WHERE id = ? AND ref_count = 0 AND status = 'ACTIVE'
// 影响 1 行才去删对象存储里的内容；和上面的加引用互斥，不会删掉刚被秒传引用的内容
```

## 面试官可能追问

::: details 内容哈希用 MD5 还是 SHA-256？
去重用 SHA-256。MD5 已经可以人为构造碰撞：攻击者做出两个 MD5 相同、内容不同的文件，先上传一个，别人上传另一个时就会被"秒传"成攻击者的内容。MD5 可以只用来校验传输是否出错。去重的 key 也可以用"哈希 + 文件大小"，多一层保险。
:::

::: details 一个违规文件被很多用户秒传了，怎么处理？
处理在 blob 这一层：把 blob 标记为封禁，所有引用它的用户文件都不能下载和分享，不用逐个用户处理。同时把它的哈希加入黑名单，以后再上传或秒传同样的内容直接拒绝。内容扫描也在 blob 层做一次即可，去重后扫描量也少了。
:::

::: details 同一个用户在两台设备上，同时往同一目录传同名文件，会怎样？
唯一索引 `(user_id, parent_id, name)` 保证只有一个成功，另一个收到冲突。产品上可以自动重命名成"文件名(1)"，或者把它作为同名文件的新版本保存，不会出现两个同名文件，也不会互相覆盖而丢数据。
:::

::: details 怎么支持文件的历史版本？
增加一张版本表，用户文件指向当前版本，每个版本引用一个 blob。上传新版本只是新增一行并给新 blob 加引用，旧版本的 blob 引用不变；按保留规则（比如最多 N 个版本、保留 30 天）清理旧版本时，再给对应的 blob 减引用。历史版本占用的空间要不要计入配额，是产品决策。
:::

## 易错点

- 让文件内容经过应用服务器中转，带宽和内存都扛不住，应该直传对象存储
- 只凭客户端给的哈希就秒传，等于让知道哈希的人都能拿到文件
- 用户删除文件时直接删对象存储里的内容，其他引用同一个 blob 的用户文件就坏了
- 预签名 URL 有效期设得很长，或者把私有文件放在公开可读的地址上，链接一旦外传就无法收回
