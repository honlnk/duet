"""导演 Agent 的工具表：对资产库（模板 + 关系）的增删改查。

对齐 TS agent/tools.ts：12 个工具，每个只调用 libraryStore 的内存函数；
schema 用 pydantic args_schema（bind_tools 时转各协议线格式），additionalProperties
禁掉（extra="forbid"）。写操作统一 upsert 语义（id 空 = 新建，非空 = 更新）。
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from ..store import library as lib


class _Args(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ListArgs(_Args):
    pass


class UpsertCharacterArgs(_Args):
    id: str | None = Field(default=None, description="目标模板 id；新建时不传")
    name: str = Field(description="角色名（如「小张」）")
    description: str = Field(default="", description="综合身份描述：背景/外貌/核心设定，一段中文")
    personality: str = Field(default="", description="性格关键词摘要")


class DeleteArgs(_Args):
    id: str = Field(description="要删除的模板 id")


class UpsertTopicArgs(_Args):
    id: str | None = Field(default=None, description="目标模板 id；新建时不传")
    content: str = Field(description="话题文本（如「讨论是否应该立法禁止 AI 生成未标注内容」）")


class UpsertWorldviewArgs(_Args):
    id: str | None = Field(default=None, description="目标模板 id；新建时不传")
    name: str = Field(description="模板名（如「校园日常」「赛博朋克」）")
    scenario: str = Field(default="", description="场景设定正文")


class SetRelationshipArgs(_Args):
    from_template_id: str = Field(description="视角方的角色模板 id")
    to_template_id: str = Field(description="被描述方的角色模板 id")
    description: str = Field(description="第一人称的关系描述（如「小美是我的同桌，学习很好」）")


class RelationshipKeyArgs(_Args):
    from_template_id: str = Field(description="视角方的角色模板 id")
    to_template_id: str = Field(description="被描述方的角色模板 id")


@dataclass(frozen=True)
class AgentToolDef:
    name: str
    is_write: bool
    description: str
    args_schema: type[BaseModel]
    run: Callable[[BaseModel], Awaitable[str]]
    summarize: Callable[[BaseModel], str]


def _assert_template_exists(id_: str, label: str) -> None:
    all_ = lib.list_character_templates()
    if not any(t["id"] == id_ for t in all_):
        hint = (
            "当前角色模板：" + "、".join(f"{t['name']}({t['id']})" for t in all_)
            if all_
            else "当前没有任何角色模板"
        )
        raise ValueError(f"{label} {id_} 不存在。{hint}")


async def _list_characters(_: ListArgs) -> str:
    items = lib.list_character_templates()
    if not items:
        return "当前没有任何角色模板。"
    lines = []
    for t in items:
        desc = t.get("description") or "（未填）"
        pers = t.get("personality") or "（未填）"
        lines.append(f"- [{t['id']}] {t['name']}｜身份：{desc}｜性格：{pers}")
    return f"共 {len(items)} 个角色模板：\n" + "\n".join(lines)


async def _upsert_character(a: UpsertCharacterArgs) -> str:
    t = lib.upsert_character_template(
        {
            "id": a.id or None,
            "name": a.name,
            "description": a.description,
            "personality": a.personality,
        }
    )
    action = "已更新" if a.id else "已创建"
    return f"{action}角色模板「{t['name']}」({t['id']})。"


async def _delete_character(a: DeleteArgs) -> str:
    ok = lib.delete_character_template(a.id)
    return f"已删除角色模板 {a.id}。" if ok else f"未找到 id 为 {a.id} 的角色模板。"


async def _list_topics(_: ListArgs) -> str:
    items = lib.list_topic_templates()
    if not items:
        return "当前没有任何话题模板。"
    lines = [f"- [{t['id']}] {t['content']}" for t in items]
    return f"共 {len(items)} 个话题模板：\n" + "\n".join(lines)


async def _upsert_topic(a: UpsertTopicArgs) -> str:
    t = lib.upsert_topic_template({"id": a.id or None, "content": a.content})
    return f"已更新话题模板 ({t['id']})。" if a.id else f"已创建话题模板 ({t['id']})。"


async def _delete_topic(a: DeleteArgs) -> str:
    ok = lib.delete_topic_template(a.id)
    return f"已删除话题模板 {a.id}。" if ok else f"未找到 id 为 {a.id} 的话题模板。"


async def _list_worldviews(_: ListArgs) -> str:
    items = lib.list_worldview_templates()
    if not items:
        return "当前没有任何世界观模板。"
    lines = [f"- [{t['id']}] {t['name']}｜{t.get('scenario') or '（未填场景）'}" for t in items]
    return f"共 {len(items)} 个世界观模板：\n" + "\n".join(lines)


async def _upsert_worldview(a: UpsertWorldviewArgs) -> str:
    t = lib.upsert_worldview_template(
        {"id": a.id or None, "name": a.name, "scenario": a.scenario}
    )
    return (
        f"已更新世界观模板「{t['name']}」({t['id']})。"
        if a.id
        else f"已创建世界观模板「{t['name']}」({t['id']})。"
    )


async def _delete_worldview(a: DeleteArgs) -> str:
    ok = lib.delete_worldview_template(a.id)
    return f"已删除世界观模板 {a.id}。" if ok else f"未找到 id 为 {a.id} 的世界观模板。"


async def _list_relationships(_: ListArgs) -> str:
    rels: dict[str, str] = lib.get_relationships()["relationships"]
    names = {t["id"]: t["name"] for t in lib.list_character_templates()}
    if not rels:
        return "当前没有任何角色关系。"
    lines = []
    for key, desc in rels.items():
        src, dst = key.split("->", 1)
        arrow = f"{names.get(src, src)} → {names.get(dst, dst)}"
        lines.append(f"- {arrow}（{key}）：{desc or '（描述未填）'}")
    return f"共 {len(rels)} 条有向关系：\n" + "\n".join(lines)


async def _set_relationship(a: SetRelationshipArgs) -> str:
    if a.from_template_id == a.to_template_id:
        raise ValueError("不能设置指向自己的关系")
    _assert_template_exists(a.from_template_id, "fromTemplateId")
    _assert_template_exists(a.to_template_id, "toTemplateId")
    lib.set_relationship(a.from_template_id, a.to_template_id, a.description)
    return f"已设置关系 {a.from_template_id}→{a.to_template_id}。"


async def _delete_relationship(a: RelationshipKeyArgs) -> str:
    ok = lib.delete_relationship(a.from_template_id, a.to_template_id)
    return (
        f"已删除关系 {a.from_template_id}→{a.to_template_id}。"
        if ok
        else f"未找到关系 {a.from_template_id}→{a.to_template_id}。"
    )


AGENT_TOOLS: dict[str, AgentToolDef] = {
    t.name: t
    for t in [
        AgentToolDef(
            name="list_character_templates",
            is_write=False,
            description=(
                "列出全部角色模板（含 id、名称、身份描述、性格）。修改或删除前先调用它确认现状。"
            ),
            args_schema=ListArgs,
            run=_list_characters,  # type: ignore[arg-type]
            summarize=lambda _: "查看角色模板列表",
        ),
        AgentToolDef(
            name="upsert_character_template",
            is_write=True,
            description=(
                "创建或更新角色模板。id 留空 = 新建；传 id = 更新"
                "（name/description/personality 全量覆盖，未传的字段会清空，先 list 查询再改）。"
            ),
            args_schema=UpsertCharacterArgs,
            run=_upsert_character,  # type: ignore[arg-type]
            summarize=lambda a: (
                f"更新角色模板 {a.id}" if a.id else f"新建角色模板「{a.name}」"  # type: ignore[attr-defined]
            ),
        ),
        AgentToolDef(
            name="delete_character_template",
            is_write=True,
            description="删除角色模板（其参与的关系和画布坐标会一并清理）。删除是不可逆的，确认用户意图明确后再调用。",
            args_schema=DeleteArgs,
            run=_delete_character,  # type: ignore[arg-type]
            summarize=lambda a: f"删除角色模板 {a.id}",
        ),
        AgentToolDef(
            name="list_topic_templates",
            is_write=False,
            description="列出全部话题模板（对话的开场引子文本）。",
            args_schema=ListArgs,
            run=_list_topics,  # type: ignore[arg-type]
            summarize=lambda _: "查看话题模板列表",
        ),
        AgentToolDef(
            name="upsert_topic_template",
            is_write=True,
            description="创建或更新话题模板。id 留空 = 新建；传 id = 更新（content 全量覆盖）。",
            args_schema=UpsertTopicArgs,
            run=_upsert_topic,  # type: ignore[arg-type]
            summarize=lambda a: f"更新话题模板 {a.id}" if a.id else "新建话题模板",  # type: ignore[attr-defined]
        ),
        AgentToolDef(
            name="delete_topic_template",
            is_write=True,
            description="删除话题模板。删除是不可逆的，确认用户意图明确后再调用。",
            args_schema=DeleteArgs,
            run=_delete_topic,  # type: ignore[arg-type]
            summarize=lambda a: f"删除话题模板 {a.id}",
        ),
        AgentToolDef(
            name="list_worldview_templates",
            is_write=False,
            description="列出全部世界观模板（场景设定）。",
            args_schema=ListArgs,
            run=_list_worldviews,  # type: ignore[arg-type]
            summarize=lambda _: "查看世界观模板列表",
        ),
        AgentToolDef(
            name="upsert_worldview_template",
            is_write=True,
            description=(
                "创建或更新世界观模板。id 留空 = 新建；传 id = 更新（name/scenario 全量覆盖）。"
            ),
            args_schema=UpsertWorldviewArgs,
            run=_upsert_worldview,  # type: ignore[arg-type]
            summarize=lambda a: (
                f"更新世界观模板 {a.id}" if a.id else f"新建世界观模板「{a.name}」"  # type: ignore[attr-defined]
            ),
        ),
        AgentToolDef(
            name="delete_worldview_template",
            is_write=True,
            description="删除世界观模板。删除是不可逆的，确认用户意图明确后再调用。",
            args_schema=DeleteArgs,
            run=_delete_worldview,  # type: ignore[arg-type]
            summarize=lambda a: f"删除世界观模板 {a.id}",
        ),
        AgentToolDef(
            name="list_relationships",
            is_write=False,
            description=(
                "列出角色模板之间的全部关系。关系是有向的：A→B 表示 A 视角对 B 的关系描述。"
            ),
            args_schema=ListArgs,
            run=_list_relationships,  # type: ignore[arg-type]
            summarize=lambda _: "查看角色关系列表",
        ),
        AgentToolDef(
            name="set_relationship",
            is_write=True,
            description=(
                "设置一条有向关系（A 视角对 B 的描述）。一对双向关系需要调用两次"
                "（A→B 和 B→A 各一条，视角描述通常不同）。"
            ),
            args_schema=SetRelationshipArgs,
            run=_set_relationship,  # type: ignore[arg-type]
            summarize=lambda _: "设置角色关系",
        ),
        AgentToolDef(
            name="delete_relationship",
            is_write=True,
            description="删除一条有向关系。删除双向关系需要调用两次（两个方向各一条）。",
            args_schema=RelationshipKeyArgs,
            run=_delete_relationship,  # type: ignore[arg-type]
            summarize=lambda _: "删除角色关系",
        ),
    ]
}

# bind_tools 用的线格式 schema（OpenAI function 格式，langchain 负责转各协议）
AGENT_TOOL_SCHEMAS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": t.name,
            "description": t.description,
            "parameters": t.args_schema.model_json_schema(),
        },
    }
    for t in AGENT_TOOLS.values()
]
