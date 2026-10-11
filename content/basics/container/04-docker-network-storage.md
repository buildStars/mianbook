---
difficulty: 2
tags: [高频, 实践]
---

# Docker 的网络模式和数据持久化是怎样的？

::: tip 一句话回答
网络常用四种：**bridge**（默认，容器在宿主机的虚拟网桥上有自己的 IP，对外靠端口映射）、**host**（直接用宿主机的网络栈）、**none**（没有网络）、**自定义 bridge 网络**（同一网络里的容器可以**用容器名互相访问**，生产中最常用）。容器里的 `localhost` 指容器自己，不是宿主机。容器的可写层随容器删除而消失，要持久化的数据放 **volume**（Docker 管理，推荐）或 **bind mount**（挂载宿主机目录），临时数据可以放 **tmpfs**（只在内存里）。
:::

## 详细解析

### 网络模式

| 模式 | 用法 | 特点 |
| --- | --- | --- |
| 默认 bridge | 不指定网络时使用 | 每个容器有独立的网络栈和 IP，通过 NAT 访问外网；容器之间只能用 IP 访问，**没有容器名解析** |
| 自定义 bridge | `docker network create app-net` | 同一网络内的容器通过内置 DNS 用容器名互访，网络之间隔离 |
| host | `--network host` | 没有网络隔离，容器直接监听宿主机端口，没有 NAT 开销；端口映射无效 |
| none | `--network none` | 只有回环网卡，适合完全不需要网络的任务 |

跨主机通信还有 overlay（Swarm）等驱动，Kubernetes 场景下由 CNI 插件负责，不用 Docker 的网络。

### 端口映射和 localhost

`-p 8080:3000` 把宿主机的 8080 端口转发到容器的 3000 端口，格式是"宿主机端口:容器端口"。两个常见的坑：

- **容器里的服务要监听 `0.0.0.0`**：只监听 `127.0.0.1` 时，端口映射过来的流量进不来，通常表现为宿主机访问时连接被重置或收到空响应
- **容器里的 `localhost` 是容器自己**：应用容器连 `localhost:3306` 找不到另一个容器里的 MySQL。要用对方的容器名或服务名；要访问宿主机上的服务，Docker Desktop 提供了 `host.docker.internal`，Linux 上要加 `--add-host=host.docker.internal:host-gateway`

另外，`-p 3306:3306` 默认绑定宿主机的所有网卡，数据库这类服务只给本机用时写成 `-p 127.0.0.1:3306:3306`。在 Linux 上 Docker 用 iptables 规则转发发布的端口，数据包在到达 ufw 使用的 INPUT 链之前就被转走了，ufw 的规则对它不起作用，不能指望这类防火墙兜底。

### 三种挂载

| | volume | bind mount | tmpfs |
| --- | --- | --- | --- |
| 数据在哪 | Docker 管理的目录，用名字引用 | 宿主机上任意指定的路径 | 宿主机内存 |
| 生命周期 | 独立于容器，删除容器不会删除 | 宿主机上的文件一直在 | 容器停止就消失 |
| 典型用途 | 数据库数据、需要持久化的应用数据 | 开发时挂载源码、挂载配置文件 | 临时文件、不想落盘的敏感数据 |
| 注意 | 备份要通过容器或 `docker volume` 相关命令操作 | 依赖宿主机目录结构，权限和 UID 容易出问题 | 占用内存，要限制大小 |

数据库容器一定要把数据目录挂到 volume 上，否则 `docker rm` 后数据就没了。空的命名 volume 第一次挂载到容器里已有内容的目录时，默认会先把镜像里该目录的内容复制进 volume（`volume-nocopy` 选项可以关闭）；非空的 volume 和 bind mount 则会直接遮住容器里的原目录。

## 代码示例

用 `docker compose` 编排应用和数据库，服务之间用服务名通信：

```yaml
# compose.yaml
services:
  app:
    build: .
    ports:
      - "8080:3000"             # 宿主机 8080 → 容器 3000
    environment:
      DB_HOST: db               # 用服务名访问，不是 localhost
      DB_PORT: "3306"
    depends_on:
      db:
        condition: service_healthy   # 等数据库健康检查通过再启动
    networks: [backend]

  db:
    image: mysql:lts            # 生产环境应固定具体版本
    environment:
      MYSQL_ROOT_PASSWORD_FILE: /run/secrets/db_root_password
      MYSQL_DATABASE: app
    secrets: [db_root_password]
    volumes:
      - db-data:/var/lib/mysql  # 命名 volume 持久化数据
    healthcheck:
      # ping 只判断服务是否在运行，即使返回 Access denied 退出码也是 0，所以不用传密码
      # 用 TCP 地址：镜像初始化时启动的临时服务不监听网络，避免过早被判为健康
      test: ["CMD", "mysqladmin", "ping", "-h", "127.0.0.1"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s         # 首次初始化较慢，这段时间内的失败不计数
    networks: [backend]         # 不映射端口，只有同一网络的服务能访问

volumes:
  db-data:

networks:
  backend:

secrets:
  db_root_password:
    file: ./secrets/db_root_password.txt
```

```bash
docker compose up -d
docker compose exec app getent hosts db   # 在 app 容器里解析 db，能拿到 db 的 IP
docker compose down                        # 删除容器和网络，命名 volume 保留
docker compose down -v                     # 连同 volume 一起删除，数据会丢
```

## 面试官可能追问

::: details 不写 networks，compose 里的服务能互相访问吗？
可以。compose 会为项目自动创建一个默认网络，所有服务都加入它，并能用服务名互相解析。显式声明多个网络是为了隔离，比如前端代理只加入 frontend 网络，数据库只加入 backend 网络，代理就访问不到数据库。
:::

::: details depends_on 能保证依赖的服务已经可用吗？
只写服务名时，只保证启动顺序，不保证对方已经能接受连接。要配合依赖服务的 `healthcheck` 和 `condition: service_healthy`。即便如此，应用自己也要有连接重试，因为运行过程中依赖也可能重启。
:::

::: details host 模式性能更好，为什么不都用 host？
host 模式省掉了 NAT 和虚拟网卡的开销，但失去了网络隔离：端口会和宿主机及其他容器冲突，同一个服务不能在一台机器上跑多个副本，容器还能访问宿主机上只监听本地的服务。只有对网络性能特别敏感的场景才考虑。
:::

## 易错点

- 在容器里用 `localhost` 连另一个容器的服务
- 服务只监听 `127.0.0.1`，端口映射后宿主机访问不到
- 用默认 bridge 网络，期望能用容器名互相访问
- 数据库不挂 volume，或者随手执行 `docker compose down -v` 把数据删掉
