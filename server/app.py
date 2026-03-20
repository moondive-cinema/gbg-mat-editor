"""Flask 앱 팩토리 + API 라우트."""

import datetime as dt
import email.utils
import io
import sys
import traceback
from pathlib import Path

import cv2
import numpy as np
from flask import Flask, request, jsonify, send_file, send_from_directory, Response
from flask_cors import CORS

from .config import load_config, save_config, resolve_output_dir
from .state import AppState

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp", ".webp"}


def create_app(state: AppState) -> Flask:
    """Flask 앱 생성. state 객체를 통해 서버 상태에 접근."""
    app = Flask(__name__)
    CORS(app)
    app.state = state

    dist_dir = state.base_dir / "dist"

    # garbage_matte_gen import 경로 보장
    if str(state.base_dir) not in sys.path:
        sys.path.insert(0, str(state.base_dir))

    from garbage_matte_gen import (
        run_yolo, detect_green, get_non_green_mask,
        get_person_detections, pipeline_with_person, pipeline_without_person,
        build_safe_zone_mask, generate_tight_matte,
    )

    # ── Health ──────────────────────────────────────────────────────────────

    @app.route("/health")
    def health():
        return jsonify({
            "status": "ok",
            "model":  state.model_path,
            "watch":  str(state.watch_dir) if state.watch_dir else None,
        })

    # ── Config ──────────────────────────────────────────────────────────────

    @app.route("/config", methods=["GET"])
    def config_get():
        return jsonify(load_config(state.config_path))

    @app.route("/config", methods=["POST"])
    def config_post():
        data = request.get_json(force=True)
        cfg  = load_config(state.config_path)
        if "output_dir"   in data: cfg["output_dir"]   = data["output_dir"].strip()
        if "project_name" in data: cfg["project_name"] = data["project_name"].strip()
        save_config(state.config_path, cfg)
        return jsonify(cfg)

    # ── Browse (화이트리스트 제한) ──────────────────────────────────────────

    @app.route("/browse")
    def browse():
        """파일시스템 디렉토리 목록 반환. 허용 경로 외 접근 차단."""
        raw = request.args.get("path", "~")
        try:
            p = Path(raw).expanduser().resolve()
            # 화이트리스트 가드: 홈/프로젝트 루트 + 설정된 output_dir 하위 허용
            allowed = list(state.allowed_browse_roots)
            cfg = load_config(state.config_path)
            if cfg["output_dir"]:
                allowed.append(resolve_output_dir(cfg["output_dir"], state.base_dir).resolve())
            if not _is_path_allowed(p, allowed):
                return jsonify({"error": "접근 불가"}), 403
            if not p.exists() or not p.is_dir():
                p = Path.home()
            entries = [
                {"name": item.name, "path": str(item)}
                for item in sorted(p.iterdir())
                if item.is_dir() and not item.name.startswith(".")
            ]
            parent = str(p.parent) if p != p.parent else None
            return jsonify({"current": str(p), "parent": parent, "entries": entries})
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    # ── Save ────────────────────────────────────────────────────────────────

    @app.route("/save", methods=["POST"])
    def save():
        if "matte" not in request.files:
            return jsonify({"error": "matte 필드 없음"}), 400

        cfg          = load_config(state.config_path)
        project_name = cfg["project_name"] or "matte"
        output_dir   = resolve_output_dir(cfg["output_dir"], state.base_dir)

        try:
            output_dir.mkdir(parents=True, exist_ok=True)
        except Exception as e:
            return jsonify({"error": f"저장 폴더 생성 실패: {e}"}), 500

        timestamp  = dt.datetime.now().strftime("%m%d%H%M%S")
        matte_name = f"{project_name}_matte_{timestamp}.png"
        ref_name   = f"{project_name}_reference_{timestamp}.png"
        matte_path = output_dir / matte_name
        ref_path   = output_dir / ref_name

        try:
            request.files["matte"].save(str(matte_path))
            if "reference" in request.files:
                request.files["reference"].save(str(ref_path))
                print(f"[서버] 저장 완료: {matte_path}, {ref_path}")
                return jsonify({"matte": matte_name, "reference": ref_name})
            else:
                print(f"[서버] 저장 완료 (matte only): {matte_path}")
                return jsonify({"matte": matte_name})
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    # ── Generate ────────────────────────────────────────────────────────────

    @app.route("/generate", methods=["POST"])
    def generate():
        if "image" not in request.files:
            return jsonify({"error": "image 필드 없음"}), 400

        file = request.files["image"]
        try:
            # 디스크 I/O 우회: 메모리에서 직접 버퍼 읽기 및 디코딩
            in_memory_file = file.read()
            nparr = np.frombuffer(in_memory_file, np.uint8)
            image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            
            if image is None:
                return jsonify({"error": "이미지 디코딩 실패"}), 400
            
            model   = state.get_model()
            dets    = run_yolo(image, model, state.conf)
            green   = detect_green(image)
            nongrn  = get_non_green_mask(green)
            persons = get_person_detections(dets)
            
            if persons:
                base, pmask, tmask, shot = pipeline_with_person(persons, dets, nongrn)
            else:
                base, pmask, shot = pipeline_without_person(dets, nongrn)
                tmask = None
                
            safe  = build_safe_zone_mask(shot, image.shape)
            base  = cv2.bitwise_and(base, safe)
            tight = generate_tight_matte(base, pmask, tmask, shot)
            
            ok, buf = cv2.imencode(".png", tight)
            if not ok:
                return jsonify({"error": "PNG 인코딩 실패"}), 500
            return send_file(io.BytesIO(buf.tobytes()), mimetype="image/png",
                             download_name="tight_matte.png")
        except Exception as e:
            traceback.print_exc()
            return jsonify({"error": str(e)}), 500

    # ── Latest (폴더 감시) ──────────────────────────────────────────────────

    @app.route("/latest")
    def latest():
        if not state.watch_dir or not state.watch_dir.is_dir():
            return jsonify({"error": "감시 폴더 미설정"}), 404
        files = sorted(
            (f for f in state.watch_dir.iterdir()
             if f.suffix.lower() in IMAGE_EXTS),
            key=lambda f: f.stat().st_mtime, reverse=True,
        )
        if not files:
            return jsonify({"error": "이미지 없음"}), 404
        latest_file = files[0]
        mtime = latest_file.stat().st_mtime
        since = request.headers.get("If-Modified-Since")
        if since:
            try:
                if mtime <= email.utils.parsedate_to_datetime(since).timestamp():
                    return Response(status=304)
            except Exception:
                pass
        ext  = latest_file.suffix.lower()
        mime = ("image/jpeg" if ext in {".jpg", ".jpeg"} else
                "image/png"  if ext == ".png" else "image/tiff")
        resp = send_file(str(latest_file), mimetype=mime,
                         download_name=latest_file.name)
        resp.headers["Last-Modified"] = email.utils.format_datetime(
            dt.datetime.fromtimestamp(mtime, tz=dt.timezone.utc))
        resp.headers["X-Filename"] = latest_file.name
        return resp

    # ── 프론트엔드 서빙 (dist/ 빌드 결과물) ────────────────────────────────

    @app.route("/")
    def editor():
        """dist/index.html 서빙. WATCH_ENABLED 주입."""
        index_html = dist_dir / "index.html"
        if not index_html.exists():
            return Response("dist/index.html not found. Run: cd client && npm run build",
                            status=500, mimetype="text/plain")
        html = index_html.read_text(encoding="utf-8")
        watch_val = "true" if state.watch_dir else "false"
        html = html.replace(
            "window.__WATCH_ENABLED__=false",
            f"window.__WATCH_ENABLED__={watch_val}",
        )
        return Response(html, mimetype="text/html")

    @app.route("/assets/<path:filename>")
    def static_assets(filename):
        """dist/assets/ 정적 파일 서빙."""
        return send_from_directory(dist_dir / "assets", filename)

    return app


def _is_path_allowed(path: Path, allowed_roots: list[Path]) -> bool:
    """경로가 허용된 루트 하위인지 확인."""
    return any(path == root or root in path.parents
               for root in allowed_roots)
