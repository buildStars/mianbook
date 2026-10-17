---
difficulty: 2
tags: [实践, 场景题]
---

# 命令模式是什么？撤销和重做怎么实现？

::: tip 一句话回答
命令模式把一次"请求"封装成**对象**，对象里带着执行所需的参数和 `execute`、`undo` 方法。请求变成对象后，就可以**排队、记录、延迟执行、组合成宏命令，以及撤销**。编辑器的撤销重做常用两个栈实现：执行时压入撤销栈并清空重做栈；撤销时弹出、调用 `undo`、压入重做栈。另一种实现是**存快照**，简单但耗内存，适合状态小的场景。
:::

## 详细解析

### 结构

```text
调用者（按钮、快捷键、历史管理器）
   │ 只调用 command.execute()，不知道具体做什么
   ▼
命令对象 { execute(), undo(), 参数 }
   │
   ▼
接收者（编辑器、画布、数据模型）真正干活
```

调用者和接收者解耦：同一个"加粗"命令，可以由工具栏按钮、快捷键、菜单触发，它们都只需要拿到命令对象。

### 请求变成对象后能做什么

- **撤销重做**：命令记得自己做了什么，就能反向做一遍
- **命令队列**：排队执行、限流、离线时先存起来，联网后再发送
- **宏命令**：把多个命令组合成一个，执行时依次执行，撤销时倒序撤销
- **日志和回放**：记录命令序列，可以重放操作，协同编辑也常基于"操作"同步
- **快捷键映射**：键位到命令对象的映射表，方便用户自定义

### 撤销重做的两种实现

| 方式 | 做法 | 优点 | 缺点 |
| --- | --- | --- | --- |
| 命令栈 | 每个命令实现 `undo`，记录做之前的必要信息 | 内存小，粒度细 | 每个命令都要写正确的逆操作 |
| 快照 | 每次修改前保存整个状态的副本 | 实现简单，不会逆错 | 状态大时内存和复制开销大 |

命令栈的规则：

1. 执行新命令：`execute`，压入撤销栈，**清空重做栈**（产生了新分支，旧的"未来"作废）
2. 撤销：从撤销栈弹出，调用 `undo`，压入重做栈
3. 重做：从重做栈弹出，调用 `execute`，压回撤销栈

实际项目还会限制栈的长度，并把连续输入合并成一条命令，避免每敲一个字就是一步撤销。快照方式配合不可变数据（结构共享）可以大大降低复制成本，很多状态管理的"时间旅行"就是这样做的。

### 和策略模式的区别

两者都是"把行为封装成对象"，但目的不同。[策略模式](/basics/design-pattern/04-strategy) 关注"**怎么做**"：同一件事有多种算法，可以互相替换，用完不留痕迹。命令模式关注"**做了什么**"：把一次具体的操作连同参数封装起来，可以存下来、撤销、重放。策略通常无状态，命令通常带着这次操作的数据。

## 代码示例

```js
class Editor { constructor() { this.text = '' } }

const insert = (editor, str) => ({
  execute: () => { editor.text += str },
  undo: () => { editor.text = editor.text.slice(0, -str.length) },
})

// 宏命令：顺序执行，倒序撤销
const macro = (...cmds) => ({
  execute: () => cmds.forEach((c) => c.execute()),
  undo: () => [...cmds].reverse().forEach((c) => c.undo()),
})

class History {
  undoStack = []
  redoStack = []
  run(cmd) { cmd.execute(); this.undoStack.push(cmd); this.redoStack = [] }
  undo() {
    const cmd = this.undoStack.pop()
    if (cmd) { cmd.undo(); this.redoStack.push(cmd) }
  }
  redo() {
    const cmd = this.redoStack.pop()
    if (cmd) { cmd.execute(); this.undoStack.push(cmd) }
  }
}

const ed = new Editor()
const h = new History()
h.run(insert(ed, 'Hello'))
h.run(macro(insert(ed, ', '), insert(ed, 'World')))
console.log(ed.text) // Hello, World
h.undo(); console.log(ed.text) // Hello
h.redo(); console.log(ed.text) // Hello, World
h.undo(); h.run(insert(ed, '!'))
h.redo(); console.log(ed.text) // Hello!（重做栈已被清空）
```

## 面试官可能追问

::: details 删除操作的 undo 怎么写？
删除前要把被删的内容和位置保存在命令对象里，undo 时在原位置插回去。原则是：命令在 `execute` 时记录足够恢复现场的信息。这也是命令栈方式容易出错的地方，逆操作依赖的信息必须完整。
:::

::: details 多人协同编辑时，撤销还能用简单的命令栈吗？
不能直接用。别人的操作可能已经改变了文档，你的命令的位置信息会失效。协同场景一般只撤销自己的操作，并且要先把命令按其他人的修改做转换（OT）或基于 CRDT 生成逆操作，再执行。
:::

::: details 前端哪些地方用到了命令模式？
早期富文本编辑依赖的 `document.execCommand`（MDN 已标为废弃，新项目不要依赖）和各编辑器框架的 command 机制、画图工具的操作历史、VS Code 这类编辑器的命令面板（命令有 id，可以绑定快捷键）、Redux 的 action（描述"发生了什么"的对象，可以记录和回放）。
:::

## 易错点

- 执行新命令后忘了清空重做栈，导致重做出现错乱的状态
- 宏命令撤销时没有倒序，后执行的操作依赖先执行的结果，顺序反了就会出错
- 把策略和命令混为一谈：策略是可替换的算法，命令是一次带参数、可撤销的操作
