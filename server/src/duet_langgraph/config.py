"""运行配置：与 TS 版 config.ts 对齐（D4/D5）。

- 端口默认 23892（PORT env 可覆盖）
- DATA_DIR 显式环境变量最优先；源码跑用仓库 data/，装好的包（uvx/pip）用 ~/.duet
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


def _source_repo_root() -> Path | None:
    # TS 版以「跑的是 dist 产物还是 src 源码」区分安装/开发；Python 对应判定：
    # 包文件若位于 site-packages 之下即已安装（uvx/pip/Docker venv），否则向上找仓库根
    #（含 pnpm-workspace.yaml 的目录，兼容无 .git 的 zip 解包场景）。
    p = Path(__file__).resolve()
    for parent in p.parents:
        if parent.name in {"site-packages", "dist-packages"}:
            return None
        if (parent / "pnpm-workspace.yaml").exists():
            return parent
    return None


def _data_root() -> Path:
    # 对齐 TS config.ts：DATA_DIR 显式最优先；源码开发 → 仓库 data/；
    # 安装形态（uvx duet-langgraph / pip / Docker）→ ~/.duet（避免 npx/uvx 缓存目录被清丢数据）
    env_dir = os.environ.get("DATA_DIR")
    if env_dir:
        return Path(env_dir).expanduser().resolve()
    repo = _source_repo_root()
    if repo is not None:
        return repo / "data"
    return Path.home() / ".duet"


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
