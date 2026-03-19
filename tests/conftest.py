"""테스트 픽스처. garbage_matte_gen 모킹 포함."""

import sys
import types
from pathlib import Path
from unittest.mock import MagicMock

import numpy as np
import pytest


@pytest.fixture(autouse=True)
def mock_garbage_matte_gen():
    """garbage_matte_gen 모듈 전체를 모킹. YOLO 모델 없이 테스트 가능."""
    mock_mod = types.ModuleType("garbage_matte_gen")

    mock_yolo_cls = MagicMock()
    mock_mod.YOLO = mock_yolo_cls

    mock_mod.run_yolo = MagicMock(return_value=[])
    mock_mod.detect_green = MagicMock(
        return_value=np.zeros((100, 100), dtype=np.uint8))
    mock_mod.get_non_green_mask = MagicMock(
        return_value=np.ones((100, 100), dtype=np.uint8) * 255)
    mock_mod.get_person_detections = MagicMock(return_value=[])
    mock_mod.pipeline_without_person = MagicMock(
        return_value=(
            np.ones((100, 100), dtype=np.uint8) * 255,
            None,
            "medium",
        ))
    mock_mod.pipeline_with_person = MagicMock()
    mock_mod.build_safe_zone_mask = MagicMock(
        return_value=np.ones((100, 100), dtype=np.uint8) * 255)
    mock_mod.generate_tight_matte = MagicMock(
        return_value=np.ones((100, 100), dtype=np.uint8) * 255)
    mock_mod.to_output_size = MagicMock(side_effect=lambda x: x)

    sys.modules["garbage_matte_gen"] = mock_mod
    yield mock_mod
    del sys.modules["garbage_matte_gen"]


@pytest.fixture
def tmp_base(tmp_path):
    """임시 프로젝트 루트 디렉토리 + mock dist/."""
    dist = tmp_path / "dist"
    dist.mkdir()
    assets = dist / "assets"
    assets.mkdir()
    (dist / "index.html").write_text(
        '<!DOCTYPE html><html><head><title>Garbage Matte Editor</title>'
        '</head><body><script>window.__WATCH_ENABLED__=false;</script>'
        '<div id="root"></div></body></html>',
        encoding="utf-8",
    )
    (assets / "index.css").write_text("body{}", encoding="utf-8")
    return tmp_path


@pytest.fixture
def app_state(tmp_base):
    """테스트용 AppState."""
    from server.state import AppState
    return AppState(
        model_path="yolov8n-seg.pt",
        conf=0.25,
        watch_dir=None,
        base_dir=tmp_base,
    )


@pytest.fixture
def app(app_state):
    """테스트용 Flask 앱."""
    from server.app import create_app
    flask_app = create_app(app_state)
    flask_app.config["TESTING"] = True
    return flask_app


@pytest.fixture
def client(app):
    """Flask test client."""
    return app.test_client()
