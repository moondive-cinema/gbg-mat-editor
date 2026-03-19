#!/usr/bin/env python3
"""
Project-Melies — Matte Server v0.51
Garbage Matte Editor 서버.

실행:
    python run.py
    python run.py --port 5555 --watch ~/Screenshots
    python run.py --model yolov8n-seg.pt --watch ./frames
"""

import argparse
import threading
import time
import webbrowser
from pathlib import Path

from server.state import AppState
from server.app import create_app


def main():
    parser = argparse.ArgumentParser(description="Matte Server v0.51")
    parser.add_argument("--port",  type=int,   default=5555)
    parser.add_argument("--host",  default="127.0.0.1")
    parser.add_argument("--model", default="yolov8n-seg.pt")
    parser.add_argument("--conf",  type=float, default=0.25)
    parser.add_argument("--watch", default=None,
                        help="새 이미지 자동 감지 폴더 (예: ~/Screenshots)")
    args = parser.parse_args()

    watch_dir = None
    if args.watch:
        watch_dir = Path(args.watch).expanduser().resolve()
        if not watch_dir.is_dir():
            print(f"[경고] 감시 폴더 없음: {watch_dir}")
            watch_dir = None
        else:
            print(f"[서버] 폴더 감시: {watch_dir}")

    base_dir = Path(__file__).parent.resolve()
    state = AppState(
        model_path=args.model,
        conf=args.conf,
        watch_dir=watch_dir,
        base_dir=base_dir,
    )
    app = create_app(state)

    url = f"http://{args.host}:{args.port}"
    print(f"\nMatte Server v0.51  —  Project Méliès")
    print(f"  에디터:  {url}")
    print(f"  모델:    {args.model}  (conf={args.conf})")
    if watch_dir:
        print(f"  감시:    {watch_dir}  (2초 폴링)")
    print(f"  저장설정: {state.config_path}")
    print(f"  종료:    Ctrl+C\n")

    def _open():
        time.sleep(1.2)
        webbrowser.open(url)
    threading.Thread(target=_open, daemon=True).start()

    app.run(host=args.host, port=args.port, debug=False, threaded=True)


if __name__ == "__main__":
    main()
