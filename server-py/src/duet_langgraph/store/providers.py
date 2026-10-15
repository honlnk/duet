"""providers.json 存储层（对齐 TS store/providerStore.ts，格式 100% 兼容）。

单进程内存权威 + 变更即落盘（tmp+rename 原子写）。
"""

from __future__ import annotations

import json
import logging
import os
import uuid
from typing import Any

from ..config import get_config
from ..schemas import (
    Provider,
    ProviderFormData,
    ProviderPricing,
)
from ..utils.cost import FALLBACK_INPUT_PER_MTOK, FALLBACK_OUTPUT_PER_MTOK

logger = logging.getLogger(__name__)


def _round4(n: float) -> float:
    return round(n * 10000) / 10000


def normalize_pricing(p: dict[str, Any] | None) -> ProviderPricing:
    """归一化价格配置：补全缺失字段（与 TS normalizePricing 同规则）。"""
    p = p or {}

    def num(key: str, default: float) -> float:
        v = p.get(key)
        try:
            n = float(v) if v is not None else None
        except (TypeError, ValueError):
            n = None
        return n if n is not None and n >= 0 else default

    input_per_m_tok = num("inputPerMTok", FALLBACK_INPUT_PER_MTOK)
    output_per_m_tok = num("outputPerMTok", FALLBACK_OUTPUT_PER_MTOK)

    currency = p.get("currency")
    currency = currency.strip() if isinstance(currency, str) and currency.strip() else "CNY"

    return ProviderPricing(
        currency=currency,
        inputPerMTok=input_per_m_tok,
        outputPerMTok=output_per_m_tok,
        cacheHitEnabled=p.get("cacheHitEnabled", True),
        cacheHitPerMTok=num("cacheHitPerMTok", _round4(input_per_m_tok * 0.25)),
        cacheWriteEnabled=p.get("cacheWriteEnabled", False),
        cacheWritePerMTok=num("cacheWritePerMTok", 0),
    )


def _empty_file() -> dict[str, Any]:
    return {"providers": [], "defaultId": ""}


def _save_raw(data: dict[str, Any]) -> None:
    file = get_config().providers_file
    os.makedirs(os.path.dirname(file), exist_ok=True)
    tmp = str(file) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, file)


def _load_raw() -> dict[str, Any]:
    file = get_config().providers_file
    try:
        with open(file, encoding="utf-8") as f:
            parsed = json.load(f)
    except FileNotFoundError:
        return _empty_file()
    except (OSError, json.JSONDecodeError) as e:
        logger.error("[provider] 配置文件损坏: %s", e)
        return _empty_file()
    if not isinstance(parsed, dict) or not isinstance(parsed.get("providers"), list):
        return _empty_file()
    # 补全旧数据缺的 protocol 字段（默认 openai），脏则回写
    dirty = False
    for p in parsed["providers"]:
        if not p.get("protocol"):
            p["protocol"] = "openai"
            dirty = True
    if dirty:
        _save_raw(parsed)
    return parsed


def mask_key(key: str) -> str:
    if not key:
        return ""
    if len(key) <= 6:
        return "***"
    return f"{key[:3]}***{key[-4:]}"


def _normalize_thinking_config(tc: Any) -> dict[str, Any] | None:
    return tc if isinstance(tc, dict) else None


def _to_provider_obj(p: dict[str, Any]) -> Provider:
    return Provider(
        id=p.get("id", ""),
        name=p.get("name", ""),
        baseUrl=p.get("baseUrl", ""),
        apiKey=p.get("apiKey", ""),
        model=p.get("model", ""),
        protocol=p.get("protocol", "openai"),
        pricing=normalize_pricing(p.get("pricing")),
        thinkingConfig=_normalize_thinking_config(p.get("thinkingConfig")),
    )


def _to_list_item(p: Provider) -> dict[str, Any]:
    data = {
        "id": p.id,
        "name": p.name,
        "baseUrl": p.base_url,
        "model": p.model,
        "protocol": p.protocol,
        "pricing": p.pricing.model_dump(by_alias=True),
        "apiKeyMasked": mask_key(p.api_key),
    }
    if p.thinking_config is not None:
        data["thinkingConfig"] = p.thinking_config
    return data


# ----------------------------- 读取 -----------------------------


def list_provider_items() -> dict[str, Any]:
    """返回打码后的列表 + 默认 id（给前端用）。"""
    data = _load_raw()
    items = [_to_list_item(_to_provider_obj(p)) for p in data["providers"]]
    return {"providers": items, "defaultId": data.get("defaultId", "")}


def get_provider(id_: str) -> Provider | None:
    data = _load_raw()
    for p in data["providers"]:
        if p.get("id") == id_:
            return _to_provider_obj(p)
    return None


def get_default_provider() -> Provider | None:
    data = _load_raw()
    for p in data["providers"]:
        if p.get("id") == data.get("defaultId"):
            return _to_provider_obj(p)
    return _to_provider_obj(data["providers"][0]) if data["providers"] else None


def resolve_provider(id_: str | None) -> Provider | None:
    """id 为空或找不到 → 回落默认 Provider（容错，与 TS 一致）。"""
    if id_:
        found = get_provider(id_)
        if found:
            return found
        logger.warning("[provider] id=%s 不存在，回落到默认 Provider", id_)
    return get_default_provider()


# ----------------------------- 写入 -----------------------------


def add_provider(data: ProviderFormData) -> Provider:
    file = _load_raw()
    provider = Provider(
        id="prov_" + str(uuid.uuid4()),
        name=data.name.strip() or "未命名 Provider",
        baseUrl=data.base_url.strip() or "https://api.deepseek.com/v1",
        apiKey=data.api_key.strip(),
        model=data.model.strip() or "deepseek-v4-flash",
        protocol=data.protocol or "openai",
        pricing=normalize_pricing(data.pricing),
        thinkingConfig=_normalize_thinking_config(data.thinking_config),
    )
    file["providers"].append(provider.model_dump(by_alias=True, exclude_none=True))
    if not file.get("defaultId"):
        file["defaultId"] = provider.id
    _save_raw(file)
    return provider


def update_provider(id_: str, data: dict[str, Any]) -> Provider | None:
    file = _load_raw()
    idx = next((i for i, p in enumerate(file["providers"]) if p.get("id") == id_), None)
    if idx is None:
        return None
    old = file["providers"][idx]
    new = dict(old)

    if (name := data.get("name")) is not None:
        new["name"] = name.strip() or old["name"]
    if (base_url := data.get("baseUrl")) is not None:
        new["baseUrl"] = base_url.strip() or old["baseUrl"]
    # apiKey 空字符串 = 不修改
    if (api_key := data.get("apiKey")) is not None and api_key.strip():
        new["apiKey"] = api_key.strip()
    if (model := data.get("model")) is not None:
        new["model"] = model.strip() or old["model"]
    if data.get("protocol") is not None:
        new["protocol"] = data["protocol"]
    if (pricing := data.get("pricing")) is not None:
        new["pricing"] = normalize_pricing({**old.get("pricing", {}), **pricing}).model_dump(
            by_alias=True
        )
    if "thinkingConfig" in data:
        new["thinkingConfig"] = _normalize_thinking_config(data["thinkingConfig"])

    file["providers"][idx] = new
    _save_raw(file)
    return _to_provider_obj(new)


def delete_provider(id_: str) -> tuple[bool, str | None]:
    file = _load_raw()
    if not any(p.get("id") == id_ for p in file["providers"]):
        return False, "Provider 不存在"
    if file.get("defaultId") == id_:
        return False, "不能删除默认 Provider"
    file["providers"] = [p for p in file["providers"] if p.get("id") != id_]
    _save_raw(file)
    return True, None


def set_default_provider(id_: str) -> bool:
    file = _load_raw()
    if not any(p.get("id") == id_ for p in file["providers"]):
        return False
    file["defaultId"] = id_
    _save_raw(file)
    return True


def validate_providers() -> None:
    """启动校验：无 Provider 仅警告不退出（npx 首跑依赖此行为）。"""
    data = _load_raw()
    if not data["providers"]:
        logger.warning(
            "[provider] 尚未配置任何 Provider。请在打开的页面「设置」中添加模型连接；"
            "配置前无法进行 AI 对话。"
        )
    elif not data.get("defaultId") or not any(
        p.get("id") == data.get("defaultId") for p in data["providers"]
    ):
        data["defaultId"] = data["providers"][0]["id"]
        _save_raw(data)
