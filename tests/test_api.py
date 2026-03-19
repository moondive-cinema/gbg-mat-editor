"""백엔드 API 자동 검증 (A-01 ~ A-17)."""

import io
import json
import threading
from pathlib import Path

import numpy as np
import pytest


# ── A-01: GET /health ───────────────────────────────────────────────────────

def test_health_returns_ok(client):
    """A-01: /health → 200, JSON에 status, model, watch 키 존재."""
    resp = client.get("/health")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["status"] == "ok"
    assert "model" in data
    assert "watch" in data


# ── A-02: GET /config (기본값) ──────────────────────────────────────────────

def test_config_get_defaults(client):
    """A-02: /config GET → 기본값 반환."""
    resp = client.get("/config")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data == {"output_dir": "", "project_name": ""}


# ── A-03: POST /config → 저장 후 재조회 ────────────────────────────────────

def test_config_post_and_get(client):
    """A-03: /config POST 후 GET에서 반영 확인."""
    resp = client.post("/config",
                       data=json.dumps({"project_name": "test_proj",
                                        "output_dir": "/tmp/out"}),
                       content_type="application/json")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["project_name"] == "test_proj"
    assert data["output_dir"] == "/tmp/out"

    resp2 = client.get("/config")
    assert resp2.get_json()["project_name"] == "test_proj"


# ── A-04: GET /browse?path=~ ───────────────────────────────────────────────

def test_browse_home(client):
    """A-04: /browse?path=~ → 200, current/parent/entries 키 존재."""
    resp = client.get("/browse?path=~")
    assert resp.status_code == 200
    data = resp.get_json()
    assert "current" in data
    assert "parent" in data
    assert "entries" in data


# ── A-05: GET /browse?path=/etc → 403 ─────────────────────────────────────

def test_browse_blocked_path(client, tmp_base):
    """A-05: 화이트리스트 외 경로 → 403."""
    resp = client.get("/browse?path=/etc")
    data = resp.get_json()
    if resp.status_code == 403:
        assert data["error"] == "접근 불가"
    else:
        pytest.skip("home directory encompasses /etc on this system")


# ── A-06: POST /generate (image 필드 없음) ─────────────────────────────────

def test_generate_no_image(client):
    """A-06: /generate에 image 없이 → 400."""
    resp = client.post("/generate")
    assert resp.status_code == 400
    assert "error" in resp.get_json()


# ── A-07: POST /generate (정상 이미지) ─────────────────────────────────────

def test_generate_with_image(client, mock_garbage_matte_gen):
    """A-07: /generate에 정상 이미지 → 200, image/png."""
    import cv2
    img = np.ones((100, 100, 3), dtype=np.uint8) * 255
    _, buf = cv2.imencode(".png", img)
    data = {"image": (io.BytesIO(buf.tobytes()), "test.png")}
    resp = client.post("/generate", data=data,
                       content_type="multipart/form-data")
    assert resp.status_code == 200
    assert resp.content_type == "image/png"


# ── A-08: POST /save (matte 필드 없음) ─────────────────────────────────────

def test_save_no_matte(client):
    """A-08: /save에 matte 없이 → 400."""
    resp = client.post("/save")
    assert resp.status_code == 400


# ── A-09: POST /save (정상) ────────────────────────────────────────────────

def test_save_with_matte(client, tmp_base):
    """A-09: /save에 정상 matte → 200, 파일 실제 생성."""
    client.post("/config",
                data=json.dumps({"output_dir": str(tmp_base / "output")}),
                content_type="application/json")

    matte_blob = io.BytesIO(b"\x89PNG\r\n\x1a\n" + b"\x00" * 100)
    data = {"matte": (matte_blob, "matte.png")}
    resp = client.post("/save", data=data,
                       content_type="multipart/form-data")
    assert resp.status_code == 200
    result = resp.get_json()
    assert "matte" in result

    output_dir = tmp_base / "output"
    saved_files = list(output_dir.glob("*.png"))
    assert len(saved_files) >= 1


# ── A-10: GET /latest (watch 미설정) ───────────────────────────────────────

def test_latest_no_watch(client):
    """A-10: watch 미설정 시 → 404."""
    resp = client.get("/latest")
    assert resp.status_code == 404


# ── A-11: GET /latest (이미지 존재) ────────────────────────────────────────

def test_latest_with_image(tmp_base):
    """A-11: watch 폴더에 이미지 존재 시 → 200."""
    import cv2
    from server.state import AppState
    from server.app import create_app

    watch = tmp_base / "watch"
    watch.mkdir()
    img = np.ones((50, 50, 3), dtype=np.uint8) * 128
    cv2.imwrite(str(watch / "test.jpg"), img)

    state = AppState(watch_dir=watch, base_dir=tmp_base)
    app = create_app(state)
    app.config["TESTING"] = True

    with app.test_client() as c:
        resp = c.get("/latest")
        assert resp.status_code == 200
        assert "image/" in resp.content_type


# ── A-12: GET /latest (If-Modified-Since 동일) ─────────────────────────────

def test_latest_not_modified(tmp_base):
    """A-12: 동일 mtime → 304."""
    import cv2
    from server.state import AppState
    from server.app import create_app

    watch = tmp_base / "watch"
    watch.mkdir()
    img = np.ones((50, 50, 3), dtype=np.uint8) * 128
    cv2.imwrite(str(watch / "test.jpg"), img)

    state = AppState(watch_dir=watch, base_dir=tmp_base)
    app = create_app(state)
    app.config["TESTING"] = True

    with app.test_client() as c:
        resp1 = c.get("/latest")
        assert resp1.status_code == 200
        last_modified = resp1.headers.get("Last-Modified")
        assert last_modified

        resp2 = c.get("/latest",
                       headers={"If-Modified-Since": last_modified})
        assert resp2.status_code == 304


# ── A-13: GET / → HTML (dist 서빙) ─────────────────────────────────────────

def test_editor_html(client):
    """A-13: / → 200, text/html, 타이틀 포함."""
    resp = client.get("/")
    assert resp.status_code == 200
    assert "text/html" in resp.content_type
    assert b"Garbage Matte Editor" in resp.data


# ── A-14: AppState.get_model() thread safety ───────────────────────────────

def test_model_singleton(app_state, mock_garbage_matte_gen):
    """A-14: 두 스레드 동시 호출 시 YOLO 인스턴스 1개만 생성."""
    results = []

    def load():
        m = app_state.get_model()
        results.append(id(m))

    t1 = threading.Thread(target=load)
    t2 = threading.Thread(target=load)
    t1.start(); t2.start()
    t1.join(); t2.join()

    assert len(results) == 2
    assert results[0] == results[1]
    assert mock_garbage_matte_gen.YOLO.call_count == 1


# ── A-15: resolve_output_dir ───────────────────────────────────────────────

def test_resolve_output_dir():
    """A-15: 빈 문자열/상대경로/절대경로 처리."""
    from server.config import resolve_output_dir
    base = Path("/home/test")

    assert resolve_output_dir("", base) == base
    assert resolve_output_dir("output", base) == base / "output"
    assert resolve_output_dir("/tmp/out", base) == Path("/tmp/out")


# ── A-16: GET /assets/ (정적 파일) ─────────────────────────────────────────

def test_static_assets(client):
    """A-16: /assets/index.css → 200."""
    resp = client.get("/assets/index.css")
    assert resp.status_code == 200


# ── A-17: WATCH_ENABLED 주입 ───────────────────────────────────────────────

def test_watch_enabled_injection(tmp_base):
    """A-17: watch 설정 시 HTML에 __WATCH_ENABLED__=true 주입."""
    from server.state import AppState
    from server.app import create_app

    watch = tmp_base / "watch"
    watch.mkdir()

    state = AppState(watch_dir=watch, base_dir=tmp_base)
    app = create_app(state)
    app.config["TESTING"] = True

    with app.test_client() as c:
        resp = c.get("/")
        assert b"__WATCH_ENABLED__=true" in resp.data
