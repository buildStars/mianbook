---
difficulty: 3
tags: [原理]
---

# Raft 共识算法是怎么工作的？

::: tip 一句话回答
Raft 让一组节点对**同一份操作日志**达成一致，各节点按相同顺序执行日志，就得到相同的状态（复制状态机）。它把问题拆成三块：**领导者选举**（节点分为 Leader、Follower、Candidate，Follower 在随机的选举超时内收不到心跳就发起选举，拿到**多数票**当选，每个任期最多一个 Leader）；**日志复制**（所有写请求交给 Leader，Leader 把日志复制到**多数节点**后才提交）；**安全性**（只有日志足够新的节点才能当选，保证已提交的日志不会丢）。5 个节点的集群能容忍 2 个节点故障。etcd、Consul 都基于 Raft。
:::

## 详细解析

### 为什么需要共识

单个节点存数据有单点问题，多副本又要解决"副本之间听谁的"：网络会丢包、延迟，节点会宕机重启，如果每个副本各自接受写入，数据就分叉了。共识算法保证：只要**多数节点**正常并能互相通信，系统就能继续工作，并且所有节点看到的已提交日志完全一致。这就是 [CAP](/basics/distributed/01-cap-base) 里的 CP：少数派一侧的节点不能提供写服务。

Raft 和 Paxos 解决的是同一个问题，容错能力相当。Raft 的设计目标是**容易理解**，把共识拆成相对独立的子问题，并通过强 Leader 简化了日志管理，所以工程实现大多选 Raft。

### 角色和任期

| 角色 | 职责 |
| --- | --- |
| Leader | 处理所有客户端写请求，向 Follower 复制日志，定期发送心跳 |
| Follower | 被动接收 Leader 的日志和心跳，响应投票请求 |
| Candidate | 选举期间的临时角色，向其他节点拉票 |

**任期（term）** 是一个单调递增的编号，每次选举开始任期加 1，起到逻辑时钟的作用：节点发现对方的任期比自己大，就更新任期并变回 Follower；收到任期比自己小的请求，直接拒绝。

### 领导者选举

```text
Follower ──选举超时，没收到心跳──> Candidate：任期 + 1，投自己一票，向其他节点发 RequestVote
   ^                                  │
   │ 发现更大的任期或新 Leader          ├── 获得多数票 ──> Leader，立即发送心跳
   │                                  ├── 收到新 Leader 的心跳 ──> 退回 Follower
   └──────────────────────────────────┴── 超时，没人获得多数 ──> 任期 + 1，重新选举
```

- 每个节点在一个任期内**最多投一票**，先到先得，所以一个任期最多选出一个 Leader
- 选举超时是**随机的**（论文中的例子是 150～300ms），让节点错开发起选举，减少多个 Candidate 同时拉票、平分选票的情况

### 日志复制

1. 客户端把写请求发给 Leader，Leader 把它追加到自己的日志，每条日志带有**任期和下标**
2. Leader 并行地向 Follower 发送 AppendEntries，里面带着新日志前一条的下标和任期
3. Follower 检查自己在那个位置的日志任期是否匹配，不匹配就拒绝；Leader 回退，找到双方一致的位置，从那里开始覆盖 Follower 的日志
4. 日志被复制到**多数节点**后，Leader 把它标记为已提交，应用到状态机，返回客户端
5. Leader 在后续的 AppendEntries 和心跳里带上已提交的位置，Follower 据此应用日志

这个检查保证了**日志匹配特性**：两个节点的日志在某个下标上任期相同，那么这个位置以及之前的所有日志都完全相同。

### 安全性和网络分区

**选举限制**：投票时比较双方最后一条日志，任期大的更新，任期相同则更长的更新；候选人的日志不如自己新，就不投票。已提交的日志一定存在于多数节点上，而当选也需要多数票，两个多数派必有交集，所以新 Leader 一定包含所有已提交的日志。

**只按计数提交当前任期的日志**：Leader 不能因为一条旧任期的日志已经复制到多数节点就提交它（论文图 8 给出了这样做会被覆盖的反例），而是等当前任期的日志过半后，连同之前的日志一起提交。

**网络分区**：5 个节点分成 {A, B} 和 {C, D, E}，旧 Leader A 在少数派一侧：

```text
少数派 {A, B}：A 仍以为自己是 Leader，但写请求复制不到多数节点，无法提交，客户端超时
多数派 {C, D, E}：选举超时后选出新 Leader（任期更大），继续提供服务
分区恢复：A 收到更大任期的消息，退回 Follower，未提交的日志被新 Leader 的日志覆盖
```

所以不会出现两个 Leader 同时提交数据的"脑裂"。但旧 Leader 如果直接用本地数据响应读请求，可能读到旧值，要保证线性一致读，论文给了两个前提：新 Leader 上任时先提交一条空日志（no-op），确认哪些日志已提交；处理读请求前和多数节点交换一次心跳，确认自己没被取代。etcd 的 ReadIndex 就是按这个思路实现的，读请求不用写日志。

## 代码示例

两个关键判断：投票时的"日志是否足够新"，以及 Leader 推进提交位置。

```js
// 候选人的日志至少和自己一样新，才投票：先比最后一条日志的任期，再比长度
function isUpToDate(candidate, mine) {
  if (candidate.lastLogTerm !== mine.lastLogTerm) return candidate.lastLogTerm > mine.lastLogTerm
  return candidate.lastLogIndex >= mine.lastLogIndex
}

// 找最大的 N：多数节点的 matchIndex >= N，且 log[N] 属于当前任期
function advanceCommitIndex({ matchIndex, log, currentTerm, commitIndex }) {
  const sorted = [...matchIndex].sort((a, b) => b - a) // matchIndex 包含 Leader 自己
  const majorityIndex = sorted[Math.floor(matchIndex.length / 2)] // 多数节点都已复制到的位置
  for (let n = majorityIndex; n > commitIndex; n--) {
    if (log[n].term === currentTerm) return n
  }
  return commitIndex
}

// 5 个节点，日志下标从 1 开始
const log = [null, { term: 1 }, { term: 1 }, { term: 2 }, { term: 3 }]
console.log(advanceCommitIndex({ matchIndex: [4, 4, 3, 1, 1], log, currentTerm: 3, commitIndex: 1 })) // 1：下标 3 属于旧任期，不能直接提交
console.log(advanceCommitIndex({ matchIndex: [4, 4, 4, 1, 1], log, currentTerm: 3, commitIndex: 1 })) // 4：当前任期的日志过半，连同之前的一起提交
```

## 面试官可能追问

::: details 为什么集群节点数一般是奇数？
容错能力取决于多数派：3 个节点容忍 1 个故障，4 个节点也只能容忍 1 个（多数是 3），5 个节点容忍 2 个。偶数节点不增加容错能力，反而多一个节点参与复制，写入更慢。节点也不是越多越好，每次写入都要等多数节点确认，常见规模是 3 或 5 个。
:::

::: details 一个节点被网络隔离后不停地发起选举，恢复后会干扰集群吗？
会。它的任期会一直增长，重新连上后，更大的任期会让当前 Leader 退位，触发一次不必要的选举。Raft 作者 Diego Ongaro 的博士论文提出了 **Pre-Vote**：发起正式选举前先"预投票"，确认自己能赢得多数票才真正增加任期。etcd 等实现支持这个机制。
:::

::: details 日志无限增长怎么办？集群成员怎么变更？
用**快照**压缩日志：把某个位置之前的状态保存为快照，删掉之前的日志；落后太多的 Follower 直接通过 InstallSnapshot 接收快照。成员变更如果直接从旧配置切到新配置，切换过程中可能出现两个不相交的多数派，论文用**联合共识**过渡，作者后来又提出了每次只增删一个节点的简化方法。
:::

## 易错点

- 认为写请求复制到 Leader 就算成功，实际要复制到多数节点才提交
- 认为 Raft 集群只要有节点存活就能写，实际少于多数时整个集群不可写
- 把选举限制理解成"日志更长的当选"，实际先比最后一条日志的任期，再比长度
- 以为 Leader 的读一定是最新的，网络分区时旧 Leader 可能读到旧值
