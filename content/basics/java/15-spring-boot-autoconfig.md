---
difficulty: 2
tags: [高频, 原理]
---

# Spring Boot 自动配置的原理是什么？

::: tip 一句话回答
`@SpringBootApplication` 里的 **@EnableAutoConfiguration** 通过 `AutoConfigurationImportSelector` 加载自动配置类：它读取 classpath 上所有 jar 中的 `META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports` 文件，拿到候选的自动配置类（Spring Boot 2.7 引入这个文件，3.0 起不再支持在 `spring.factories` 里注册自动配置）。每个自动配置类都带着**条件注解**，比如 `@ConditionalOnClass`（classpath 上有某个类）、`@ConditionalOnMissingBean`（用户没定义同类 Bean），条件满足才注册 Bean。这个选择器是**延迟执行**的，在用户的配置处理完之后才运行，所以 `@ConditionalOnMissingBean` 能看到用户定义的 Bean，用户自己定义了同类 Bean，自动配置就会让位。
:::

## 详细解析

### @SpringBootApplication 拆开看

```text
@SpringBootApplication
├── @SpringBootConfiguration    本质是 @Configuration
├── @ComponentScan              扫描启动类所在的包及其子包
└── @EnableAutoConfiguration
    ├── @AutoConfigurationPackage    记下启动类所在的包，JPA 实体、Spring Data 仓库等默认从这里扫描
    └── @Import(AutoConfigurationImportSelector.class)
```

所以启动类一般放在项目的根包下，组件扫描和自动配置包才能覆盖到所有代码。

### 自动配置类是怎么加载的

1. Spring 解析配置类时遇到 `@Import(AutoConfigurationImportSelector.class)`。它是一个 **DeferredImportSelector**，要等所有常规配置类（包括组件扫描到的类）处理完才执行
2. 从 classpath 上所有 jar 中读取 `AutoConfiguration.imports` 文件，每行一个类名，汇总成候选列表
3. 去重，再去掉 `@SpringBootApplication(exclude = ...)`、`excludeName` 和配置项 `spring.autoconfigure.exclude` 排除的类
4. 用编译期生成的 `META-INF/spring-autoconfigure-metadata.properties` 做一轮快速过滤：里面预先记录了各个类的部分条件（比如依赖哪些类），不满足的直接剔除，不必加载这些类，启动更快
5. 剩下的类按 `@AutoConfiguration` 的 before/after 属性、`@AutoConfigureOrder` 排序，作为普通配置类解析；类上和 `@Bean` 方法上的条件注解逐个求值，满足才注册 Bean

注册方式在几个版本间有变化：

| 版本 | 自动配置类的注册方式 |
| --- | --- |
| 2.6 及以前 | `META-INF/spring.factories` 中 `org.springframework.boot.autoconfigure.EnableAutoConfiguration` 这个 key 下的类名列表 |
| 2.7 | 新增 `AutoConfiguration.imports` 文件和 `@AutoConfiguration` 注解；`spring.factories` 的写法仍然兼容，但已废弃 |
| 3.0 起 | 只认 imports 文件，写在 `spring.factories` 里的自动配置不再生效；文件里其他 key 下的扩展点不受影响 |

Spring Boot 4 把自动配置按技术拆成了多个模块，不少类的包名变了，比如 `DataSourceAutoConfiguration` 从 `org.springframework.boot.autoconfigure.jdbc` 移到了 `org.springframework.boot.jdbc.autoconfigure`；imports 文件加条件注解的机制没有变。

### 条件注解

| 注解 | 满足条件 | 典型用法 |
| --- | --- | --- |
| `@ConditionalOnClass` / `@ConditionalOnMissingClass` | classpath 上有 / 没有某个类 | 引入了某个库才配置它 |
| `@ConditionalOnBean` / `@ConditionalOnMissingBean` | 容器里已有 / 没有某类 Bean | 用户没定义 DataSource 才创建默认的 |
| `@ConditionalOnProperty` | 配置项存在且不为 false；可以用 `havingValue` 指定值，`matchIfMissing` 决定没配时是否满足 | 功能开关 |
| `@ConditionalOnResource` | 存在某个资源文件 | 有配置文件才启用 |
| `@ConditionalOnWebApplication` / `@ConditionalOnNotWebApplication` | 是 / 不是 Web 应用 | 只在 Web 环境注册过滤器 |
| `@ConditionalOnExpression` | SpEL 表达式为 true | 复杂的组合判断 |

两点细节：

- `@ConditionalOnClass` 写在类上时，可以直接引用 classpath 上不存在的类，因为 Spring 用 ASM 读取注解的元数据，不会真正加载这个类。写在 `@Bean` 方法上就不一定安全了，官方建议放进嵌套的 `@Configuration` 类里
- `@ConditionalOnBean` / `@ConditionalOnMissingBean` 只能看到**到目前为止**已经注册的 Bean 定义，结果依赖处理顺序，官方建议只在自动配置类里使用。自动配置类在用户配置之后才处理，才能保证"用户定义了就不再创建"

### starter 和配置属性

- **starter** 本身基本是一个空 jar，只负责把依赖带进来。比如 Spring Boot 3 的 `spring-boot-starter-web` 带来 Spring MVC、内嵌 Tomcat、Jackson，对应的自动配置类就会因为条件满足而生效
- 自定义 starter 一般分两个模块：`acme-spring-boot`（autoconfigure 模块，放自动配置类和配置属性类，对库的依赖标记为 optional）和 `acme-spring-boot-starter`（只声明依赖）；功能简单时可以合成一个。官方要求第三方模块名不要以 `spring-boot` 开头
- **配置属性**用 `@ConfigurationProperties("前缀")` 绑定到一个类上，支持宽松绑定（`first-name`、`firstName`、`first_name` 都能绑定到 firstName 字段，配置文件里推荐用短横线写法）；只有一个带参构造器的类和 record 会自动用构造器绑定，需要通过 `@EnableConfigurationProperties` 或 `@ConfigurationPropertiesScan` 注册。加上 `spring-boot-configuration-processor` 会在编译期生成元数据文件，IDE 里写配置时就有提示

## 代码示例：自定义 starter

```java
package com.acme.autoconfigure;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

@ConfigurationProperties("acme.client")
public record AcmeProperties(String endpoint, @DefaultValue("3s") Duration timeout) {
}
```

```java
package com.acme.autoconfigure;

import com.acme.sdk.AcmeClient; // 要接入的第三方 SDK 里的类，假设构造参数是地址和超时
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;

@AutoConfiguration
@ConditionalOnClass(AcmeClient.class) // 引入了 SDK 才生效
@ConditionalOnProperty(prefix = "acme.client", name = "enabled", matchIfMissing = true) // 配 enabled=false 可以关掉
@EnableConfigurationProperties(AcmeProperties.class)
public class AcmeClientAutoConfiguration {

    @Bean
    @ConditionalOnMissingBean // 用户自己定义了 AcmeClient，就不再创建
    public AcmeClient acmeClient(AcmeProperties properties) {
        return new AcmeClient(properties.endpoint(), properties.timeout());
    }
}
```

```text
# src/main/resources/META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports
com.acme.autoconfigure.AcmeClientAutoConfiguration
```

使用方引入 starter 后，在 `application.yml` 里写 `acme.client.endpoint` 和 `acme.client.timeout`（如 `5s`）就能直接注入 `AcmeClient`。

## 面试官可能追问

::: details 自动配置不符合预期，怎么查哪些生效了、哪些没生效？
启动时加 `--debug` 参数（或配置 `debug=true`），控制台会打印条件评估报告，分为 Positive matches（生效的自动配置及原因）、Negative matches（没生效的及哪个条件不满足）、Exclusions（被排除的）等几部分。引入 Actuator 后也可以访问 `/actuator/conditions` 端点看同样的信息，不过默认只通过 HTTP 暴露 health，要用 `management.endpoints.web.exposure.include` 打开。
:::

::: details 自动配置类为什么不能被 @ComponentScan 扫到？
官方要求自动配置类只能通过 imports 文件加载，要放在独立的包里，永远不要成为组件扫描的目标。被扫描到后，它就成了普通配置类，在组件扫描阶段就被解析，`@ConditionalOnMissingBean` 判断时用户的 Bean 可能还没注册；before/after 只用于自动配置之间的排序，管不到这种提前解析的类。`@SpringBootApplication` 里的 `@ComponentScan` 带了 `AutoConfigurationExcludeFilter`，会跳过标了 `@AutoConfiguration` 或登记在 imports 文件里的类，但自己另写的 `@ComponentScan` 没有这层保护。
:::

::: details spring.factories 在 Spring Boot 3 里还有用吗？
有。3.0 移除的只是用它注册自动配置的功能，`ApplicationListener`、`EnvironmentPostProcessor`、`FailureAnalyzer` 等扩展点仍然通过 `META-INF/spring.factories` 注册。读取它的是 Spring 框架的 `SpringFactoriesLoader`，思路和 Java 的 SPI 类似：按接口名找到实现类列表，再实例化。
:::

## 易错点

- Spring Boot 3 起只写在 `spring.factories` 里的自动配置不会再被加载，要改用 imports 文件，升级老的第三方 starter 时常踩这个坑
- `@ConditionalOnMissingBean` 写在普通的 `@Configuration` 类里，结果取决于 Bean 定义的处理顺序，时灵时不灵
- starter 只是一组依赖，真正的逻辑在自动配置类里；自定义模块不要以 `spring-boot` 开头命名
- 升级到 Spring Boot 4 后，按全限定名排除自动配置（`excludeName`、`spring.autoconfigure.exclude`）要注意包名已经变了
