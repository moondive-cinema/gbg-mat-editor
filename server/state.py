"""서버 상태 관리. 글로벌 변수 대신 단일 객체로 집중."""

import threading
from pathlib import Path


class AppState:
    """서버 런타임 상태. Flask app에 바인딩되어 라우트에서 참조."""

    def __init__(self, model_path="yolov8n-seg.pt", conf=0.25,
                 watch_dir=None, base_dir=None):
        self.model_path = model_path
        self.conf = conf
        self.watch_dir = watch_dir
        self.base_dir = base_dir or Path.cwd()
        self.config_path = self.base_dir / "matte_editor_config.json"
        self.allowed_browse_roots = [Path.home(), self.base_dir]
        self._model = None
        self._lock = threading.Lock()

    def get_model(self):
        """YOLO 모델 lazy load. Lock으로 동시 호출 시 중복 로딩 방지."""
        with self._lock:
            if self._model is None:
                from garbage_matte_gen import YOLO
                print(f"[서버] YOLO 모델 로드: {self.model_path}")
                self._model = YOLO(self.model_path)
            return self._model
