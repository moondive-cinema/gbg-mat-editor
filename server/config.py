"""설정 파일 관리 (matte_editor_config.json)"""

import json
from pathlib import Path


def load_config(config_path: Path) -> dict:
    """설정 파일 읽기. 없거나 파싱 실패 시 기본값 반환."""
    if config_path.exists():
        try:
            with open(config_path, encoding="utf-8") as f:
                data = json.load(f)
            return {
                "output_dir":   data.get("output_dir", ""),
                "project_name": data.get("project_name", ""),
            }
        except Exception:
            pass
    return {"output_dir": "", "project_name": ""}


def save_config(config_path: Path, data: dict):
    """설정 파일 저장."""
    with open(config_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def resolve_output_dir(raw_str: str, base_dir: Path) -> Path:
    """절대경로면 그대로, 상대경로면 base_dir 기준으로 해석."""
    if not raw_str:
        return base_dir
    p = Path(raw_str).expanduser()
    return p if p.is_absolute() else base_dir / p
