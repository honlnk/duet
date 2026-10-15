"""langchain 模型接入层（D2：对话与 Agent 主链路全部走 langchain 官方 model 类）。

- 协议映射：openai → ChatOpenAI / openai-responses → ChatOpenAI(use_responses_api=True)
  / anthropic → ChatAnthropic / gemini → ChatGoogleGenerativeAI
- thinking 注入：会话级档位按 TS applyThinking 的线格式经 model_kwargs / 构造参数透传
- usage 归一化：从 usage_metadata / response_metadata 提取三维缓存计数
"""

from __future__ import annotations

import logging
from typing import Any

from langchain_core.language_models.chat_models import BaseChatModel

from ..schemas import NormalizedUsage, Provider

logger = logging.getLogger(__name__)


def _gemini_thinking_kwargs(thinking: str | None, provider_tc: dict | None) -> dict[str, Any]:
    """Gemini 思考参数：Provider 默认 generationConfig 浅合并 + 会话档位覆盖。"""
    generation_config: dict[str, Any] = {}
    if provider_tc:
        # Provider thinkingConfig 里的 generationConfig 并入（对齐 TS gemini applyThinking）
        for key, value in provider_tc.items():
            if key == "generationConfig" and isinstance(value, dict):
                generation_config.update(value)
    if thinking:
        generation_config["thinkingConfig"] = {"thinkingLevel": thinking, "includeThoughts": True}
    if not generation_config:
        return {}
    return {"generation_config": generation_config}


def build_model_kwargs(
    protocol: str,
    provider_thinking_config: dict[str, Any] | None,
    thinking: str | None,
) -> dict[str, Any]:
    """按协议组装思考参数（对齐 TS 四个 applyThinking 的线格式）。"""
    tc = dict(provider_thinking_config) if provider_thinking_config else {}
    if protocol == "openai":
        # 浅合并：reasoning_effort 等顶层字段
        kwargs = {k: v for k, v in tc.items() if k != "generationConfig"}
        if thinking:
            kwargs["reasoning_effort"] = thinking
        return kwargs
    if protocol == "openai-responses":
        kwargs = {k: v for k, v in tc.items() if k != "generationConfig"}
        if thinking:
            kwargs["reasoning"] = {"effort": thinking}
        return kwargs
    if protocol == "anthropic":
        kwargs = {k: v for k, v in tc.items() if k != "generationConfig"}
        if thinking:
            kwargs["thinking"] = {"type": thinking}
        return kwargs
    if protocol == "gemini":
        return _gemini_thinking_kwargs(thinking, provider_thinking_config)
    return {}


def make_model(
    provider: Provider,
    temperature: float,
    max_tokens: int,
    thinking: str | None = None,
) -> BaseChatModel:
    """按 Provider 协议构造 langchain model（对话与摘要共用）。"""
    common_kwargs = build_model_kwargs(provider.protocol, provider.thinking_config, thinking)

    if provider.protocol == "anthropic":
        from langchain_anthropic import ChatAnthropic

        return ChatAnthropic(
            model=provider.model,
            api_key=provider.api_key,
            base_url=provider.base_url if provider.base_url else None,
            temperature=temperature,
            max_tokens=max_tokens,
            timeout=30_000,
            **common_kwargs,
        )
    if provider.protocol == "gemini":
        from langchain_google_genai import ChatGoogleGenerativeAI

        return ChatGoogleGenerativeAI(
            model=provider.model,
            google_api_key=provider.api_key,
            temperature=temperature,
            max_output_tokens=max_tokens,
            **common_kwargs,
        )
    # openai / openai-responses
    from langchain_openai import ChatOpenAI

    return ChatOpenAI(
        model=provider.model,
        api_key=provider.api_key,
        base_url=provider.base_url,
        temperature=temperature,
        max_tokens=max_tokens,
        timeout=30_000,
        use_responses_api=(provider.protocol == "openai-responses"),
        **common_kwargs,
    )


def content_text(msg: Any) -> str:
    """从 langchain 消息/chunk 提取文本 content（列表形态取 text 拼接）。"""
    content = getattr(msg, "content", "")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(p.get("text", "") for p in content if isinstance(p, dict))
    return ""


def usage_from_message(msg: Any) -> NormalizedUsage:
    """从 AIMessage 提取归一化 usage（三维缓存计数）。

    优先读上游原始 usage（DeepSeek 的 prompt_cache_hit/miss_tokens 等 snake 字段会
    出现在 response_metadata.usage），缺失时从 langchain usage_metadata 映射：
    hit=cache_read、write=cache_creation、miss=input-hit。
    """
    raw: dict[str, Any] = {}
    resp_meta = getattr(msg, "response_metadata", None) or {}
    if isinstance(resp_meta.get("usage"), dict):
        raw = resp_meta["usage"]
    elif isinstance(resp_meta.get("token_usage"), dict):
        raw = resp_meta["token_usage"]

    def _int(*keys: str) -> int:
        for k in keys:
            v = raw.get(k)
            if isinstance(v, (int, float)):
                return int(v)
        return 0

    prompt = _int("prompt_tokens", "input_tokens")
    completion = _int("completion_tokens", "output_tokens")
    hit = _int("prompt_cache_hit_tokens", "cache_read_input_tokens")
    write = _int("prompt_cache_write_tokens", "cache_creation_input_tokens")
    miss = _int("prompt_cache_miss_tokens")

    if not raw:
        um = getattr(msg, "usage_metadata", None) or {}
        details = um.get("input_token_details") or {}
        prompt = int(um.get("input_tokens") or 0)
        completion = int(um.get("output_tokens") or 0)
        hit = int(details.get("cache_read") or 0)
        write = int(details.get("cache_creation") or 0)
        miss = prompt - hit if hit > 0 else 0

    return NormalizedUsage(
        prompt_tokens=prompt,
        completion_tokens=completion,
        prompt_cache_hit_tokens=hit,
        prompt_cache_miss_tokens=miss,
        prompt_cache_write_tokens=write,
    )
