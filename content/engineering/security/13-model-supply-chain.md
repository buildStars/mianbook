---
difficulty: 2
tags: [安全, 原理]
---

# 模型文件和依赖有哪些供应链风险？

::: tip 一句话回答
下载一个开源模型，不只是下载一堆权重。很多模型文件用 Python 的 **pickle** 序列化，而 pickle 在**加载时就能执行任意代码**；有的模型要求开启 **trust_remote_code**，会执行模型仓库里的 Python 代码；模型仓库还可能被仿冒、被篡改。防御：优先用只存张量的 **safetensors** 格式，加载 PyTorch 文件时开启 **weights_only**，不随意开 trust_remote_code，**锁定模型版本并校验哈希**，在隔离的环境里加载和转换来路不明的模型。
:::

## 详细解析

### pickle 为什么危险

pickle 不是单纯的数据格式，它保存的是"怎么重建这个对象"的指令。对象可以通过 `__reduce__` 声明"重建我时调用某个函数、传入这些参数"，反序列化时这个函数就会被调用。也就是说，**加载文件这一步本身就会执行文件作者指定的代码**，不需要你调用模型里的任何方法。

PyTorch 的 `.pt`、`.pth`、`.bin` 文件，以及 joblib、部分旧格式的模型文件，底层都用到 pickle。Python 官方文档也明确提醒：不要反序列化不可信来源的 pickle 数据。

### 几种常见风险

| 风险 | 说明 |
| --- | --- |
| 恶意序列化文件 | 权重文件里夹带代码，加载时执行，可以窃取凭证、植入后门 |
| 远程代码 | 开启 trust_remote_code 后，框架会下载并执行模型仓库里的模型定义代码 |
| 仓库仿冒 | 名字和知名模型只差一两个字符，或冒充官方组织 |
| 版本被替换 | 只写模型名不锁版本，仓库更新后拉到的是另一份文件 |
| 模型本身被投毒 | 文件格式安全，但权重被植入后门，特定触发词下输出异常，见 [数据投毒](/engineering/security/09-data-poisoning) |
| 依赖包 | 推理框架、分词器、转换工具等 Python 包的供应链风险，和 [前端依赖的供应链安全](/basics/web-security/05-supply-chain) 是同一类问题 |

前几类是"加载就中招"的代码执行问题，格式和流程能解决；模型被投毒属于行为问题，换成 safetensors 也挡不住，要靠来源可信和上线前的评测。

### safetensors 解决了什么

safetensors 只存一个 JSON 头（张量名、形状、类型、偏移）加上原始的张量字节，加载时只做解析和内存映射，**没有执行代码的机制**。所以它解决的是"加载即执行"的问题。GGUF 等推理格式也是纯数据格式。注意它不解决权重本身被投毒的问题。

### 防御做法

1. **格式**：优先下载 safetensors；必须加载 PyTorch 格式时用 `torch.load(path, weights_only=True)`，它只允许反序列化张量和少量基础类型
2. **远程代码**：不随意开启 `trust_remote_code`；确实需要时先审查代码，并锁定到审查过的提交
3. **锁版本**：下载时指定具体的提交哈希（例如 Hugging Face 的 `revision` 参数），记录文件的 SHA-256，部署时校验
4. **内部镜像**：把审查过的模型放进内部制品库，生产环境只从这里拉，不直连公网仓库
5. **隔离加载**：第一次加载、格式转换放在没有凭证、没有内网权限、限制出网的容器里，见 [沙箱](/engineering/security/06-sandbox)
6. **扫描和评测**：用模型扫描工具检查序列化文件里是否引用了危险函数；上线前跑安全评测，观察是否有异常触发行为

## 代码示例

```python
import hashlib
import torch
from safetensors.torch import load_file

EXPECTED_SHA256 = "..."  # 审查通过时记录的哈希

def sha256_of(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()

def load_weights(path: str):
    if sha256_of(path) != EXPECTED_SHA256:
        raise ValueError("模型文件哈希不一致，拒绝加载")
    if path.endswith(".safetensors"):
        return load_file(path)  # 纯数据格式，不执行代码
    # ✅ 只允许张量等基础类型；❌ 不要在不可信文件上用 weights_only=False
    return torch.load(path, weights_only=True, map_location="cpu")
```

## 面试官可能追问

::: details weights_only=True 就绝对安全了吗？
它把可反序列化的类型限制在白名单内，挡住了最常见的"加载即执行"。但它依赖白名单实现没有漏洞，也不检查权重本身是否被投毒。所以仍要配合锁版本、校验哈希和隔离加载，能用 safetensors 就用 safetensors。
:::

::: details 只用知名组织发布的模型，还需要这些措施吗？
需要。账号可能被盗，仓库可能被更新，名字可能被仿冒。锁定提交哈希和校验文件哈希的成本很低，能保证你部署的就是当初审查的那一份。
:::

::: details 用模型 API 而不是自部署，有供应链风险吗？
不用加载文件，pickle 这类问题就不存在了，但风险转到了服务商和 SDK 上：SDK 依赖、API Key 管理、服务商对数据的处理方式。Key 的管理见 [API Key 怎么安全管理](/engineering/security/07-api-key)。
:::

## 易错点

- 以为"只是加载权重，不运行代码"就安全：pickle 在加载那一步就会执行代码
- 把 safetensors 当成万能：它防代码执行，不防权重被投毒
- 部署脚本里只写模型名，不锁提交版本，也不校验哈希
- 为了让模型跑起来顺手开启 trust_remote_code，却没审查仓库代码
