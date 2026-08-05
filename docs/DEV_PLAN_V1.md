# V1 开发计划：角色卡体系 + 非对称关系图

> 日期：2026-08-05
> 状态：**待评审**
> 范围：2 个智能体（A/B）场景
> 需求依据：[REQUIREMENTS_CHARACTER_SYSTEM.md](./REQUIREMENTS_CHARACTER_SYSTEM.md)
> 调研依据：[RESEARCH_CHARACTER_SYSTEM.md](./RESEARCH_CHARACTER_SYSTEM.md)

---

## 改动总览

分 4 个阶段递进，每个阶段可独立验证、独立提交。

| 阶段 | 内容 | 前置依赖 | 涉及文件数 |
|---|---|---|---|
| 1 | 结构化角色卡（description + personality） | 无 | 7 |
| 2 | 他人描述注入 + 非对称关系图 | 阶段 1 | 6 |
| 3 | 全局提示词（scenario + globalPrompt）+ 世界观模板 | 无（可与 1/2 并行） | 8 |
| 4 | 关系图管理页（Vue Flow 可视化） | 阶段 2 | 6 |

---

## 阶段 1：结构化角色卡

**目标**：把单一 `persona` 升级为 `description + personality`，向后兼容旧数据。

### 后端

#### 1.1 `server/src/types/index.ts`

`AgentRef`（:74-80）：新增可选字段

```ts
export interface AgentRef {
  id: AgentId
  name: string
  persona: string        // 保留，向后兼容
  description?: string   // 新增：综合身份描述
  personality?: string   // 新增：性格关键词
  color?: AgentColor
}
```

`AgentInput`（:205-210）：同步新增 `description?: string`、`personality?: string`。

#### 1.2 `server/src/store/sessionStore.ts`

`createSession`（:69-74）的 `refs.map`：透传新字段

```ts
const refs: AgentRef[] = inputs.map((a, i) => ({
  id: agentIdAt(i),
  name: a.name?.trim() || `智能体 ${agentIdAt(i)}`,
  persona: a.persona?.trim() || '',
  description: a.description?.trim() || undefined,
  personality: a.personality?.trim() || undefined,
  color: a.color || DEFAULT_AGENT_COLORS[i % DEFAULT_AGENT_COLORS.length],
}))
```

`normalizeLegacySession`（:150-166）：旧数据无新字段时自然为 undefined，无需特殊处理。

#### 1.3 `server/src/routes/sessions.ts`

POST schema（:52-59）的 `items.properties`：加两个可选 string

```js
properties: {
  name: { type: 'string', minLength: 1 },
  persona: { type: 'string' },
  description: { type: 'string' },   // 新增
  personality: { type: 'string' },   // 新增
  color: { type: 'string' },
}
```

### 前端

#### 1.4 `web/src/services/storage.ts`

`AgentFormValues`（:13-21）：新增字段

```ts
export interface AgentFormValues {
  name: string
  persona: string
  description: string    // 新增
  personality: string    // 新增
  color: AgentColor
  provider: string
  templateId: string
}
```

`defaultValues()` / `makeAgent()`：补 `description: ''`、`personality: ''`。

`normalizeValues()`（:201-255）：补字段归一化（`str(anyInput.description, '')`）。

#### 1.5 `web/src/stores/form.ts`

`selectTemplate`（:44-50）：填入 description/personality

```ts
function selectTemplate(idx: number, templateId: string, name: string, persona: string, description?: string, personality?: string) {
  const a = values.agents[idx]
  if (!a) return
  a.templateId = templateId
  a.name = name
  a.persona = persona
  a.description = description ?? ''
  a.personality = personality ?? ''
}
```

`payload` computed（:116-147）：agents 映射加 description/personality。

#### 1.6 `web/src/services/templates.ts`

`AgentTemplate`（:14-19）：新增字段

```ts
export interface AgentTemplate {
  id: string
  name: string
  persona: string        // 保留兼容
  description: string    // 新增
  personality: string    // 新增
  createdAt: number
}
```

`addAgentTemplate` / `updateAgentTemplate`：处理新字段。

#### 1.7 `web/src/components/AgentForm.vue` + `SettingsModal.vue`

- **AgentForm**：模板选择时填入 description/personality（`pick` 函数扩展）
- **SettingsModal**：智能体模板编辑区，persona 输入框改为「角色描述（description）」+「性格关键词（personality）」两个输入框

### 验证

1. 创建带 description 的角色，`curl /api/sessions/:id` 确认字段持久化
2. 旧会话（只有 persona）正常加载，不报错
3. 前端模板编辑和选择正常工作

---

## 阶段 2：他人描述注入 + 非对称关系图

**目标**：让 A 知道 B 是谁（完整描述），并支持非对称关系注入。

### 后端

#### 2.1 `server/src/types/index.ts`

`Session`（:173-191）：新增 relationships

```ts
export interface Session {
  // ... 现有字段 ...
  relationships?: Record<string, string>
  // Key: "{fromId}->{toId}"，值: from 视角对 to 的关系描述
}
```

`CreateSessionInput`（:213-218）：同步新增 `relationships?: Record<string, string>`。

#### 2.2 `server/src/ai/prompts.ts`（核心改动）

`buildAgentSystem`（:21-41）参数升级：

```ts
interface AgentSystemParams {
  name: string
  description?: string      // 新增（替代 persona 的主描述）
  personality?: string      // 新增
  persona?: string          // 保留兼容
  others: AgentRef[]        // 改：从 otherNames: string[] 升级为完整角色信息
  relationships?: string[]  // 新增：当前 agent 对所有他人的关系描述
  topic: string
  scenario?: string         // 阶段 3 加
  globalPrompt?: string     // 阶段 3 加
}
```

prompt 结构升级为分层注入：

```
─── 主角设定 ───
你是「{name}」。{description || persona}
性格：{personality}

─── 在场角色 ───
{other.name}：{other.description || other.persona}

─── 我与{other.name}的关系 ───
{relationships["A->B"]}

─── 对话设定 ───
话题：{topic}
你的对话对象：{other.name}
轮流发言规则...
```

#### 2.3 `server/src/memory/context.ts`

`AgentMemory`（:26-108）：

- 新增字段 `relationships: Record<string, string>`
- 构造函数 / `toJSON` / `fromJSON`：处理 relationships

`buildApiMessages`（:62-76）：

```ts
buildApiMessages(): ApiMessage[] {
  const sys = buildAgentSystem({
    name: this.agent.name,
    description: this.agent.description,
    personality: this.agent.personality,
    persona: this.agent.persona,
    others: this.others,                          // ← 完整角色信息，不再只取 name
    relationships: this.extractMyRelationships(), // ← 注入关系
    topic: this.topic,
  })
  // ... 后续不变
}
```

新增 `extractMyRelationships()` 方法：从 relationships 中取 `"${this.agent.id}->X"` 的条目。

#### 2.4 `server/src/store/sessionStore.ts`

`createSession`（:81-84）：创建 AgentMemory 时传入 session 级 relationships。

#### 2.5 `server/src/routes/sessions.ts`

POST schema 顶层 properties 加 `relationships`（可选 object）。

#### 2.6 `server/src/ws/chatHandler.ts`

memory 还原（:152-156）：把 `session.relationships` 传给 AgentMemory.fromJSON。

### 前端

#### 2.7 `web/src/types/api.ts`

`CreateSessionPayload`（:182-186）：加 `relationships?: Record<string, string>`。

#### 2.8 `web/src/stores/form.ts`

- FormValues 加 `relationships: Record<string, string>`
- payload computed：输出 relationships

#### 2.9 `web/src/services/storage.ts`

FormValues 接口 + normalizeValues 补 relationships（默认 `{}`）。

### 验证

1. 配置关系（A→B / B→A），开始对话
2. 检查后端日志：A 的 system prompt 含 B 的描述 + A→B 关系
3. 检查 B 的 system prompt 含 A 的描述 + B→A 关系
4. 确认两个视角的描述不同（非对称）

---

## 阶段 3：全局提示词 + 世界观模板

**目标**：新增 scenario / globalPrompt 字段 + 可复用的世界观模板。

### 后端

#### 3.1 `server/src/types/index.ts`

`SessionConfig`（:124-148）：新增字段

```ts
export interface SessionConfig {
  // ... 现有字段 ...
  scenario?: string       // 新增：场景设定
  globalPrompt?: string   // 新增：导演指令
}
```

#### 3.2 `server/src/ai/prompts.ts`

`buildAgentSystem` 新增「全局设定」段落（放在主角设定之前）：

```
─── 全局设定 ───
[场景设定]
{scenario}

[导演指令]
{globalPrompt}
```

#### 3.3 `server/src/routes/sessions.ts`

POST schema config.properties（:62-80，有 `additionalProperties: false`）：加 `scenario` 和 `globalPrompt`（可选 string）。

### 前端

#### 3.4 `web/src/services/templates.ts`

新增世界观模板（照抄话题模板模式）：

```ts
const WORLDVIEW_TPL_KEY = 'duet:worldview-templates:v1'

export interface WorldviewTemplate {
  id: string
  name: string              // 模板名（如「校园日常」「赛博朋克」）
  scenario: string          // 场景设定
  globalPrompt?: string     // 导演指令（可选）
  createdAt: number
}

export function loadWorldviewTemplates(): WorldviewTemplate[]
export function addWorldviewTemplate(name: string, scenario: string, globalPrompt?: string): WorldviewTemplate[]
export function removeWorldviewTemplate(id: string): WorldviewTemplate[]
```

#### 3.5 `web/src/stores/template.ts`

新增 `worldviews` ref + `addWorldview/removeWorldview/findWorldview` actions。

`refresh()` 同步刷新 worldviews。

#### 3.6 `web/src/services/storage.ts`

FormValues 加：

```ts
scenario: string
globalPrompt: string
worldviewTemplateId: string
```

defaultValues / normalizeValues 补字段。

#### 3.7 `web/src/stores/form.ts`

- 新增 `selectWorldview(templateId, scenario, globalPrompt)` / `clearWorldview()`（照抄 selectTopic 模式）
- payload 的 config 输出 scenario / globalPrompt

#### 3.8 `web/src/components/SettingsModal.vue`

- Tab 类型加 `'worldview'`，tabs 数组加 `{ key: 'worldview', label: '世界观模板' }`
- 新增 tab UI（照抄话题模板 tab）：name 输入框 + scenario 文本框 + globalPrompt 文本框

#### 3.9 `web/src/components/WorldviewPicker.vue`（新建）

照抄 TopicPicker.vue，从世界观模板列表选用，填入 scenario + globalPrompt。

#### 3.10 `web/src/components/NewChatModal.vue`

在 TopicPicker 下方插入 `<WorldviewPicker @open-settings="emit('open-settings')" />`。

### 验证

1. 配置 scenario + globalPrompt，确认注入 system prompt
2. 世界观模板增删改查正常
3. 从模板选用后，scenario / globalPrompt 自动填入

---

## 阶段 4：关系图管理页（Vue Flow）

**目标**：独立的可视化关系图编辑页面，入口在会话详情页。

### 新增依赖

#### 4.1 安装 Vue Flow

```bash
pnpm --filter @duet/web add @vue-flow/core
```

### 新增文件

#### 4.2 `web/src/components/RelationshipEditor.vue`

Vue Flow 可视化关系图编辑器：

- 画布渲染所有智能体节点（自定义节点显示 name + description 摘要）
- 节点可拖动定位（XY 坐标持久化到 session）
- 从节点边缘拖拽创建连线 → 建立双向关系
- 点击连线打开弹窗编辑关系
- 隐藏箭头（双向关系语义）

#### 4.3 `web/src/components/RelationshipEdgeDialog.vue`

关系编辑弹窗：

- 两个文本框：A 视角对 B 的关系、B 视角对 A 的关系
- 保存到 `session.relationships["A->B"]` 和 `["B->A"]`
- 支持删除关系（移除连线）

### 改动文件

#### 4.4 `web/src/views/SessionView.vue` 或 `web/src/components/SessionInspector.vue`

新增「关系图」入口按钮，点击打开 RelationshipEditor（弹窗或抽屉）。

#### 4.5 `web/src/stores/session.ts`

新增 `updateRelationships(relationships)` action，调用后端 API 更新。

#### 4.6 后端：`server/src/routes/sessions.ts`

新增 `PATCH /api/sessions/:id/relationships` 路由：

```ts
// 更新会话的关系数据（对话进行中也可修改）
fastify.patch('/api/sessions/:id/relationships', async (req, reply) => {
  const session = loadSession(req.params.id)
  if (!session) return reply.code(404).send({ error: 'not found' })
  session.relationships = req.body.relationships
  // 同步更新所有 AgentMemory 的 relationships
  for (const a of session.agents) {
    if (session.memory[a.id]) {
      session.memory[a.id].relationships = req.body.relationships
    }
  }
  saveSession(session)
  return session
})
```

### 验证

1. 打开关系图管理页 → 看到两个角色节点
2. 拖拽连线 → 创建关系
3. 点击连线 → 弹窗编辑两个视角的关系描述
4. 保存 → 确认写入 session.json
5. 开始对话 → 验证关系在 prompt 中生效
6. 对话进行中修改关系 → 下一轮 prompt 更新

---

## 不在 V1 范围内

| 功能 | 归属 | 备注 |
|---|---|---|
| 导演 Agent（预处理 + 运行时干预） | V2 | 含 TTL 临时指令 |
| N 人关系矩阵 | V2 | 当前锁定 2 人场景 |
| 关系描述动态变化 | V2 | V1 关系固定，变化交给摘要 |
| 对话示例（mesExample） | V3 | 深度角色卡 |
| SillyTavern 角色卡导入/导出 | V3 | 格式兼容 |
| 自定义开场白（firstMes） | 不做 | Duet 由话题驱动开场 |

---

## 风险与对策

| 风险 | 对策 |
|---|---|
| system prompt 变长（他人描述 + 关系） | 2 人场景 token 可控；他人描述全量注入 |
| 缓存命中率下降 | system 分层固化顺序，前缀只增不变 |
| 新旧数据混合 | `description \|\| persona` 回退策略 |
| Vue Flow 学习成本 | 文档完善，自定义节点/边有成熟示例 |
| 对话中修改关系的实时性 | PATCH 后同步更新所有 AgentMemory，下一轮生效 |
