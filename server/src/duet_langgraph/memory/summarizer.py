"""摘要生成器（对齐 TS memory/summarizer.ts）。

输入：该 AI 视角的最近 messages（assistant/user 翻转过的）+ 旧摘要。
输出：新摘要文本（第一人称视角）+ 本次调用 usage（供成本统计）。

摘要走该 Character 的 Provider 连接，但不注入思考配置（内部任务，省 token）；
temperature 0.3 / maxTokens 600（对齐 TS chatComplete 调用参数）。
"""

from __future__ import annotations

from langchain_core.messages import HumanMessage, SystemMessage

from ..ai.models import content_text, make_model, usage_from_message
from ..ai.prompts import build_summary_prompt
from ..schemas import NormalizedUsage, Provider
from .context import CharacterRef, MemoryMessage

SUMMARY_SYSTEM = "你是一个对话摘要助手。请严格按照用户指令输出摘要。"


async def summarize_conversation(
    *,
    character_name: str,
    others: list[CharacterRef],
    messages: list[MemoryMessage],
    old_summary: str | None,
    words: int = 200,
    provider: Provider,
) -> tuple[str, NormalizedUsage]:
    other_names = [o.name for o in others]

    # assistant 是本角色；user 是其他人（content 已带 [名字]: 前缀）
    recent_text = "\n\n".join(
        f"{character_name if m.role == 'assistant' else '其他参与者'}:\n{m.content}"
        for m in messages
    )

    prompt = build_summary_prompt(
        character_name=character_name,
        other_names=other_names,
        recent_messages=recent_text,
        old_summary=old_summary or None,
        words=words,
    )

    plain = provider.model_copy(update={"thinking_config": None})
    model = make_model(plain, temperature=0.3, max_tokens=600, thinking=None)
    result = await model.ainvoke(
        [SystemMessage(content=SUMMARY_SYSTEM), HumanMessage(content=prompt)]
    )
    return (content_text(result) or "").strip(), usage_from_message(result)
