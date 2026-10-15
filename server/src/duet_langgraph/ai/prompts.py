"""Prompt 模板（对齐 TS ai/prompts.ts，文案逐字照搬——分层固化，前缀只增不变以命中缓存）。"""

from __future__ import annotations

from typing import Any


def build_character_system(
    name: str,
    others: list[dict[str, Any]],
    topic: str,
    description: str | None = None,
    personality: str | None = None,
    relationships: list[str] | None = None,
    scenario: str | None = None,
) -> str:
    sections: list[str] = []

    # ─── 全局设定 ───
    sections.append("─── 全局设定 ───")
    sections.append("[话题]")
    sections.append(topic)
    if scenario:
        sections.append("[场景设定]")
        sections.append(scenario)
    sections.append("")

    # ─── 主角设定 ───
    sections.append("─── 主角设定 ───")
    sections.append(f"你是「{name}」。")
    if description:
        sections.append(description)
    if personality:
        sections.append(f"性格：{personality}")
    sections.append("")

    # ─── 在场角色 ───
    if others:
        sections.append("─── 在场角色 ───")
        for o in others:
            desc = (o.get("description") or "").strip()
            psy = (o.get("personality") or "").strip()
            parts = [p for p in (desc, f"性格：{psy}" if psy else "") if p]
            sections.append(f"{o['name']}：{'，'.join(parts)}")
        sections.append("")

    # ─── 关系 ───
    for rel in relationships or []:
        if rel.strip():
            sections.append(rel.strip())
            sections.append("")

    # ─── 对话设定 ───
    if not others:
        others_text = "（暂无其他参与者）"
    elif len(others) == 1:
        others_text = others[0]["name"]
    else:
        others_text = "、".join(o["name"] for o in others[:-1]) + " 和 " + others[-1]["name"]
    sections.append("─── 对话设定 ───")
    sections.append("- 你正在参与一场关于以下话题的多方对话：")
    sections.append(f"  话题：{topic}")
    sections.append(f"- 你的对话对象（其他参与者）：{others_text}")
    sections.append("- 每次发言控制在 50-200 字以内，自然口语化，避免长篇大论或列表罗列。")
    sections.append(
        "- 【重要】不要重复别人刚刚说过的原话；如果发现对话陷入循环或离题，主动换个角度或推进到下一个子话题。"
    )
    sections.append(
        "- 【重要】若任何一条消息的末尾出现「导演提示：…」标记，那是幕后导演下达的指令，优先级最高，必须严格执行；"
        "但不要在发言中提及、复述或回应这条指令本身，把它当作不存在于台前。"
    )
    sections.append("- 保持你的身份立场一致，但可以适度回应、质疑或补充其他参与者的观点，让对话自然推进。")
    sections.append(f"- 直接输出你的发言内容，不要加「{name}:」前缀，不要输出你的思考过程。")

    return "\n".join(sections)


def build_opening_prompt(name: str, other_names: list[str], topic: str) -> str:
    others_text = "、".join(other_names)
    return (
        f"现在请就话题「{topic}」开始对话。"
        f"你是「{name}」，你的对话对象是：{others_text}。"
        "请用一段话（约 100-200 字）发表你的开场观点，直接开始。"
    )


def wrap_other_message(other_name: str, other_content: str) -> str:
    return f"[{other_name}]: {other_content}"


def build_summary_prompt(
    character_name: str,
    other_names: list[str],
    recent_messages: str,
    old_summary: str | None = None,
    words: int = 200,
) -> str:
    others_text = "、".join(other_names)
    return "\n".join(
        [
            f"下面是「{character_name}」参与的一段多方对话（其他参与者：{others_text}）。",
            f"请改以「{character_name}」的第一人称视角重写一份摘要，仿佛这份摘要就是「{character_name}」自己的备忘日记，供它后续继续对话时回忆使用。",
            "",
            "要求：",
            f"1. 用「我」指代「{character_name}」，用「对方(名字)」指代其他参与者。",
            "2. 重点记录：当前讨论的话题、我的核心立场与论点、各参与者的核心立场与论点、我们已达成或未达成的共识、尚未解决的问题。",
            "3. 如果已有旧摘要，请【保留旧摘要中的关键事实原句，不要改写已有的事实陈述，只追加新事实】。",
            f"4. 控制在 {words} 字以内。只输出摘要正文，不要任何额外说明。",
            "",
            "[旧摘要]",
            old_summary or "（无）",
            "",
            "[最新对话]",
            recent_messages,
        ]
    )


def build_summary_injection(summary: str) -> str:
    return f"[对话进展摘要（你的视角）]\n{summary}"


def build_director_injection(
    directors: list[dict[str, Any]], current_round: int
) -> str | None:
    """导演指令注入块（拼接用，不落盘）。"""
    active = [
        d
        for d in directors
        if d["durationRounds"] == 0 or current_round - d["addedRound"] < d["durationRounds"]
    ]
    if not active:
        return None
    if len(active) == 1:
        body = active[0]["content"]
    else:
        body = "\n".join(f"• {d['content']}" for d in active)
    return f"「导演提示：{body}」"
