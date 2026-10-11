---
difficulty: 2
tags: [高频, 原理, 性能优化]
---

# 零拷贝是什么？sendfile 和 mmap 是怎么减少拷贝的？

::: tip 一句话回答
零拷贝指的是**减少或消除 CPU 在内核和用户空间之间搬数据**。把文件发到网络，传统的 `read` + `write` 要 **4 次拷贝**（2 次 DMA、2 次 CPU）和 **4 次上下文切换**。**mmap + write** 让用户空间直接映射 page cache，省掉 1 次 CPU 拷贝；**sendfile** 让数据在内核里从 page cache 直接到 socket，只要 1 次系统调用，切换降到 2 次；网卡支持 **SG-DMA** 时，CPU 拷贝可以完全省掉。Kafka 给消费者发数据、Nginx 发静态文件都用了 sendfile。它的前提是**数据不需要在用户态加工**，要压缩、加密或改内容就用不了。
:::

## 详细解析

### 传统的 read + write

```text
          用户态                     内核态                         硬件
read() ──切换①──────────────>  page cache  <──── DMA 拷贝 ①──── 磁盘
       <─切换②── CPU 拷贝 ② ──  page cache
用户缓冲区 buf
write() ─切换③── CPU 拷贝 ③ ──> socket 缓冲区
       <─切换④──────────────── socket 缓冲区 ──── DMA 拷贝 ④ ───> 网卡
```

- 2 次系统调用，每次进出内核各一次，共 4 次上下文切换（用户态和内核态之间的切换）
- 4 次拷贝：磁盘到 page cache、网卡发送由 **DMA** 完成，不占 CPU；page cache 到用户缓冲区、用户缓冲区到 socket 缓冲区由 CPU 完成
- 数据在用户态只是"路过"，什么都没做，两次 CPU 拷贝和多余的切换都是浪费

DMA（直接内存访问）是让外设和内存直接传数据的硬件机制，CPU 只负责发起和接收完成通知，搬运期间可以做别的事。

### mmap + write

`mmap` 把文件映射进进程的地址空间，用户态访问这段内存就是访问 page cache 本身：

```text
mmap()  ：只建立映射；访问映射区触发缺页时，磁盘 ──DMA──> page cache（与用户空间共享，不再拷给用户）
write() ：page cache ──CPU 拷贝──> socket 缓冲区 ──DMA──> 网卡
合计：3 次拷贝（1 次 CPU），4 次上下文切换
```

适合需要在用户态读取或修改文件内容、又不想多拷一份的场景，比如 RocketMQ 用 mmap 读写 CommitLog、Kafka 用 mmap 访问索引文件。代价是映射本身有开销，缺页时会阻塞线程；文件被其他进程截断时，访问映射区会收到 SIGBUS。

### sendfile

```text
sendfile(out_fd, in_fd, offset, count)    一次系统调用，2 次上下文切换
  磁盘 ──DMA──> page cache ──CPU 拷贝──> socket 缓冲区 ──DMA──> 网卡   3 次拷贝

网卡支持 SG-DMA（分散/聚集）时：
  磁盘 ──DMA──> page cache ──────────────────────────SG-DMA──> 网卡   2 次拷贝
                    └─ 只把位置和长度等描述信息放进 socket 缓冲区
```

SG-DMA 能从多个不连续的内存位置直接收集数据发出去，所以 page cache 里的数据不用先拷进 socket 缓冲区，全程没有 CPU 拷贝，这才是严格意义上的"零拷贝"。

`in_fd` 必须支持类似 mmap 的操作（通常是普通文件），不能是 socket；Linux 2.6.33 之前 `out_fd` 必须是 socket，之后可以是任意文件。要在两个 socket 之间转发数据，可以用 `splice` 借助管道完成。

| 方式 | 系统调用 | 上下文切换 | CPU 拷贝 | DMA 拷贝 |
| --- | --- | --- | --- | --- |
| read + write | 2 | 4 | 2 | 2 |
| mmap + write | 2 | 4 | 1 | 2 |
| sendfile | 1 | 2 | 1 | 2 |
| sendfile + SG-DMA | 1 | 2 | 0 | 2 |

### 应用和限制

- **Kafka**：消费者拉取消息时，Broker 用 Java 的 `FileChannel.transferTo` 把日志段文件发给 socket，在 Linux 上底层就是 sendfile；开启 SSL 后数据要在用户态加密，官方文档明确说这时不使用 sendfile
- **Nginx**：`sendfile on;` 让静态文件直接从 page cache 发出去，常和 `tcp_nopush on;` 一起用，把响应头和文件开头凑成满包发送
- **Go**：`io.Copy` 从 `*os.File` 拷到 TCP 或 Unix 连接时，在 Linux 上会自动尝试 sendfile，条件不满足时退回普通的读写

用不了的情况：数据要压缩（gzip）、要加密（HTTPS，除非启用内核 TLS 让内核完成加密）、要修改内容或做模板渲染。另外超大文件只读一次时，会把 page cache 里的热数据挤出去，这种场景可以考虑直接 I/O（`O_DIRECT`）绕过 page cache。

## 代码示例

Go 的静态文件发送，满足条件时底层走 sendfile：

```go
package main

import (
	"io"
	"log"
	"net"
	"os"
)

func main() {
	ln, err := net.Listen("tcp", ":9000")
	if err != nil {
		log.Fatal(err)
	}
	for {
		conn, err := ln.Accept()
		if err != nil {
			continue
		}
		go func(c net.Conn) {
			defer c.Close()
			f, err := os.Open("/var/data/big.bin")
			if err != nil {
				return
			}
			defer f.Close()
			// 源是 *os.File、目标是 TCP 连接，标准库在 Linux 上用 sendfile 完成拷贝
			io.Copy(c, f)
		}(conn)
	}
}
```

用 `strace -f -e trace=sendfile,read,write` 跟踪这个进程，能看到发送文件时出现的是 sendfile 而不是成对的 read、write。

## 面试官可能追问

::: details 零拷贝是完全没有拷贝吗？
不是。磁盘到内存、内存到网卡的 DMA 拷贝始终存在，零拷贝消除的是 CPU 参与的拷贝。只有 sendfile 配合支持 SG-DMA 的网卡时，CPU 拷贝才为 0；没有 SG-DMA 时 sendfile 仍有一次内核内部的 CPU 拷贝，但已经省掉了用户态的往返和两次切换。
:::

::: details mmap 和 sendfile 怎么选？
只是把文件原样发出去，选 sendfile，调用少、拷贝少。需要在用户态读、改文件内容，或者要随机访问大文件，选 mmap，它省掉的是 read 那一次拷贝，还能把文件当内存数组用。mmap 的缺点是缺页时会阻塞线程、映射和解除映射本身有开销，小文件不一定比 read 快。
:::

::: details 零拷贝和 page cache 是什么关系？
sendfile 和 mmap 都依赖 page cache：数据先由 DMA 读进 page cache，再从这里发出去。热点文件常驻 page cache 时，连磁盘读都省了，这也是 Kafka 依赖操作系统缓存而不是自己做缓存的原因之一。反过来，page cache 被大量冷数据占满时，零拷贝的效果也会打折扣。
:::

## 易错点

- mmap + write 只省掉一次 CPU 拷贝，上下文切换仍是 4 次，不要和 sendfile 混为一谈
- sendfile 的源不能是 socket，不能用它做 socket 到 socket 的代理转发，那是 splice 的场景
- 用了 HTTPS 或 gzip，Nginx 的 sendfile 对这部分响应就不起作用了（内核 TLS 除外），不要指望开了 sendfile 就一定有效
