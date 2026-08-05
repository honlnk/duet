# 调研报告：从「辩论工具」进化为「纯 AI 对话酒馆」

> 日期：2026-08-03
> 状态：**调研完成，待评审**
> 范围：角色卡体系 + 全局提示词 + 多角色互相感知
> 参考来源：SillyTavern V2/V3 角色卡规范、世界书/Author's Note、群聊机制

---

## 一、问题诊断：当前架构的三个致命缺陷

### 缺陷 1：智能体之间互不感知（最严重）

当前 A 发言时，A 的 system prompt 里只有：

```
你的对话对象（其他参与者）：B、C
```

**只有名字，没有 persona**。

虽然 `AgentMemory.others: AgentRef[]` 在内存中持有对方完整的 persona，但在所有 prompt 拼装处（`buildAgentSystem`、`wrapOtherMessage`、`buildSummaryPrompt`）都只取了 `o.name`，persona 被完全丢弃。

**后果**：A 不知道 B 的性别、年龄、性格、身份立场。一男一女对话时，A 可能猜错 B 的性别。原本作为辩论工具时「不知道对方是谁」问题不大，但要做成对话酒馆，这是致命的。

```
当前数据流（persona 被浪费）：
  AgentMemory.others: AgentRef[]    ← 持有完整 persona ✅
    ↓ buildApiMessages()
  otherNames = others.map(o => o.name)  ← 只取名字 ❌ persona 丢弃
    ↓ buildAgentSystem({ otherNames })
  system prompt 里只有名字 ❌
```

### 缺陷 2：角色设定过于简陋

当前智能体只有 3 个字段：

```ts
interface AgentRef {
  id: AgentId
  name: string
  persona: string   // 所有设定塞在一个自由文本字段里
  color?: AgentColor
}
```

没有结构化的外观/性别/性格/背景/开场白/对话示例等字段，无法支撑有深度的角色扮演。

### 缺陷 3：话题（topic）定位不清晰

当前 topic 有双重身份：
- 作为「对话引子」触发第一句对话（`buildOpeningPrompt`，一次性，压缩后消失）
- 作为 system prompt 的固定一行（`buildAgentSystem` 里，每次动态重建，**不会丢失**）

但缺少一个独立于角色和话题的「全局提示词 / 场景设定 / 世界观」层——类似酒馆的 Author's Note 或 Group Scenario。

---

## 二、SillyTavern 核心机制调研

### 2.1 角色卡（Character Card）V2/V3 规范

#### 核心字段（按对我们的价值排序）

| 字段 | 类型 | 注入行为 | 对我们的价值 |
|---|---|---|---|
| `name` | string | 永久 | ★ 已有 |
| `description` | string | **永久** | ★★ 综合身份描述（背景/外貌/核心设定），替代当前的单薄 persona |
| `personality` | string | **永久** | ★★ 性格关键词摘要，与 description 分离 |
| `scenario` | string | **永久** | ★ 对话发生的情境/场景 |
| `first_mes` | string | 一次性 | ★★ 开场白——**风格锚点**，AI 会强烈模仿其语气和格式 |
| `mes_example` | string | 可裁剪 | ★★★ 对话示例——教模型「角色怎么说话」，性价比最高的字段 |
| `alternate_greetings` | string[] | 一次性 | ★ 多个开场分支供选择 |
| `system_prompt` | string | 永久 | ★ 允许单个角色覆盖全局 system prompt |
| `post_history_instructions` | string | 永久（置底） | ★ 放在对话历史之后的指令（UJB），影响力最大 |
| `character_book` | object | 动态 | ★ 角色专属世界书（按关键词激活的设定库） |
| `creator_notes` | string | **不注入** | 仅给人类看 |
| `tags` | string[] | **不注入** | 组织/筛选用 |
| `nickname` | string | 永久 | V3 新增，真名/代号解耦 |

**关键区分：description vs personality**
- `description` = 「这个人是谁」（背景、外貌、世界观、身份——大段综合描述）
- `personality` = 「这个人的性格特质」（精简关键词——如「冷静、理性、偶尔毒舌」）

两者分离的意义：prompt 工程上可以分别控制注入位置和 token 预算。

**first_mes 的隐藏价值**：不只是开场白，它是**整场对话的风格锚点**。AI 会模仿 first_mes 的语气、长度、格式（是否用星号表动作、是否用引号表台词）。写好 first_mes = 给对话定调。

**mes_example 的核心价值**：用 `<START>` 分隔多个对话示例块，直接教模型角色的说话方式。这是让 AI 准确把握角色定位性价比最高的手段。

### 2.2 世界书 / World Info / Lorebook

**本质**：动态字典引擎。监听对话关键词，命中后注入对应设定。

**激活策略**：
- 🟢 Selective：关键词命中才激活
- 🔵 **Constant**：无需关键词，**永远激活**——这是对抗上下文压缩的核心手段
- 🔗 Vectorized：基于语义相似度激活

**关键洞察**：Constant 类型的世界书条目和 Author's Note **每次生成都重新注入**，它们不属于会被压缩的滚动历史——这是保证全局信息存活的根本机制。

### 2.3 Author's Note（全局提示词）

可按频率注入 prompt 的文本，用于：
- 格式规则强化
- 指令强化
- 临时状态（如「[场景：夜晚的咖啡馆]」）

**位置**：可注入到对话历史指定深度（Depth 0 = 最末尾，影响最大）。

### 2.4 群聊（Group Chat）—— 多角色互相感知

SillyTavern 群聊有两种角色卡处理模式：

| 模式 | 行为 | 优缺点 |
|---|---|---|
| **Swap（默认）** | 生成时只包含当前发言者的角色卡 | 其他角色互相看不见 description——**和我们当前的缺陷一样** |
| **Join** | 把所有成员的角色卡融合进一个 prompt | 简单粗暴，但可能导致人格混淆 |

**关键结论**：即使是 SillyTavern 也没有完美解决多角色互相感知的问题。Swap 模式下角色互不感知，Join 模式下容易人格混淆。**这是我们可以做出差异化优势的地方。**

### 2.5 上下文压缩与信息保护

SillyTavern 的核心教训：**不要把关键信息放进会被压缩的滚动历史里**。

保护机制：
1. 永久层信息（system prompt、角色卡 description/personality/scenario、Constant 世界书、Author's Note）每次生成时**重新拼装**，天然抗压缩
2. 滚动层信息（对话历史、mes_example）会被压缩/裁剪
3. 摘要层：被压缩历史的摘要

---

## 三、当前架构 vs 目标架构差距分析

### 3.1 好消息：基础设施已就位

当前架构有几个设计良好的基础，升级不需要推倒重来：

| 维度 | 现状 | 评价 |
|---|---|---|
| system prompt 动态重建 | `buildApiMessages()` 每次调用都重新拼装 system | ✅ **完美**——新增字段只需改拼装逻辑，无需改持久化 |
| persona/topic 抗压缩 | 在 system 1 里，不在 messages 数组里 | ✅ **永不丢失** |
| 第一人称摘要机制 | 第一人称视角，回注为 system 2 | ✅ 设计良好 |
| 独立记忆物理隔离 | 每个智能体独立的 AgentMemory | ✅ 身份不串 |
| others 数据已持有 | `AgentMemory.others: AgentRef[]` 含完整 persona | ✅ **数据已在，只是没用** |

### 3.2 需要补齐的差距

| # | 差距 | 当前 | 目标 | 改动范围 |
|---|---|---|---|---|
| 1 | **对方 persona 注入** | 只取 name | 注入完整描述 | `buildAgentSystem` 改参数 + 拼装 |
| 2 | **角色字段结构化** | 单一 persona 文本 | description + personality + 更多 | 类型定义 + 前端表单 + 模板 |
| 3 | **全局提示词层** | 无 | 独立的全局指令 / 场景设定 | SessionConfig 加字段 + prompt 拼装 |
| 4 | **开场白（first_mes）** | 硬编码模板 | 每个角色可自定义开场白 | Agent 加字段 + 调度逻辑 |
| 5 | **对话示例（mes_example）** | 无 | 角色可附带对话示例 | Agent 加字段 + prompt 注入 |

---

## 四、推荐方案设计

### 4.1 总体设计理念

借鉴 SillyTavern 的分层注入模型，但针对「多 AI 自主对话」场景做改良：

```
┌─────────────────────────────────────────────────┐
│ 永久层（每次生成重新拼装，抗压缩）                │
│                                                   │
│  ┌─ system 1: 全局设定 ──────────────────────┐   │
│  │  场景/世界观（scenario，会话级共享）        │   │
│  │  全局导演指令（globalPrompt，可选）        │   │
│  └─────────────────────────────────────────┘   │
│  ┌─ system 2: 我的角色卡 ────────────────────┐   │
│  │  你是「{name}」                             │   │
│  │  {description}（身份背景）                  │   │
│  │  性格：{personality}                        │   │
│  │  {mes_example}（对话示例，教模型怎么说话）  │   │
│  └─────────────────────────────────────────┘   │
│  ┌─ system 3: 其他参与者 ────────────────────┐   │
│  │  B：{B.description 的精简版}                │   │  ← 核心新增
│  │  C：{C.description 的精简版}                │   │
│  │  （让 A 知道 B/C 是谁）                     │   │
│  └─────────────────────────────────────────┘   │
│  ┌─ system 4: 对话规则 ──────────────────────┐   │
│  │  轮流发言、字数控制、避免复读...            │   │
│  └─────────────────────────────────────────┘   │
│  ┌─ system 5: 摘要（若有）──────────────────┐   │
│  │  [对话进展摘要（你的视角）]                 │   │
│  └─────────────────────────────────────────┘   │
│                                                   │
├─────────────────────────────────────────────────┤
│ 滚动层（会被压缩/裁剪）                           │
│                                                   │
│  [user] [开场提示 or B的发言]                     │
│  [assistant] A的发言                              │
│  [user] B的发言                                   │
│  ...                                              │
└─────────────────────────────────────────────────┘
```

**核心改进**：新增 system 3「其他参与者」，让每个角色都知道其他人是谁。

### 4.2 改良的多角色感知方案（优于 SillyTavern）

SillyTavern 的 Join 模式会把所有角色卡全量融合，容易导致人格混淆。我们采用更可控的方案：

**发言者拿完整卡 + 其他人拿精简卡**：

```
当 A 发言时，A 的 system prompt：
  system 2: A 的完整角色卡（description + personality + mes_example）
  system 3: B 和 C 的精简描述（仅 description 的核心部分，不含 mes_example）
```

**精简规则**：
- 自己的卡：description + personality + mes_example（全量，教模型怎么扮演这个角色）
- 他人的卡：仅 description 的核心摘要（让模型知道对方是谁，不会混淆身份）
- 他人卡的精简可以在创建时预生成（如限制 200 字），避免每次发言时动态摘要增加延迟

**为什么这样设计**：
- mes_example 只给自己用——教模型「我该怎么说话」，而不是教模型「别人怎么说话」（那会造成干扰）
- 他人的 description 精简版——足够让 A 知道「B 是女性，性格温柔，是咖啡馆老板」，但不会太长导致 token 浪费

### 4.3 角色字段升级方案

#### 4.3.1 最小可行方案（推荐第一期）

保留 `persona` 字段作为向后兼容，新增结构化字段：

```ts
interface AgentRef {
  id: AgentId
  name: string

  // 向后兼容：旧数据只有 persona，新数据优先用 description + personality
  persona: string

  // 新增结构化字段（可选）
  description?: string    // 综合身份描述（背景/外貌/核心设定）
  personality?: string    // 性格关键词摘要
  scenario?: string       // 角色个人场景（可选）
  firstMes?: string       // 自定义开场白（可选，替代硬编码模板）
  mesExample?: string     // 对话示例（可选）

  color?: AgentColor
}
```

**向后兼容策略**：
- `persona` 字段保留不删——旧数据正常工作
- 新的 prompt 构造逻辑：`description || persona`（有 description 用 description，没有就回退到 persona）
- 前端表单：persona 输入框改为「角色描述（description）」，老数据自动迁移

#### 4.3.2 完整方案（第二期，可选）

如果需要更深入的角色卡支持：

```ts
interface CharacterCard {
  name: string
  nickname?: string           // 代号/真名
  description: string         // 综合描述
  personality: string         // 性格关键词
  scenario?: string           // 个人场景
  firstMes?: string           // 开场白
  mesExample?: string         // 对话示例
  alternateGreetings?: string[] // 多开场分支
  tags?: string[]             // 标签
  // 自定义扩展
  appearance?: string         // 外观描述
  background?: string         // 背景故事
  relationships?: Record<string, string> // 对其他角色的认知
}
```

### 4.4 全局提示词方案

#### 4.4.1 会话级全局提示词

在 `SessionConfig` 新增可选字段：

```ts
interface SessionConfig {
  // ... 现有字段 ...

  // 新增
  scenario?: string       // 场景设定（如「深夜的咖啡馆，窗外下着雨」）
  globalPrompt?: string   // 全局导演指令（如「本场对话基调为悬疑，角色之间暗藏秘密」）
}
```

**与 topic 的关系**：
- `topic` = 对话主题/引子（「讨论是否应该立法禁止 AI 生成未标注内容」）
- `scenario` = 场景/世界观（「赛博朋克 2077 年的立法听证会」）
- `globalPrompt` = 导演指令（「对话应逐步升级为激烈争论」）

三者独立，均可选。`topic` 仍是必填（作为对话触发点），`scenario` 和 `globalPrompt` 是增强。

#### 4.4.2 prompt 注入顺序

```
system 1（全局层）:
  [场景设定]
  {scenario}

  [全局指令]
  {globalPrompt}

system 2（角色层）:
  你是「{name}」。{description || persona}
  性格：{personality}
  {mesExample}

system 3（参与者层）:           ← 核心新增
  其他参与者：
  - {B.name}：{B.description 的精简版}
  - {C.name}：{C.description 的精简版}

system 4（规则层）:
  对话规则...

system 5（摘要层，若有）:
  [对话进展摘要（你的视角）]
  {summary}

--- 以下为滚动历史 ---
user: [开场提示 or 对方发言]
assistant: 我的发言
...
```

### 4.5 话题（topic）角色重新定义

升级后各文本字段的职责清晰分离：

| 字段 | 层级 | 职责 | 抗压缩 |
|---|---|---|---|
| `topic` | 会话级 | 对话主题/引子（「讨论 XX 话题」） | ✅ system 1 动态重建 |
| `scenario` | 会话级 | 场景/世界观（「赛博朋克听证会」） | ✅ system 1 动态重建 |
| `globalPrompt` | 会话级 | 导演指令（「逐步升级为争论」） | ✅ system 1 动态重建 |
| `description` | 角色级 | 角色综合描述 | ✅ system 2 动态重建 |
| `personality` | 角色级 | 性格关键词 | ✅ system 2 动态重建 |
| `firstMes` | 角色级 | 开场白（风格锚点） | ❌ 一次性注入 |
| `mesExample` | 角色级 | 对话示例（教说话方式） | ⚠️ 可裁剪 |
| `summary` | 记忆级 | 第一人称摘要 | ✅ system 5 动态重建 |

---

## 五、实施路径建议

### 第一期：核心感知（解决致命缺陷）

**目标**：让角色互相感知 + 基础结构化角色卡

**改动文件**：

1. **`server/src/types/index.ts`** — AgentRef 新增 `description?`、`personality?` 字段（persona 保留兼容）
2. **`server/src/ai/prompts.ts`** — `buildAgentSystem` 接收完整 `others: AgentRef[]`，拼装对方精简描述
3. **`server/src/memory/context.ts`** — `buildApiMessages` 传完整 others 给 buildAgentSystem（数据已在，只需不再降级为 name）
4. **`web/src/services/storage.ts`** + **`web/src/stores/form.ts`** — 表单加 description/personality 输入
5. **`web/src/components/AgentForm.vue`** — 角色编辑 UI 扩展
6. **`web/src/services/templates.ts`** — AgentTemplate 同步加字段

**预估工作量**：小～中。核心改动在 prompts.ts（拼装逻辑），其余是类型 + 表单。

### 第二期：全局提示词 + 开场白

**目标**：场景设定 + 全局指令 + 自定义开场白

**改动**：

1. **SessionConfig** 新增 `scenario?`、`globalPrompt?`
2. **prompts.ts** — buildAgentSystem 新增 system 1（全局层）
3. **前端表单** — 高级设置加 scenario / globalPrompt 输入
4. **AgentRef** 新增 `firstMes?`，chatHandler 在首个发言者开场时用 `firstMes` 替代硬编码 `buildOpeningPrompt`

### 第三期（可选）：深度角色卡

- `mesExample` 对话示例
- `alternateGreetings` 多开场分支
- `relationships` 结构化关系
- 角色卡导入/导出（JSON 格式兼容 SillyTavern V2/V3）

---

## 六、关键技术决策点（待确认）

### 决策 1：对方描述的精简策略

让 A 看到 B 的描述时，B 的描述应该多详细？

| 选项 | 优点 | 缺点 |
|---|---|---|
| **A. 全量 description** | 信息完整 | 10 个角色时 token 爆炸 |
| **B. 预生成精简版** | token 可控 | 需要额外字段存储精简版 |
| **C. 字数截断** | 简单 | 可能截断在关键信息处 |

**推荐**：B（预生成精简版）。在角色模板/会话创建时，让用户填写时控制篇幅（如建议 200 字以内），或后端自动截取。

### 决策 2：persona 向后兼容

旧的 `persona` 字段如何处理？

| 选项 | 优点 | 缺点 |
|---|---|---|
| **A. 保留 persona，新增 description** | 完全兼容 | 两个字段语义重叠，用户困惑 |
| **B. persona 重命名为 description** | 语义清晰 | 破坏旧数据 |
| **C. persona 作为 description 的别名** | 兼容 + 清晰 | 实现稍复杂 |

**推荐**：A 或 C。prompt 构造时 `description || persona`（有新的用新的，没有回退到旧的）。

### 决策 3：开场白机制

第一个发言者（A）的开场怎么处理？

| 选项 | 行为 |
|---|---|
| **A. 保持现状** | 硬编码模板「请就话题 XX 开始对话」 |
| **B. A 的 firstMes** | 如果 A 有自定义 firstMes，直接作为 A 的第一条发言（而非 user 提示） |
| **C. 混合** | 有 firstMes 就用，没有就回退到模板 |

**推荐**：C。注意 firstMes 模式下不需要额外的 user 开场提示，A 直接「说出」firstMes 内容。

### 决策 4：摘要是否需要升级

当前摘要只记录话题和立场。升级后是否需要在摘要里也记录角色关系？

**推荐**：暂不改。摘要的 system 2 补充 + system 3（参与者层）每次动态重建已经足够。摘要只负责「对话进展」，不负责「角色认知」。

---

## 七、风险与对策

| 风险 | 对策 |
|---|---|
| system prompt 变长导致 token 增加 | 对方描述精简（200 字以内）；10 角色时考虑仅注入「有互动的角色」 |
| 缓存命中率下降（system 前缀变化） | system 分层固化顺序，前缀只增不变； persona/description 确定后不变 |
| 新旧数据混合（有的有 description 有的只有 persona） | `description || persona` 回退策略；加载旧会话时自动兼容 |
| 前端表单变复杂 | 分期实施：第一期只加 description + personality 两个字段 |
| 角色卡格式与 SillyTavern 不兼容 | 第三期再做导入/导出转换器 |

---

## 八、总结

当前架构的「地基」很扎实（system 动态重建、独立记忆、第一人称摘要），升级不需要推倒重来。核心改进是：

1. **补上对方感知**（改 `buildAgentSystem` 注入对方描述——数据已在 `others` 里，几行改动）
2. **结构化角色卡**（description + personality 替代单薄 persona）
3. **加全局提示词层**（scenario + globalPrompt 作为 system 1）

这三点完成后，项目就从「辩论工具」进化为「纯 AI 对话酒馆」。

SillyTavern 的群聊也没完美解决角色互相感知（Swap 模式互不可见，Join 模式人格混淆），我们的「发言者全量卡 + 他人精简卡」方案可以做出差异化优势。

---

## 附录：权威参考来源

- [Character Card V2 Specification](https://github.com/malfoyslastname/character-card-spec-v2/blob/main/spec_v2.md)
- [Character Card V3 Specification](https://github.com/kwaroran/character-card-spec-v3/blob/main/SPEC_V3.md)
- [SillyTavern 官方文档 - Character Design](https://docs.sillytavern.app/usage/core-concepts/characterdesign/)
- [SillyTavern 官方文档 - World Info](https://docs.sillytavern.app/usage/core-concepts/worldinfo/)
- [SillyTavern 官方文档 - Author's Note](https://docs.sillytavern.app/usage/core-concepts/authors-note/)
- [SillyTavern 官方文档 - Group Chats](https://docs.sillytavern.app/usage/core-concepts/groupchats/)
- [SillyTavern 官方文档 - Prompt Manager](https://docs.sillytavern.app/usage/prompts/prompt-manager/)
