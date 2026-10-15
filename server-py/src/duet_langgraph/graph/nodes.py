"""主对话图节点（对齐 TS ws/chatHandler.ts runLoop 的每轮语义）。

节点序列：check_stop →(条件)→ finish | summarize → build_context → character_reply
         → post_reply → select_speaker → check_stop（循环）
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from ..ai.models import make_model, usage_from_message
from ..ai.prompts import build_opening_prompt, wrap_other_message
from ..memory.context import CharacterMemory
from ..schemas import (
    CharacterMemoryData,
    NormalizedUsage,
    PersistedMessage,
    Session,
    TokenUsage,
    dump_session,
    now_ms,
)
from ..store import prompt_history, session_store
from ..ws import runtime as ws_runtime
from .state import CharacterLoopInfo, LoopRuntime, broadcast_event, loop_ctx

logger = logging.getLogger(__name__)

MAX_RETRIES = 10
RETRY_BASE_MS = 1000
RETRY_CAP_MS = 60_000

# 200 轮全局熔断 × 每轮 6 个 super-step + 余量
RECURSION_LIMIT = 2000


def _loop() -> LoopRuntime:
    rt = loop_ctx.get()
    if rt is None:
        raise RuntimeError("loop context 未初始化")
    return rt


def _parse_session(state: dict[str, Any]) -> Session:
    session = Session.model_validate(state["session"])
    # 合并 REST 运行中修改：导演/关系/pacing 配置由路由改在 rt.active_session 上，
    # 图状态快照看不到；其余字段以图状态为准。post_reply 会推进 live 指针。
    rt = ws_runtime.peek_runtime(session.id)
    if rt is not None and rt.active_session is not None:
        live = rt.active_session
        session.directors = live.directors
        session.relationships = live.relationships
        session.config.pacing_enabled = live.config.pacing_enabled
        session.config.pacing_buffer_rounds = live.config.pacing_buffer_rounds
    return session


def _dump(session: Session) -> dict[str, Any]:
    return dump_session(session)


def _char_info(session_id: str, character_id: str) -> CharacterLoopInfo:
    info = _loop().characters.get(character_id)
    if info is None:
        raise RuntimeError(f"角色 {character_id} 无运行时连接信息（会话 {session_id}）")
    return info


# ----------------------------- 1. 停止条件 -----------------------------


async def check_stop(state: dict[str, Any]) -> dict[str, Any]:
    """顶部停止检查（条件与优先级对齐 TS runLoop 第 1 步）。"""
    loop = _loop()
    rt = ws_runtime.get_runtime(loop.session_id)
    session = _parse_session(state)
    from ..config import get_config

    cfg = get_config()

    # 用户请求停止（优雅：等当前发言完成后在轮间隙生效）
    if rt.stop_requested or session.status != "running":
        if rt.stop_requested and not session.finished_reason:
            session.status = "stopped"
            session.finished_reason = "stopped"
            session.stopped_at = now_ms()
            return {"session": _dump(session), "stop_reason": "stopped"}
        return {"session": _dump(session), "stop_reason": session.finished_reason or "stopped"}

    round_ = session_store.current_round(session)
    if session.config.max_rounds > 0 and round_ >= session.config.max_rounds:
        session.finished_reason = "max_rounds"
        return {"session": _dump(session), "stop_reason": "max_rounds"}
    if round_ >= cfg.absolute_max_rounds:
        session.finished_reason = "absolute_limit"
        return {"session": _dump(session), "stop_reason": "absolute_limit"}
    if (
        session.config.duration_sec > 0
        and now_ms() - (session.started_at or 0) >= session.config.duration_sec * 1000
    ):
        session.finished_reason = "duration"
        return {"session": _dump(session), "stop_reason": "duration"}
    if now_ms() - (session.started_at or 0) >= cfg.absolute_max_duration_sec * 1000:
        session.finished_reason = "absolute_limit"
        return {"session": _dump(session), "stop_reason": "absolute_limit"}

    # 清除上一轮可能残留的 stop_reason（恢复运行）
    updates: dict[str, Any] = {"stop_reason": None}
    if state.get("stop_reason"):
        updates["session"] = _dump(session)
    return updates


def route_after_check(state: dict[str, Any]) -> str:
    return "finish" if state.get("stop_reason") else "summarize_memory"


# ----------------------------- 2. 摘要（S4 实装） -----------------------------


async def summarize_memory(state: dict[str, Any]) -> dict[str, Any]:
    """按需压缩当前角色记忆（S2 为占位直通；S4 实装触发/生成/裁剪）。"""
    return {}


# ----------------------------- 3. 组装上下文 -----------------------------


def _restore_memory(state: dict[str, Any], session: Session, character_id: str) -> CharacterMemory:
    data = state.get("memories", {}).get(character_id)
    if data is not None:
        mem = CharacterMemory.from_data(CharacterMemoryData.model_validate(data))
    else:
        ref = next(c for c in session.characters if c.id == character_id)
        others = [o for o in session.characters if o.id != character_id]
        mem = CharacterMemory(ref, others, session.topic, session.relationships)
    mem.relationships = session.relationships or {}
    return mem


async def build_context(state: dict[str, Any]) -> dict[str, Any]:
    """组装当前发言者视角的完整 messages + 记录 prompt 快照（所见即所发）。"""
    loop = _loop()
    session = _parse_session(state)
    character_id = state["current_speaker"]
    info = _char_info(loop.session_id, character_id)

    mem = _restore_memory(state, session, character_id)
    round_ = session_store.current_round(session)

    # 首位发言者的开场提示（只进 A 的记忆，作为 user）
    if session.message_count == 0 and character_id == "A" and not mem.messages:
        mem.push_other(
            build_opening_prompt(
                name=mem.character.name,
                other_names=[o.name for o in mem.others],
                topic=session.topic,
            )
        )

    api_messages = mem.build_api_messages(
        scenario=session.config.scenario,
        directors=[d.model_dump(by_alias=True) for d in session.directors],
        current_round=round_,
    )

    prompt_history.record_prompt(
        loop.session_id,
        {
            "characterId": character_id,
            "characterName": info.name,
            "round": round_,
            "timestamp": now_ms(),
            "protocol": info.provider.protocol,
            "providerName": info.provider.name,
            "messages": [{"role": m["role"], "content": m["content"]} for m in api_messages],
        },
    )

    # 记忆可能新增了开场提示 → 写回 state
    memories = dict(state.get("memories", {}))
    memories[character_id] = mem.to_data().model_dump(by_alias=True, exclude_none=True)
    return {"pending_messages": api_messages, "memories": memories}


# ----------------------------- 4. 流式生成 -----------------------------


def _to_langchain(messages: list[dict[str, str]]) -> list[Any]:
    out = []
    for m in messages:
        if m["role"] == "system":
            out.append(SystemMessage(content=m["content"]))
        elif m["role"] == "user":
            out.append(HumanMessage(content=m["content"]))
        else:
            out.append(AIMessage(content=m["content"]))
    return out


def _chunk_text(chunk: Any) -> str:
    content = chunk.content
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            part.get("text", "") for part in content if isinstance(part, dict)
        )
    return ""


async def character_reply(state: dict[str, Any]) -> dict[str, Any]:
    """流式生成当前发言（退避重试在节点内，对齐 D4：最多 10 次，1s 起上限 60s）。"""
    loop = _loop()
    session_id = loop.session_id
    session = _parse_session(state)
    character_id = state["current_speaker"]
    info = _char_info(session_id, character_id)

    model = make_model(
        provider=info.provider,
        temperature=session.config.temperature,
        max_tokens=1024,
        thinking=info.thinking,
    )
    messages = _to_langchain(state.get("pending_messages") or [])

    retry_count = 0
    while True:
        try:
            content = ""
            final = None
            async for chunk in model.astream(messages):
                piece = _chunk_text(chunk)
                if piece:
                    content += piece
                    broadcast_event(
                        {"type": "chunk", "characterId": character_id, "content": piece}
                    )
                final = chunk
            usage = usage_from_message(final) if final is not None else None
            return {
                "reply": {
                    "content": content,
                    "usage": usage.model_dump() if usage else None,
                }
            }
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001 —— 对齐 TS：任何 LLM 错误都走退避
            retry_count += 1
            if retry_count <= MAX_RETRIES:
                delay = min(RETRY_BASE_MS * 2 ** (retry_count - 1), RETRY_CAP_MS)
                broadcast_event(
                    {
                        "type": "retry",
                        "attempt": retry_count,
                        "maxAttempts": MAX_RETRIES,
                        "delayMs": delay,
                        "error": str(e),
                    }
                )
                await asyncio.sleep(delay / 1000)
                if ws_runtime.get_runtime(session_id).stop_requested:
                    # 等待期间用户点了暂停 → 优雅退出
                    session.status = "stopped"
                    session.finished_reason = "stopped"
                    session.stopped_at = now_ms()
                    return {
                        "session": _dump(session),
                        "stop_reason": "stopped",
                        "reply": None,
                    }
                continue
            # 重试耗尽 → error 状态
            session.status = "error"
            session.error = f"{e}（已重试 {MAX_RETRIES} 次）"
            session.finished_reason = "error"
            broadcast_event({"type": "error", "message": session.error})
            return {"session": _dump(session), "stop_reason": "error", "reply": None}


# ----------------------------- 5. 落账与广播 -----------------------------


async def post_reply(state: dict[str, Any]) -> dict[str, Any]:
    """写记忆 + 统计 + 写穿落盘 + 广播 message_done / stats / turn_end。"""
    loop = _loop()
    session_id = loop.session_id
    session = _parse_session(state)
    character_id = state["current_speaker"]
    info = _char_info(session_id, character_id)
    reply = state.get("reply")
    if not reply:
        # 生成被中止（stop/error 已置）→ 直接交给 finish
        return {}

    content = (reply["content"] or "").strip() or "（无内容）"
    usage = (
        NormalizedUsage.model_validate(reply["usage"]) if reply.get("usage") else NormalizedUsage()
    )

    session_store.add_stats(
        session, usage, info.rates, loop.display_currency, loop.exchange_rates
    )
    session.stats.total_chars += len(content)

    ts = now_ms()
    message = PersistedMessage(
        characterId=character_id,
        role="assistant",
        content=content,
        ts=ts,
        tokens=TokenUsage(
            prompt=usage.prompt_tokens or 0, completion=usage.completion_tokens or 0
        ),
        truncated=False,
    )
    session.messages.append(message)

    # 记忆写入：自己 assistant，其他角色 user（带名字前缀，content-only）
    memories = dict(state.get("memories", {}))
    mem = _restore_memory({"memories": memories}, session, character_id)
    mem.push_self(content)
    memories[character_id] = mem.to_data().model_dump(by_alias=True, exclude_none=True)
    speaker_name = mem.character.name
    for other in session.characters:
        if other.id == character_id:
            continue
        other_mem = _restore_memory({"memories": memories}, session, other.id)
        other_mem.push_other(wrap_other_message(speaker_name, content))
        memories[other.id] = other_mem.to_data().model_dump(by_alias=True, exclude_none=True)

    # 记忆随会话写穿落盘（TS 在循环退出时统一写回；此处每轮落盘更耐崩）
    session.memory = {
        cid: CharacterMemoryData.model_validate(d) for cid, d in memories.items()
    }

    session.message_count += 1
    session.current_character_id = session_store.next_character_id(session)
    session.updated_at = ts
    session_store.save_session(session)
    # live 指针推进到最新对象：REST 的运行中修改（导演/关系/config）从这里继续生效
    rt = ws_runtime.peek_runtime(session_id)
    if rt is not None:
        rt.active_session = session

    msg_json = message.model_dump(by_alias=True)
    broadcast_event({"type": "message_done", "characterId": character_id, "message": msg_json})
    broadcast_event(
        {
            "type": "stats",
            "totalPromptTokens": session.stats.total_prompt_tokens,
            "totalCompletionTokens": session.stats.total_completion_tokens,
            "totalTokens": session.stats.total_tokens,
            "totalCacheHitTokens": session.stats.total_cache_hit_tokens,
            "totalCacheMissTokens": session.stats.total_cache_miss_tokens,
            "totalCacheWriteTokens": session.stats.total_cache_write_tokens,
            "estCost": session.stats.est_cost,
            "costCurrency": session.stats.cost_currency,
            "totalChars": session.stats.total_chars,
        }
    )
    broadcast_event(
        {
            "type": "turn_end",
            "round": session_store.current_round(session),
            "messageCount": session.message_count,
        }
    )
    return {
        "session": _dump(session),
        "memories": memories,
        "messages": session.messages and [msg_json],
        "reply": None,
        "pending_messages": [],
    }


# ----------------------------- 6. 选下一个发言者 -----------------------------


async def select_speaker(state: dict[str, Any]) -> dict[str, Any]:
    """round-robin（对齐 TS nextCharacterId）；S4 增加 scheduling=llm 选项。"""
    session = _parse_session(state)
    return {
        "current_speaker": session.current_character_id,
        "round": session_store.current_round(session),
    }


# ----------------------------- 7. 收尾 -----------------------------


async def finish(state: dict[str, Any]) -> dict[str, Any]:
    """循环退出语义（对齐 TS）：status=running→finished、补 stoppedAt、落盘、广播。"""
    session = _parse_session(state)
    if session.status == "running":
        session.status = "finished"
    if not session.stopped_at:
        session.stopped_at = now_ms()
    session_store.save_session(session)
    broadcast_event(
        {
            "type": "finished",
            "reason": session.finished_reason
            or ("error" if session.status == "error" else "stopped"),
        }
    )
    return {"session": _dump(session)}
