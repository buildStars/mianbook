---
difficulty: 2
tags: [高频, 原理, 对比]
---

# 容器和虚拟机有什么区别？Docker 的隔离靠的是什么？

::: tip 一句话回答
虚拟机靠 Hypervisor 虚拟出整套硬件，每台虚拟机运行**自己的内核**；容器只是宿主机上**一组被隔离的进程**，所有容器**共享宿主机内核**。Docker 的隔离靠 Linux 内核的三样能力：**Namespace** 决定进程"能看到什么"，**cgroups** 决定进程"能用多少资源"，**联合文件系统**把只读的镜像层叠起来作为容器的根文件系统。所以容器启动快、开销小，但隔离强度不如虚拟机。
:::

## 详细解析

### 架构对比

```text
虚拟机（从上到下）                容器（从上到下）
App A       | App B             App A       | App B
依赖库       | 依赖库             依赖库       | 依赖库
Guest 内核   | Guest 内核        容器运行时（如 Docker）
Hypervisor                      宿主机内核（所有容器共享）
物理硬件                         物理硬件
```

| | 虚拟机 | 容器 |
| --- | --- | --- |
| 隔离边界 | 硬件虚拟化，每台有独立内核 | 内核提供的进程级隔离，共享内核 |
| 启动速度 | 要引导整个操作系统，通常是分钟或数十秒级 | 本质是启动一个进程，通常是秒级甚至更快 |
| 资源开销 | 每台都要为操作系统预留内存和磁盘 | 几乎只有应用本身的开销，单机能跑更多实例 |
| 镜像大小 | 包含完整操作系统 | 只包含应用和依赖的用户态文件 |
| 能跑的系统 | 可以跑和宿主机不同的操作系统 | 只能跑和宿主机内核兼容的程序（Linux 容器要 Linux 内核） |

在 macOS 和 Windows 上用 Docker Desktop 运行 Linux 容器时，容器其实跑在一个轻量的 Linux 虚拟机里（Windows 上默认借助 WSL 2），原因就是 Linux 容器需要 Linux 内核。Windows 原生容器是另一回事，它共享的是 Windows 内核。

### Namespace：隔离"能看到什么"

每种 Namespace 隔离一类全局资源，进程只能看到自己所在 Namespace 里的那一份：

| Namespace | 隔离的内容 | 效果 |
| --- | --- | --- |
| PID | 进程号 | 容器里的主进程是 PID 1，看不到宿主机和其他容器的进程 |
| NET | 网卡、IP、路由表、端口 | 每个容器有自己的网络栈，可以各自监听 80 端口 |
| MNT | 挂载点 | 容器有自己的根文件系统和挂载视图 |
| UTS | 主机名和域名 | 容器可以有自己的 hostname |
| IPC | 信号量、消息队列、共享内存 | 容器之间不能用 System V IPC 互相通信 |
| USER | 用户和组 ID | 容器内的 root 可以映射成宿主机上的普通用户 |

另外还有 cgroup Namespace 和 time Namespace，面试提到前六个就够了。

### cgroups：限制"能用多少"

Namespace 只管看不见，不管用多少。一个容器死循环照样能吃满宿主机 CPU，这就要靠 cgroups（control groups）：把进程放进一个组，对这组进程限制 CPU 时间、内存上限、进程数、块设备 I/O 等。`docker run --memory`、`--cpus`、`--pids-limit` 最终都是写 cgroups 的配置。内存超过上限时，内核会在这个组里触发 OOM，杀掉进程。

### 联合文件系统：镜像分层

镜像由多个只读层组成，运行时在最上面加一个可写层，通过联合挂载（Docker 现在默认用 overlay2 存储驱动）合并成一个完整的根文件系统。多个容器可以共享同一份只读层，所以启动新容器不用复制整个镜像。分层和写时复制的细节见 [Docker 镜像是怎么分层的](/basics/container/02-image-layers)。

### 共享内核的安全含义

所有容器共享一个内核，内核或容器运行时有漏洞时，容器里的进程就有机会逃逸到宿主机。再加上常见的错误配置，比如 `--privileged`、挂载 `/var/run/docker.sock`、以 root 运行，隔离会更弱。因此：

- 单租户、可信的业务服务用普通容器足够，再加上非 root 运行、去掉多余 capabilities、seccomp 等加固
- 多租户或运行不可信代码时，要用 gVisor 这类加强隔离的运行时或 Firecracker 这类微虚拟机，见 [让 AI 执行代码时沙箱怎么做](/engineering/security/06-sandbox)

## 代码示例

在 Linux 宿主机上观察容器就是普通进程：

```bash
docker run -d --name web nginx

# 容器里看，nginx 的主进程是 PID 1
docker exec web cat /proc/1/cmdline; echo

# 宿主机上看，它只是一个普通进程，有自己的 PID
docker inspect -f '{{.State.Pid}}' web
ps -ef | grep "nginx: master"

# 对比 Namespace：容器进程的 net、pid 等指向和宿主机不同的 inode
sudo ls -l /proc/$(docker inspect -f '{{.State.Pid}}' web)/ns
```

## 面试官可能追问

::: details 容器里能看到宿主机的总内存，为什么？
`/proc/meminfo` 这类文件没有被 Namespace 隔离，容器里的 `free`、`top` 读到的是宿主机的数据，而 cgroups 的限制要从 cgroup 文件系统里读。这会让不感知容器的程序按宿主机的内存或核数来配置自己，比如线程池开太大、堆设太大。较新的 JVM 默认能识别容器的内存和 CPU 限制，较新的 Node.js 计算默认堆上限时也会参考 cgroup 的内存限制，但具体行为随版本变化，生产环境最好显式配置，见 [requests 和 limits 是什么](/basics/container/08-k8s-resources)。
:::

::: details 容器里的 root 和宿主机的 root 是同一个吗？
默认没有启用 user namespace 映射时，容器里的 UID 0 就是宿主机的 UID 0，只是被 Namespace、capabilities 和 seccomp 限制了能力。一旦逃逸，就是宿主机 root。所以生产镜像要用非 root 用户运行，有条件的话开启 rootless 模式或 user namespace 映射。
:::

::: details 既然容器这么轻，为什么云厂商的多租户服务还要用虚拟机？
因为不同客户之间不能只靠共享内核来隔离。常见做法是每个租户的容器跑在独立的虚拟机或微虚拟机里，既保留容器的交付方式，又有硬件虚拟化级别的隔离边界。
:::

## 易错点

- 说"容器是轻量级虚拟机"：容器没有自己的内核，本质是被隔离的进程
- 把隔离和限制混为一谈：Namespace 负责隔离可见性，cgroups 负责限制资源用量
- 认为容器默认很安全，随手用 `--privileged` 或挂载 Docker 的 socket
- 以为 Linux 容器能直接跑在 Windows 或 macOS 内核上，忽略了 Docker Desktop 背后的虚拟机
