---
difficulty: 2
tags: [高频, 原理, 对比]
---

# select、poll、epoll 有什么区别？

::: tip 一句话回答
三者都是 **I/O 多路复用**：一个线程同时等待多个 fd，哪个就绪就处理哪个。**select** 用位图传 fd，最多只能监视编号小于 1024 的 fd，每次调用都要把整个集合**拷进内核再线性扫描**；**poll** 改用数组，去掉了数量限制，但拷贝和扫描的问题还在；**epoll** 把要监听的 fd **注册一次**保存在内核里（红黑树），fd 就绪时由回调放进**就绪链表**，`epoll_wait` 只返回就绪的 fd，连接再多开销也主要取决于活跃连接数。epoll 支持**水平触发**和**边缘触发**，Nginx、Redis、Node.js 的 libuv 在 Linux 上都基于它。
:::

## 详细解析

### 五种 I/O 模型

一次读操作分两步：等数据就绪、把数据从内核拷到用户空间。

| 模型 | 等待数据 | 拷贝数据 |
| --- | --- | --- |
| 阻塞 I/O | 线程阻塞 | 线程阻塞 |
| 非阻塞 I/O | 立即返回 EAGAIN，要不断轮询 | 阻塞 |
| I/O 多路复用 | 阻塞在 select/poll/epoll 上，一次等多个 fd | 阻塞 |
| 信号驱动 I/O | 不阻塞，就绪时收到 SIGIO | 阻塞 |
| 异步 I/O | 不阻塞 | 不阻塞，内核完成后通知（POSIX AIO、io_uring） |

前四种都算同步 I/O，因为拷贝数据那一步要线程自己等。Node.js 怎么用多路复用，见 [Node.js 是单线程的吗](/basics/node/02-io-model)。

### select 和 poll

- **select**：每次调用把 fd 位图拷进内核，内核逐个检查 0 到 nfds-1 的 fd，把结果原地写回位图再拷回来，用户再遍历一遍找出就绪的 fd，下次调用前要重新设置位图。位图大小由 `FD_SETSIZE`（1024）决定，只能监视编号小于 1024 的 fd，man page 明确建议新程序改用 poll 或 epoll
- **poll**：传的是 `pollfd` 结构数组，没有数量上限，输入（`events`）和输出（`revents`）分开，不用每次重置
- 两者共同的问题：每次调用都要把全部 fd 传进内核、内核和用户都要线性扫描。连接数是一万、活跃的只有几十个时，大部分工作都浪费了

### epoll

三个系统调用：`epoll_create1()` 创建一个 epoll 实例；`epoll_ctl()` 增删改要监听的 fd（interest list），只在变化时调用；`epoll_wait()` 阻塞等待，返回就绪的事件（ready list）。

```text
epoll 实例（内核中）
  ├─ 监听集合：红黑树，按 fd 查找，增删改 O(log n)
  └─ 就绪链表：fd 就绪时，挂在它等待队列上的回调把它加进来
网卡收到数据 ─> 协议栈把数据放进 socket ─> 唤醒等待队列 ─> 回调把该 fd 放入就绪链表
epoll_wait 只需检查就绪链表，把就绪事件拷给用户
```

| | select | poll | epoll |
| --- | --- | --- | --- |
| fd 数量 | 编号小于 1024 | 无固定上限 | 无固定上限，受文件描述符上限约束 |
| 每次调用传入 | 全部 fd | 全部 fd | 不用传，已注册在内核 |
| 内核找就绪 fd | 线性扫描 | 线性扫描 | 回调加入就绪链表 |
| 返回 | 全部，用户自己找 | 全部，用户自己找 | 只返回就绪的 |
| 跨平台 | 几乎所有系统 | 类 Unix | 仅 Linux（BSD/macOS 是 kqueue） |

### 水平触发和边缘触发

- **水平触发（LT，默认）**：只要 fd 上还有数据没读完，每次 `epoll_wait` 都会报告它。可以一次只读一部分，编程简单，select/poll 也是这种语义
- **边缘触发（ET，`EPOLLET`）**：只在状态变化时（比如新数据到达）通知一次。必须把 fd 设为**非阻塞**，循环读到返回 `EAGAIN` 为止，否则剩下的数据不会再触发通知，连接就"卡住"了

ET 减少了重复通知，但写错的代价大。Nginx 和 Go 的网络轮询器用 ET，Redis 和 libuv 用 LT。多线程共享一个 epoll 时，还可以用 `EPOLLONESHOT` 保证一个 fd 同一时刻只被一个线程处理。

## 代码示例

用 Go 的 `syscall` 包直接调用 epoll，写一个水平触发的回显服务（仅限 Linux，只为演示调用流程。实际开发直接用 `net` 包，它的网络轮询器内部也基于 epoll，用的是边缘触发）：

```go
//go:build linux

package main

import (
	"log"
	"syscall"
)

func check(err error) {
	if err != nil {
		log.Fatal(err)
	}
}

func main() {
	lfd, err := syscall.Socket(syscall.AF_INET, syscall.SOCK_STREAM|syscall.SOCK_NONBLOCK, 0)
	check(err)
	check(syscall.Bind(lfd, &syscall.SockaddrInet4{Port: 9000}))
	check(syscall.Listen(lfd, 128))
	epfd, err := syscall.EpollCreate1(0)
	check(err)
	watch := func(fd int) error { // 注册一次，之后常驻内核
		return syscall.EpollCtl(epfd, syscall.EPOLL_CTL_ADD, fd, &syscall.EpollEvent{Events: syscall.EPOLLIN, Fd: int32(fd)})
	}
	check(watch(lfd)) // 监听 socket 可读 = 有新连接
	events := make([]syscall.EpollEvent, 128)
	buf := make([]byte, 4096)
	for {
		n, err := syscall.EpollWait(epfd, events, -1) // 阻塞，只返回就绪的 fd
		if err == syscall.EINTR {
			continue
		}
		check(err)
		for i := 0; i < n; i++ {
			fd := int(events[i].Fd)
			if fd == lfd {
				if cfd, _, err := syscall.Accept4(lfd, syscall.SOCK_NONBLOCK); err == nil {
					watch(cfd)
				}
				continue
			}
			m, err := syscall.Read(fd, buf)
			if err == syscall.EAGAIN || err == syscall.EINTR {
				continue // 暂时没数据或被信号打断，水平触发下次还会通知
			}
			if err != nil || m == 0 { // 先判断 err；m == 0 表示对端关闭
				syscall.Close(fd) // fd 没被 dup 或 fork 共享时，关闭后自动从 epoll 中移除
				continue
			}
			syscall.Write(fd, buf[:m]) // 简化：没有处理写不完的情况
		}
	}
}
```

## 面试官可能追问

::: details epoll 是用 mmap 共享内存来避免拷贝的吗？
不是，这是流传很广的误解。`epoll_wait` 返回时，内核是把就绪事件拷到用户传入的数组里的。epoll 快在两点：fd 注册一次后常驻内核，不用每次传全部 fd；就绪的 fd 由回调直接放进就绪链表，不用扫描全部连接，只拷贝就绪的那部分。
:::

::: details epoll 一定比 select 快吗？
不一定。连接数很少、或者绝大多数连接都很活跃时，select/poll 的扫描代价并不大，epoll 还要额外调用 `epoll_ctl` 维护注册集合。epoll 的优势在"连接多、活跃的少"的场景，这正是大量长连接的服务端的典型情况。
:::

::: details epoll 能用来监听普通文件吗？
不能。普通文件和目录不支持 epoll，`epoll_ctl` 会返回 EPERM；select/poll 则总是把普通文件报告为就绪，因为读磁盘文件在它们看来不会"等待"。这也是 libuv 把文件操作放进线程池、Linux 上后来出现 io_uring 的原因之一。
:::

## 易错点

- 多路复用本身是同步 I/O，数据从内核拷到用户空间时线程仍然要等，不要和异步 I/O 混为一谈
- select 的 1024 限制的是 fd 的编号，不只是数量：进程里已打开了很多文件时，新 fd 编号超过 1023 也无法用 select 监视
- ET 模式下不读到 EAGAIN 就去等下一次事件，会导致连接卡死；ET 必须搭配非阻塞 fd
