"""数据目录解析：源码跑 → 仓库 data/；安装形态（site-packages）→ ~/.duet。"""

from __future__ import annotations

from duet_langgraph import config


def test_source_run_detects_repo_root():
    # 测试自身就是源码形态运行（server/src 布局），必须找到仓库根
    repo = config._source_repo_root()
    assert repo is not None
    assert (repo / "pnpm-workspace.yaml").exists()
    assert config._data_root() == repo / "data"


def test_installed_package_falls_back_to_home(monkeypatch, tmp_path):
    # 包位于 site-packages 之下 → 视为安装形态，找不到仓库根
    fake = tmp_path / "venv/lib/python3.12/site-packages/duet_langgraph/config.py"
    fake.parent.mkdir(parents=True)
    fake.write_text("")
    monkeypatch.setattr(config, "__file__", str(fake))
    assert config._source_repo_root() is None

    # 任意目录裸放（无 pnpm-workspace.yaml）也视为非源码
    bare = tmp_path / "bare/duet_langgraph/config.py"
    bare.parent.mkdir(parents=True)
    bare.write_text("")
    monkeypatch.setattr(config, "__file__", str(bare))
    assert config._source_repo_root() is None


def test_data_dir_env_wins(monkeypatch, tmp_path):
    # DATA_DIR 显式设置永远最优先（与源码/安装形态无关）
    monkeypatch.setattr(config, "__file__", __file__)
    custom = tmp_path / "custom"
    monkeypatch.setenv("DATA_DIR", str(custom))
    assert config._data_root() == custom.resolve()
