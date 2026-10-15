"""运行配置：与 TS 版 config.ts 对齐（D4/D5）。

- 端口默认 23892（PORT env 可覆盖）
- DATA_DIR 显式环境变量最优先，默认 ~/.duet-langgraph
- 全局硬熔断：200 轮 / 7200 秒（env 可覆盖）
- 静态目录：DUET_STATIC_DIR 显式优先，默认包内 public/（S5）
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

DEFAULT_PORT = 23892
DEFAULT_REQUEST_TIMEOUT_MS = 30_000
DEFAULT_ABSOLUTE_MAX_ROUNDS = 200
DEFAULT_ABSOLUTE_MAX_DURATION_SEC = 7_200


def _to_int(value: str | None, default: int) -> int:
    try:
        n = int(value) if value not in (None, "") else None
    except ValueError:
        n = None
    return n if n is not None and n >= 0 else default


def _detect_env() -> str:
    # DUET_ENV 显式优先；默认 development（生产入口 main() 会覆写为 production）
    return os.environ.get("DUET_ENV", "development")


def _static_dir() -> Path:
    # DUET_STATIC_DIR 显式优先；默认取包内 public/（web 构建产物，Docker/PyPI 打包时写入）
    env_dir = os.environ.get("DUET_STATIC_DIR")
    if env_dir:
        return Path(env_dir).expanduser().resolve()
    return Path(__file__).resolve().parent / "public"


def _data_root() -> Path:
    env_dir = os.environ.get("DATA_DIR")
    if env_dir:
        return Path(env_dir).expanduser().resolve()
    return Path.home() / ".duet-langgraph"


@dataclass
class AppConfig:
    env: str = field(default_factory=_detect_env)
    port: int = field(default_factory=lambda: _to_int(os.environ.get("PORT"), DEFAULT_PORT))
    request_timeout_ms: int = field(
        default_factory=lambda: _to_int(
            os.environ.get("REQUEST_TIMEOUT_MS"), DEFAULT_REQUEST_TIMEOUT_MS
        )
    )
    absolute_max_rounds: int = field(
        default_factory=lambda: _to_int(
            os.environ.get("ABSOLUTE_MAX_ROUNDS"), DEFAULT_ABSOLUTE_MAX_ROUNDS
        )
    )
    absolute_max_duration_sec: int = field(
        default_factory=lambda: _to_int(
            os.environ.get("ABSOLUTE_MAX_DURATION_SEC"), DEFAULT_ABSOLUTE_MAX_DURATION_SEC
        )
    )
    data_root: Path = field(default_factory=_data_root)
    static_dir: Path = field(default_factory=_static_dir)

    @property
    def sessions_dir(self) -> Path:
        return self.data_root / "sessions"

    @property
    def providers_file(self) -> Path:
        return self.data_root / "providers.json"

    @property
    def library_file(self) -> Path:
        return self.data_root / "library.json"

    def validate(self) -> AppConfig:
        if not (0 <= self.port <= 65535):
            raise SystemExit(f"[config] 启动校验失败：PORT 非法: {self.port}")
        return self


_config: AppConfig | None = None


def get_config() -> AppConfig:
    """惰性加载单例。测试隔离：先设 DATA_DIR 环境变量再首次调用。"""
    global _config
    if _config is None:
        _config = AppConfig().validate()
    return _config


def reset_config() -> None:
    """仅供测试使用。"""
    global _config
    _config = None
