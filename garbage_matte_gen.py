#!/usr/bin/env python3
"""
Project-Melies — Garbage Matte Generator v4.1
단일 프레임 기반 가비지 매트 자동 생성

변경 이력 v4.1:
  - 출력 포맷: 16bit TIFF → 8bit PNG (tifffile 의존성 제거)
  - 기본 출력: tight matte만 생성 (~1s/frame)
  - --motion: motion matte 추가
  - --wide [--sam2]: wide matte 추가 (SAM2 또는 YCbCr 폴백)

설계 원칙:
  - 빈 스튜디오 베이스라인 불필요 (단일 프레임만 사용)
  - person anchor 기반 공간 연결성으로 KEEP/KILL 판단
  - YOLO seg 마스크와 YCbCr non_green CC의 직접 픽셀 겹침으로 소품/카펫 흡수
  - 샷 사이즈 자동 감지 → Safe Zone 및 person 팽창량 결정
  - person 부재 시 중앙 소품을 anchor로 대체

Wide 매트 (v4.0 변경):
  - 그린 색상 기반 → 프레임 전체 WHITE 후 경계 침범 세그먼트 KILL 방식으로 전환
  - YCbCr 그린 감지: HSV 대비 조명 변화에 강함 (방송 업계 표준)
  - SAM2 통합 (선택적): 색상 무관 물체 단위 세그먼트로 그린에 연결된 장비도 제거
  - KILL 공격적 확장 (KILL_EXPAND_PX): 장비 주변 그린 오염까지 제거
  - base_mask 항상 보호: KILL 확장이 세트 침범 시 세트 영역 재복원

Usage:
    python garbage_matte_gen.py input.jpg --debug
    python garbage_matte_gen.py ./frames/ --output ./output --debug
    python garbage_matte_gen.py input.jpg --sam2 --checkpoint sam2_hiera_small.pt --debug
"""

import cv2
import numpy as np
import argparse
from pathlib import Path
from dataclasses import dataclass
from enum import Enum

try:
    from ultralytics import YOLO
except ImportError:
    raise ImportError("ultralytics 패키지가 필요합니다: pip install ultralytics")

# SAM2 선택적 import (미설치 시 YCbCr CC 폴백)
try:
    import torch
    from sam2.build_sam import build_sam2
    from sam2.sam2_image_predictor import SAM2ImagePredictor
    SAM2_AVAILABLE = True
except ImportError:
    SAM2_AVAILABLE = False


# ──────────────────────────────────────────────────────────────
# 설정 상수
# ──────────────────────────────────────────────────────────────

OUTPUT_SIZE = (1920, 1080)  # (width, height)


class ShotSize(Enum):
    WIDE    = "wide"
    MEDIUM  = "medium"
    CLOSEUP = "closeup"
    UNKNOWN = "unknown"


# 샷 사이즈별 Safe Zone (프레임 비율)
# UNKNOWN은 보수적으로 WIDE와 동일 (많이 살리는 방향)
SAFE_ZONE = {
    ShotSize.WIDE:    {"x": 0.03, "y": 0.02, "w": 0.94, "h": 0.96},
    ShotSize.MEDIUM:  {"x": 0.08, "y": 0.03, "w": 0.84, "h": 0.92},
    ShotSize.CLOSEUP: {"x": 0.15, "y": 0.03, "w": 0.70, "h": 0.88},
    ShotSize.UNKNOWN: {"x": 0.03, "y": 0.02, "w": 0.94, "h": 0.96},
}

# 샷 사이즈 판단 임계값 (person bbox 높이 / 프레임 높이)
SHOT_RATIO_WIDE   = 0.70
SHOT_RATIO_MEDIUM = 0.40

# person 부재 시 중앙 소품 anchor 클래스
FURNITURE_CLASSES = {56: "chair", 57: "couch", 59: "bed", 60: "dining table"}

# 베이스 마스크 전체 균일 엣지 팽창량 (OUTPUT_SIZE 기준 px)
BASE_EDGE_PX = 20

# 샷 사이즈별 person 비대칭 팽창 (좌우, 상하) — OUTPUT_SIZE 기준 px
# 앉은 자세: 좌우(고개/팔) > 상하
# 클로즈업일수록 픽셀당 실제 거리가 크므로 여유 픽셀이 더 필요
PERSON_EXTRA_PX = {
    ShotSize.CLOSEUP: (120, 60),
    ShotSize.MEDIUM:  (80,  45),
    ShotSize.WIDE:    (50,  30),
    ShotSize.UNKNOWN: (80,  45),
}

# Person Motion 매트 — 인물 동작 범위 커버 (별도 마스크)
# Tight와 목적이 다름: 인물이 팔을 최대로 벌렸을 때도 안에 들어오는 범위
# 상체(팔) 기준 좌우 대폭 확장, 하체는 발아래 소량만
# 샷 사이즈별 (좌우, 상하) — OUTPUT_SIZE 기준 px
PERSON_MOTION_PX = {
    ShotSize.CLOSEUP: (400, 80),   # 클로즈업: 화면 내 실거리가 크므로 더 넓게
    ShotSize.MEDIUM:  (320, 60),
    ShotSize.WIDE:    (220, 40),
    ShotSize.UNKNOWN: (320, 60),
}

# Wide 가비지 매트 파라미터
# 프레임 경계 접촉 판정 마진 (px) — 이 범위 안에 CC가 닿으면 엣지 접촉으로 판정
GARBAGE_EDGE_MARGIN_PX = 5
# Wide 매트 최종 팽창량 — 그린 경계 엣지 버퍼 (v4.0: 미사용, KILL_EXPAND_PX로 대체)
WIDE_EDGE_PX = 25
# KILL 영역 확장 마진 (OUTPUT_SIZE 기준 px)
# 경계 침범 세그먼트를 dilate → 장비 주변 그린 오염까지 공격적 제거
# base_mask 침범해도 최종 단계에서 복원되므로 세트는 항상 보호
KILL_EXPAND_PX = 40
# SAM2 엣지 포인트 샘플링 간격 (OUTPUT_SIZE 기준 px)
SAM2_EDGE_STEP_PX = 60
# YCbCr 그린 감지 파라미터 (HSV 대체)
YCBCR_CR_MAX = 120   # Cr < 120: 적색 성분 없음
YCBCR_CB_MAX = 120   # Cb < 120: 청색 성분 없음
YCBCR_Y_MIN  = 40    # Y > 40:   최소 밝기

# 탁자 상면 위쪽 팽창량 (OUTPUT_SIZE 기준 px)
# 탁자 상단 경계에서 위쪽으로만 팽창 → 꽃/소품 색상 무관하게 흡수
TABLE_TOP_EXPAND_PX = 80

# 러그/카펫 연결 감지용 팽창량 (OUTPUT_SIZE 기준 px)
# 의자 다리와 러그 사이 그림자/CC 분리를 커버하는 최소값
# (엣지 확장 아님 — build_base_mask Step 2 전용)
CARPET_CONNECT_PX = 20


# ──────────────────────────────────────────────────────────────
# 유틸 커널
# ──────────────────────────────────────────────────────────────

def _ellipse_kernel(px: int) -> np.ndarray:
    s = px * 2 + 1
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (s, s))


def _asymmetric_kernel(w_px: int, h_px: int) -> np.ndarray:
    return cv2.getStructuringElement(
        cv2.MORPH_ELLIPSE, (w_px * 2 + 1, h_px * 2 + 1))


def _scale(px: int, frame_h: int) -> int:
    """OUTPUT_SIZE 기준 px → 현재 해상도 스케일 변환."""
    return max(1, int(px * frame_h / OUTPUT_SIZE[1]))


# ──────────────────────────────────────────────────────────────
# 데이터 클래스
# ──────────────────────────────────────────────────────────────

@dataclass
class Detection:
    cls_id:   int
    cls_name: str
    bbox:     tuple
    mask:     np.ndarray  # uint8 (0 or 255), 원본 해상도


# ──────────────────────────────────────────────────────────────
# 1. YOLO 감지
# ──────────────────────────────────────────────────────────────

def run_yolo(image_bgr: np.ndarray,
             model: YOLO,
             conf_threshold: float = 0.25) -> list[Detection]:
    """전체 YOLO seg 결과를 Detection 리스트로 반환."""
    h, w = image_bgr.shape[:2]
    results = model(image_bgr, verbose=False, conf=conf_threshold)[0]
    detections = []
    if results.masks is None:
        return detections
    for i, cls_id in enumerate(results.boxes.cls.cpu().numpy().astype(int)):
        box = results.boxes.xyxy[i].cpu().numpy().astype(int)
        seg = results.masks.data[i].cpu().numpy()
        seg = cv2.resize(seg, (w, h), interpolation=cv2.INTER_LINEAR)
        seg = (seg > 0.5).astype(np.uint8) * 255
        detections.append(Detection(
            cls_id=cls_id, cls_name=model.names[cls_id],
            bbox=tuple(box), mask=seg))
    return detections


def get_person_detections(detections: list[Detection]) -> list[Detection]:
    return [d for d in detections if d.cls_id == 0]


def get_furniture_detections(detections: list[Detection]) -> list[Detection]:
    return [d for d in detections if d.cls_id in FURNITURE_CLASSES]


# ──────────────────────────────────────────────────────────────
# 2. 샷 사이즈 자동 감지
# ──────────────────────────────────────────────────────────────

def detect_shot_size(persons: list[Detection],
                     frame_shape: tuple) -> ShotSize:
    """
    person seg 마스크 기반 샷 사이즈 판단.

    bbox 높이는 외부 장비/CC 오염에 취약하므로
    실제 person 마스크의 픽셀 분포를 사용:
      - 마스크 최상단/최하단 픽셀 위치로 실질적인 높이 계산
      - 하단 25% 프레임에 픽셀이 존재하면 전신(feet visible) 판정
    """
    if not persons:
        return ShotSize.UNKNOWN

    fh = frame_shape[0]
    p  = max(persons, key=lambda d: d.bbox[3] - d.bbox[1])

    # bbox 대신 마스크 픽셀 범위 사용
    ys = np.where(p.mask > 0)[0]
    if len(ys) == 0:
        return ShotSize.UNKNOWN

    mask_top    = ys.min()
    mask_bottom = ys.max()
    ratio       = (mask_bottom - mask_top) / fh
    feet_visible = mask_bottom >= fh * 0.75   # 하단 25% 안에 발이 있으면 전신

    if ratio >= SHOT_RATIO_WIDE and feet_visible:
        return ShotSize.WIDE
    elif ratio >= SHOT_RATIO_MEDIUM:
        return ShotSize.MEDIUM
    else:
        return ShotSize.CLOSEUP


# ──────────────────────────────────────────────────────────────
# 3. Safe Zone
# ──────────────────────────────────────────────────────────────

def build_safe_zone_mask(shot_size: ShotSize,
                         frame_shape: tuple) -> np.ndarray:
    fh, fw = frame_shape[:2]
    z  = SAFE_ZONE[shot_size]
    x1 = int(z["x"] * fw);        y1 = int(z["y"] * fh)
    x2 = int((z["x"]+z["w"])*fw); y2 = int((z["y"]+z["h"])*fh)
    mask = np.zeros((fh, fw), dtype=np.uint8)
    cv2.rectangle(mask, (x1, y1), (x2, y2), 255, cv2.FILLED)
    return mask


# ──────────────────────────────────────────────────────────────
# 4. 그린스크린 감지
# ──────────────────────────────────────────────────────────────

def detect_green(image_bgr: np.ndarray,
                 hue_lo:  int = 35,
                 hue_hi:  int = 85,
                 sat_min: int = 25,
                 val_min: int = 25) -> np.ndarray:
    """
    YCbCr 기반 그린스크린 픽셀 마스크 반환. (v4.0: HSV → YCbCr)

    YCbCr 선택 이유:
      - 방송 업계 표준 색공간, 조명 변화에 강함
      - Cr/Cb 채널이 적색/청색 성분을 독립적으로 분리
      - 그린스크린 특성: Cr 낮음(적색 없음) + Cb 낮음(청색 없음) + Y 충분
      - HSV 대비 조명 스필/하이라이트 오탐 감소
    hue_lo, hue_hi, sat_min, val_min: 하위 호환용 (내부에서 미사용)

    hole fill (M2+M3): 원본과 동일 로직 유지.
    """
    ycbcr = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2YCrCb)
    Y, Cr, Cb = ycbcr[:, :, 0], ycbcr[:, :, 1], ycbcr[:, :, 2]

    green = (
        (Cr < YCBCR_CR_MAX) &
        (Cb < YCBCR_CB_MAX) &
        (Y  > YCBCR_Y_MIN)
    ).astype(np.uint8) * 255

    k     = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
    green = cv2.morphologyEx(green, cv2.MORPH_CLOSE, k, iterations=2)
    non_green = cv2.bitwise_not(green)

    # M2: 컨투어 계층 기반 내부 구멍 채우기
    holes_m2  = np.zeros_like(non_green)
    contours, hierarchy = cv2.findContours(
        non_green, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    if hierarchy is not None:
        for i, h_item in enumerate(hierarchy[0]):
            if h_item[3] != -1:
                cv2.drawContours(holes_m2, contours, i, 255, cv2.FILLED)

    # M3: 프레임 외부와 연결되지 않은 검은 구멍 채우기
    padded = cv2.copyMakeBorder(non_green, 1, 1, 1, 1,
                                cv2.BORDER_CONSTANT, value=0)
    flood  = padded.copy()
    cv2.floodFill(flood, None, (0, 0), 255)
    flood    = flood[1:-1, 1:-1]
    holes_m3 = cv2.bitwise_and(cv2.bitwise_not(non_green),
                               cv2.bitwise_not(flood))

    all_holes = cv2.bitwise_or(holes_m2, holes_m3)
    non_green = cv2.bitwise_or(non_green, all_holes)
    return cv2.bitwise_not(non_green)


def get_non_green_mask(green_mask: np.ndarray) -> np.ndarray:
    return cv2.bitwise_not(green_mask)


# ──────────────────────────────────────────────────────────────
# 5. 베이스 마스크 생성 (YOLO + HSV CC 직접 겹침)
# ──────────────────────────────────────────────────────────────

def build_base_mask(anchor_mask: np.ndarray,
                    candidate_masks: list[np.ndarray],
                    non_green: np.ndarray) -> np.ndarray:
    """
    YOLO seg 마스크 + HSV non_green CC 겹침 → 베이스 마스크 확정.

    Step 1: YOLO 후보(의자/탁자/소품) 무조건 Union
      - YOLO가 감지한 것은 HSV 색상 무관하게 항상 포함
      - 꽃처럼 그린과 유사한 소품도 YOLO가 잡으면 살림

    Step 2: YOLO 통합 마스크를 소량 팽창(CARPET_CONNECT_PX) 후
            겹치는 non_green CC 통째 흡수
      - 러그는 YOLO 미인식이므로 HSV CC만 의존
      - 의자 다리 하단이 러그 위에 있으면 직접 겹치지만
        그림자/조명으로 CC가 분리된 경우를 위해 소량 팽창 허용
      - CARPET_CONNECT_PX는 연결 감지 전용 (엣지 확장 아님)

    Step 3: 구멍 채우기
    """
    fh = anchor_mask.shape[0]

    # Step 1: anchor와 연결된 YOLO 후보 무조건 Union
    yolo_mask  = anchor_mask.copy()
    merge_px   = _scale(60, fh)
    anchor_exp = cv2.dilate(anchor_mask, _ellipse_kernel(merge_px))
    for cand in candidate_masks:
        if cv2.bitwise_and(anchor_exp, cand).any():
            yolo_mask = cv2.bitwise_or(yolo_mask, cand)

    # Step 2: HSV non_green CC 겹침 흡수
    # 소량 팽창(20px)으로 러그처럼 CC가 분리된 경우도 커버
    carpet_px  = _scale(CARPET_CONNECT_PX, fh)
    yolo_exp   = cv2.dilate(yolo_mask, _ellipse_kernel(carpet_px))

    num, labels, _, _ = cv2.connectedComponentsWithStats(
        non_green, connectivity=8)
    base = yolo_mask.copy()
    for i in range(1, num):
        cc = (labels == i).astype(np.uint8) * 255
        if cv2.bitwise_and(cc, yolo_exp).any():
            base = cv2.bitwise_or(base, cc)

    # Step 3: 구멍 채우기
    contours, _ = cv2.findContours(base, cv2.RETR_EXTERNAL,
                                   cv2.CHAIN_APPROX_SIMPLE)
    cv2.drawContours(base, contours, -1, 255, cv2.FILLED)
    return base


# ──────────────────────────────────────────────────────────────
# 6. 중앙 연결성 필터 (person 부재 시 anchor 추출)
# ──────────────────────────────────────────────────────────────

def filter_center_connected(mask: np.ndarray) -> np.ndarray:
    """CC 중 화면 중앙에 가깝고 큰 덩어리만 남김."""
    if not mask.any():
        return mask
    fh, fw = mask.shape
    cx, cy = fw / 2, fh / 2
    diag   = np.sqrt(fw**2 + fh**2)
    num, labels, stats, centroids = cv2.connectedComponentsWithStats(
        mask, connectivity=8)
    if num <= 1:
        return mask
    scores = []
    for i in range(1, num):
        area  = stats[i, cv2.CC_STAT_AREA]
        dist  = np.sqrt((centroids[i][0]-cx)**2 + (centroids[i][1]-cy)**2)
        scores.append((i, area / (dist/diag + 0.1), area))
    scores.sort(key=lambda x: x[1], reverse=True)
    top_score, top_area = scores[0][1], scores[0][2]
    result = np.zeros_like(mask)
    for lid, score, area in scores:
        if score >= top_score * 0.30 or area >= top_area * 0.15:
            result[labels == lid] = 255
    return result


# ──────────────────────────────────────────────────────────────
# 7. 분기별 파이프라인
# ──────────────────────────────────────────────────────────────

def pipeline_with_person(
        persons: list[Detection],
        detections: list[Detection],
        non_green: np.ndarray
) -> tuple[np.ndarray, np.ndarray, np.ndarray | None, ShotSize]:
    """
    Returns: (base_mask, person_mask, table_mask, shot_size)
    table_mask: dining table YOLO 마스크 (없으면 None)
    """
    shot_size   = detect_shot_size(persons, non_green.shape)
    person_mask = np.zeros(non_green.shape[:2], dtype=np.uint8)
    for p in persons:
        person_mask = cv2.bitwise_or(person_mask, p.mask)
    candidate_masks = [d.mask for d in detections if d.cls_id != 0]
    base = build_base_mask(person_mask, candidate_masks, non_green)

    # 탁자 마스크 추출 (dining table cls=60)
    tables = [d for d in detections if d.cls_id == 60]
    table_mask = None
    if tables:
        table_mask = np.zeros(non_green.shape[:2], dtype=np.uint8)
        for t in tables:
            table_mask = cv2.bitwise_or(table_mask, t.mask)

    return base, person_mask, table_mask, shot_size


def pipeline_without_person(
        detections: list[Detection],
        non_green: np.ndarray
) -> tuple[np.ndarray, None, ShotSize]:
    furniture = get_furniture_detections(detections)
    if furniture:
        furn_mask = np.zeros(non_green.shape[:2], dtype=np.uint8)
        for f in furniture:
            furn_mask = cv2.bitwise_or(furn_mask, f.mask)
        anchor = filter_center_connected(furn_mask)
    else:
        anchor = filter_center_connected(non_green)
    base = build_base_mask(anchor, [], non_green)
    return base, None, ShotSize.UNKNOWN


# ──────────────────────────────────────────────────────────────
# 8. 매트 생성
# ──────────────────────────────────────────────────────────────

def generate_tight_matte(base_mask: np.ndarray,
                          person_mask: np.ndarray | None,
                          table_mask: np.ndarray | None,
                          shot_size: ShotSize) -> np.ndarray:
    """
    Tight 매트 생성.
    1. 베이스 전체 균일 팽창 (BASE_EDGE_PX)
    2. person 비대칭 팽창 — 좌우 > 상하, 클로즈업일수록 크게
    3. 탁자 상면 위쪽 팽창 (TABLE_TOP_EXPAND_PX)
       - 탁자 마스크 상단 경계에서 위쪽으로만 팽창
       - 꽃/소품이 그린색이어도, YOLO 미감지여도 흡수
    4. Union → 구멍 채우기
    """
    fh    = base_mask.shape[0]
    tight = cv2.dilate(base_mask, _ellipse_kernel(_scale(BASE_EDGE_PX, fh)))

    # person 비대칭 팽창
    if person_mask is not None and person_mask.any():
        lr_px, tb_px = PERSON_EXTRA_PX[shot_size]
        person_exp   = cv2.dilate(person_mask,
                                  _asymmetric_kernel(_scale(lr_px, fh),
                                                     _scale(tb_px, fh)))
        tight = cv2.bitwise_or(tight, person_exp)

    # 탁자 상면 위쪽 팽창
    if table_mask is not None and table_mask.any():
        expand_px = _scale(TABLE_TOP_EXPAND_PX, fh)
        # 위쪽으로만 팽창하는 커널: 높이만 있고 아래쪽은 1px
        k_up = np.zeros((expand_px * 2 + 1, expand_px * 2 + 1), dtype=np.uint8)
        k_up[:expand_px + 1, expand_px] = 1  # 중앙 열의 위쪽 절반만
        # 더 넓은 범위를 커버하려면 타원형으로
        k_up = np.zeros((expand_px + 1, expand_px * 2 + 1), dtype=np.uint8)
        cv2.ellipse(k_up, (expand_px, expand_px),
                    (expand_px, expand_px), 0, 180, 360, 1, cv2.FILLED)
        table_exp = cv2.dilate(table_mask, k_up)
        tight = cv2.bitwise_or(tight, table_exp)

    contours, _ = cv2.findContours(tight, cv2.RETR_EXTERNAL,
                                   cv2.CHAIN_APPROX_SIMPLE)
    result = np.zeros_like(tight)
    cv2.drawContours(result, contours, -1, 255, cv2.FILLED)
    return result


def generate_person_motion_matte(person_mask: np.ndarray | None,
                                  base_mask: np.ndarray,
                                  shot_size: ShotSize) -> np.ndarray | None:
    """
    Person Motion 매트 — Tight와 별도 출력.

    목적: 인물이 팔을 최대로 벌리거나 상체를 좌우로 기울여도
          마스크 안에 포함되는 동작 범위 마스크.

    Tight와 차이:
      Tight  = 소품/카펫/인물 실루엣 기반, 정밀하고 작게
      Motion = 인물 마스크만 기반, 동작 가능 범위를 크게 커버

    구성:
      1. person 마스크 대폭 비대칭 팽창 (PERSON_MOTION_PX, 좌우 >> 상하)
      2. base_mask Union (소품/카펫 포함)
      3. 구멍 채우기

    person 없으면 None 반환 → 저장 스킵.
    """
    if person_mask is None or not person_mask.any():
        return None

    fh = person_mask.shape[0]
    lr_px, tb_px = PERSON_MOTION_PX[shot_size]
    motion = cv2.dilate(person_mask,
                        _asymmetric_kernel(_scale(lr_px, fh),
                                           _scale(tb_px, fh)))
    motion = cv2.bitwise_or(motion, base_mask)

    contours, _ = cv2.findContours(motion, cv2.RETR_EXTERNAL,
                                   cv2.CHAIN_APPROX_SIMPLE)
    result = np.zeros_like(motion)
    cv2.drawContours(result, contours, -1, 255, cv2.FILLED)
    return result


def _fill_internal_holes(mask: np.ndarray) -> np.ndarray:
    """
    외부와 연결된 void는 유지, 완전히 둘러싸인 내부 구멍만 채운다.
    프레임 외부에서 flood-fill → 외부 연결 void 표시 → 나머지가 내부 구멍.
    """
    inv    = cv2.bitwise_not(mask)
    padded = cv2.copyMakeBorder(inv, 1, 1, 1, 1, cv2.BORDER_CONSTANT, value=0)
    flood  = padded.copy()
    cv2.floodFill(flood, None, (0, 0), 128)
    flood    = flood[1:-1, 1:-1]
    internal = (flood == 255).astype(np.uint8) * 255
    return cv2.bitwise_or(mask, internal)


def _sample_edge_points(H: int, W: int) -> list[tuple[int, int]]:
    """프레임 4변을 따라 SAM2_EDGE_STEP_PX 간격으로 포인트 샘플링."""
    sx    = max(1, int(SAM2_EDGE_STEP_PX * W / OUTPUT_SIZE[0]))
    sy    = max(1, int(SAM2_EDGE_STEP_PX * H / OUTPUT_SIZE[1]))
    inset = 2
    pts   = set()
    for x in range(0, W, sx):
        pts.add((x, inset));         pts.add((x, H - 1 - inset))
    for y in range(0, H, sy):
        pts.add((inset, y));         pts.add((W - 1 - inset, y))
    return list(pts)


def _build_kill_mask_sam2(image_bgr: np.ndarray, base_mask: np.ndarray,
                           predictor: "SAM2ImagePredictor") -> np.ndarray:
    """
    SAM2 point prompt 모드: 경계 포인트 → 세그먼트 추출 → KILL 마스크 생성.

    SAM2는 색상 무관 물체 단위로 분리하므로
    그린스크린에 연결된 장비 영역도 별도 세그먼트로 추출 가능.
    """
    H, W  = image_bgr.shape[:2]
    rgb   = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
    pts   = _sample_edge_points(H, W)

    predictor.set_image(rgb)

    kill_mask  = np.zeros((H, W), dtype=np.uint8)
    seen_masks = []

    for (x, y) in pts:
        point_coords = np.array([[x, y]], dtype=np.float32)
        point_labels = np.array([1],      dtype=np.int32)

        with torch.inference_mode():
            masks, _, _ = predictor.predict(
                point_coords=point_coords,
                point_labels=point_labels,
                multimask_output=False,
            )
        seg = masks[0].astype(bool)

        # 중복 제거 (IoU > 0.8)
        is_dup = any(
            (seg & s).sum() / max((seg | s).sum(), 1) > 0.8
            for s in seen_masks
        )
        if is_dup:
            continue
        seen_masks.append(seg)

        seg_u8 = seg.astype(np.uint8) * 255
        ys, xs = np.where(seg)
        if len(ys) == 0:
            continue

        # 경계 접촉 판정
        margin = GARBAGE_EDGE_MARGIN_PX
        if not (ys.min() <= margin or xs.min() <= margin or
                ys.max() >= H - margin or xs.max() >= W - margin):
            continue

        # base_mask 보호
        if cv2.bitwise_and(seg_u8, base_mask).any():
            continue

        # KILL 확장 (공격적 제거)
        exp_px    = _scale(KILL_EXPAND_PX, H)
        seg_exp   = cv2.dilate(seg_u8, _ellipse_kernel(exp_px))
        kill_mask = cv2.bitwise_or(kill_mask, seg_exp)

    return kill_mask


def _build_kill_mask_fallback(image_bgr: np.ndarray,
                               base_mask: np.ndarray) -> np.ndarray:
    """
    SAM2 미설치 시 YCbCr non_green CC 기반 폴백.
    한계: 그린스크린에 연결된 장비는 CC 분리 불가 → SAM2보다 정확도 낮음.
    """
    H, W      = image_bgr.shape[:2]
    non_green = cv2.bitwise_not(detect_green(image_bgr))
    kill_mask = np.zeros((H, W), dtype=np.uint8)
    margin    = GARBAGE_EDGE_MARGIN_PX

    num, labels, stats, _ = cv2.connectedComponentsWithStats(non_green, 8)
    for i in range(1, num):
        x = stats[i, cv2.CC_STAT_LEFT];  y = stats[i, cv2.CC_STAT_TOP]
        w = stats[i, cv2.CC_STAT_WIDTH]; h = stats[i, cv2.CC_STAT_HEIGHT]
        if not (x <= margin or y <= margin or
                x + w >= W - margin or y + h >= H - margin):
            continue
        cc = (labels == i).astype(np.uint8) * 255
        if cv2.bitwise_and(cc, base_mask).any():
            continue
        exp_px    = _scale(KILL_EXPAND_PX, H)
        cc_exp    = cv2.dilate(cc, _ellipse_kernel(exp_px))
        kill_mask = cv2.bitwise_or(kill_mask, cc_exp)

    return kill_mask


def generate_wide_matte(base_mask: np.ndarray,
                         green_mask: np.ndarray,
                         non_green: np.ndarray,
                         image_bgr: np.ndarray = None,
                         sam2_predictor=None) -> np.ndarray:
    """
    Wide 가비지 매트 생성. (v4.0)

    전략: 프레임 전체 WHITE → 경계 침범 세그먼트 KILL → base_mask 복원
    (v3 방식: 그린 CC 기반 KEEP → 한계: 그린에 연결된 장비 제거 불가)

    SAM2 모드 (sam2_predictor 제공 시):
      색상 무관 물체 단위 세그먼트 → 그린 연결 장비도 제거 가능
    폴백 모드 (sam2_predictor=None):
      YCbCr non_green CC 기반 → 기존보다 개선되나 SAM2보다 정확도 낮음

    KILL 흐름:
      1. 경계 접촉 세그먼트 추출 (SAM2 or CC)
      2. base_mask 비겹침 조건으로 세트 보호
      3. KILL_EXPAND_PX 만큼 dilate (공격적: 장비 주변 그린 오염 포함)
      4. wide = WHITE - kill_expanded
      5. base_mask 복원 (KILL 확장이 침범해도 세트 항상 살림)
      6. 내부 구멍 채우기 → kill 재복원 → base 재복원

    green_mask, non_green: 하위 호환용 (내부에서 미사용)
    image_bgr: SAM2/폴백 모드에 필요. None이면 base_mask만으로 동작 불가
    """
    if image_bgr is None:
        # image_bgr 미제공 시 base_mask 단순 팽창으로 폴백 (최소 동작 보장)
        H, W = base_mask.shape[:2]
        wide = cv2.dilate(base_mask, _ellipse_kernel(_scale(WIDE_EDGE_PX, H)))
        return _fill_internal_holes(wide)

    H, W = image_bgr.shape[:2]

    # KILL 마스크 생성
    if sam2_predictor is not None:
        kill_mask = _build_kill_mask_sam2(image_bgr, base_mask, sam2_predictor)
    else:
        kill_mask = _build_kill_mask_fallback(image_bgr, base_mask)

    # wide = 전체 WHITE - kill
    wide = np.full((H, W), 255, dtype=np.uint8)
    wide = cv2.bitwise_and(wide, cv2.bitwise_not(kill_mask))
    wide = cv2.bitwise_or(wide, base_mask)           # base 복원

    # 내부 구멍 채우기 → kill 재복원 → base 재복원
    wide = _fill_internal_holes(wide)
    wide = cv2.bitwise_and(wide, cv2.bitwise_not(kill_mask))
    wide = cv2.bitwise_or(wide, base_mask)

    return wide


# ──────────────────────────────────────────────────────────────
# 9. I/O 유틸리티
# ──────────────────────────────────────────────────────────────

def to_output_size(mask: np.ndarray) -> np.ndarray:
    r = cv2.resize(mask, OUTPUT_SIZE, interpolation=cv2.INTER_LINEAR)
    _, b = cv2.threshold(r, 127, 255, cv2.THRESH_BINARY)
    return b


def save_png_8bit(mask_8bit: np.ndarray, path: Path):
    cv2.imwrite(str(path), mask_8bit)
    print(f"  저장: {path}")


def save_debug(image_bgr, green_mask, base_mask,
               tight_matte, motion_matte, wide_matte,
               shot_size, has_person, debug_dir, stem):
    debug_dir.mkdir(parents=True, exist_ok=True)
    fh, fw = image_bgr.shape[:2]
    tight_r = cv2.resize(tight_matte, (fw, fh))
    base_r  = cv2.resize(base_mask,   (fw, fh))

    cv2.imwrite(str(debug_dir / f"{stem}_01_green.png"), green_mask)
    cv2.imwrite(str(debug_dir / f"{stem}_02_base.png"),  base_r)
    cv2.imwrite(str(debug_dir / f"{stem}_03_tight.png"), tight_r)
    if motion_matte is not None:
        motion_r = cv2.resize(motion_matte, (fw, fh))
        cv2.imwrite(str(debug_dir / f"{stem}_03b_motion.png"), motion_r)
    if wide_matte is not None:
        wide_r = cv2.resize(wide_matte, (fw, fh))
        cv2.imwrite(str(debug_dir / f"{stem}_04_wide.png"), wide_r)

    vis = image_bgr.astype(np.float32)
    if wide_matte is not None:
        vis[wide_r  > 0] = vis[wide_r  > 0] * 0.65 + np.array([0,  60, 0 ]) * 0.35
    vis[tight_r > 0] = vis[tight_r > 0] * 0.65 + np.array([60, 0,  0 ]) * 0.35
    if motion_matte is not None:
        vis[motion_r > 0] = vis[motion_r > 0] * 0.65 + np.array([0, 0, 80]) * 0.35
    vis[base_r  > 0] = vis[base_r  > 0] * 0.65 + np.array([0,  0,  60]) * 0.35

    mode  = f"{'PERSON' if has_person else 'NO-PERSON'} | {shot_size.value.upper()}"
    color = (0, 220, 80) if has_person else (0, 140, 255)
    cv2.putText(vis, mode, (20, 45), cv2.FONT_HERSHEY_SIMPLEX, 1.2, color, 2)
    cv2.imwrite(str(debug_dir / f"{stem}_05_overlay.jpg"), vis.astype(np.uint8))
    print(f"  디버그: {debug_dir} [{mode}]")


# ──────────────────────────────────────────────────────────────
# 10. 메인 파이프라인
# ──────────────────────────────────────────────────────────────

def process(input_path: Path, output_dir: Path, model: YOLO,
            conf_threshold: float, debug: bool,
            prev_base_mask: np.ndarray = None,
            sam2_predictor=None,
            with_motion: bool = False,
            with_wide: bool = False) -> np.ndarray:
    """
    단일 이미지 처리.
    기본: tight matte만 생성 (YOLO만 사용, ~1s/frame).
    with_motion: True이면 motion matte 추가 생성.
    with_wide:   True이면 wide matte 추가 생성 (SAM2 또는 YCbCr 폴백).
    prev_base_mask: person 일시 부재 시 이전 프레임 재사용.
    """
    import time

    def _t(label: str, t0: float) -> float:
        elapsed = time.time() - t0
        print(f"  [{elapsed:5.2f}s] {label}")
        return time.time()

    image = cv2.imread(str(input_path))
    if image is None:
        print(f"[SKIP] 로드 실패: {input_path}")
        return prev_base_mask

    stem   = input_path.stem
    fh, fw = image.shape[:2]
    t_start = time.time()

    outputs = ["tight"]
    if with_motion: outputs.append("motion")
    if with_wide:   outputs.append("wide")
    print(f"\n[처리] {input_path.name}  ({fw}x{fh})  [{'+'.join(outputs)}]")

    t0 = time.time()
    detections = run_yolo(image, model, conf_threshold)
    green_mask = detect_green(image)
    non_green  = get_non_green_mask(green_mask)
    persons    = get_person_detections(detections)
    t0 = _t("YOLO + 그린감지", t0)

    if persons:
        print(f"  person 감지: {len(persons)}명")
        base_mask, person_mask, table_mask, shot_size = pipeline_with_person(
            persons, detections, non_green)
        has_person = True

    elif prev_base_mask is not None:
        print(f"  person 없음 → 이전 프레임 재사용")
        base_mask = cv2.resize(prev_base_mask, (fw, fh),
                               interpolation=cv2.INTER_LINEAR)
        _, base_mask = cv2.threshold(base_mask, 127, 255, cv2.THRESH_BINARY)
        person_mask  = None
        table_mask   = None
        shot_size    = ShotSize.UNKNOWN
        has_person   = False

    else:
        print(f"  person 없음 → 중앙 소품 anchor 모드")
        base_mask, person_mask, shot_size = pipeline_without_person(
            detections, non_green)
        table_mask = None
        has_person = False

    t0 = _t("base_mask 생성", t0)

    safe_zone = build_safe_zone_mask(shot_size, image.shape)
    base_mask = cv2.bitwise_and(base_mask, safe_zone)

    # ── tight (항상 생성) ──────────────────────────────────────
    tight_matte = generate_tight_matte(base_mask, person_mask, table_mask, shot_size)
    t0 = _t("tight matte", t0)

    output_dir.mkdir(parents=True, exist_ok=True)
    save_png_8bit(to_output_size(tight_matte), output_dir / f"{stem}_tight_matte.png")

    # ── motion (선택) ──────────────────────────────────────────
    motion_matte = None
    if with_motion:
        motion_matte = generate_person_motion_matte(person_mask, base_mask, shot_size)
        t0 = _t("motion matte", t0)
        if motion_matte is not None:
            save_png_8bit(to_output_size(motion_matte),
                          output_dir / f"{stem}_motion_matte.png")

    # ── wide (선택) ────────────────────────────────────────────
    wide_matte = None
    if with_wide:
        wide_matte = generate_wide_matte(base_mask, green_mask, non_green,
                                          image_bgr=image, sam2_predictor=sam2_predictor)
        mode = "SAM2" if sam2_predictor is not None else "폴백"
        t0 = _t(f"wide matte ({mode})", t0)
        save_png_8bit(to_output_size(wide_matte), output_dir / f"{stem}_wide_matte.png")

    t0 = _t("저장", t0)

    if debug:
        save_debug(image, green_mask, base_mask,
                   to_output_size(tight_matte),
                   to_output_size(motion_matte) if motion_matte is not None else None,
                   to_output_size(wide_matte)   if wide_matte   is not None else None,
                   shot_size, has_person, output_dir / "debug", stem)
        _t("디버그 저장", t0)

    total = time.time() - t_start
    print(f"  ──────────────────────────────")
    print(f"  총 소요: {total:.2f}s")

    return base_mask


def load_sam2_predictor(checkpoint: str, config: str):
    """SAM2 모델 로드. 미설치 시 None 반환."""
    if not SAM2_AVAILABLE:
        print("[경고] SAM2 미설치 → YCbCr CC 폴백 모드")
        return None
    device     = "cuda" if torch.cuda.is_available() else \
                 ("mps"  if torch.backends.mps.is_available() else "cpu")
    sam2_model = build_sam2(config, checkpoint, device=device)
    predictor  = SAM2ImagePredictor(sam2_model)
    print(f"SAM2 로드 완료: {checkpoint} ({device})")
    return predictor


def main():
    parser = argparse.ArgumentParser(
        description="Project-Melies: Garbage Matte Generator v4.1",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
출력 타입 (기본: tight만 생성):
  (기본)              tight matte만 생성  ~1s/frame
  --motion            tight + motion matte
  --wide              tight + wide matte (SAM2 or YCbCr 폴백)
  --motion --wide     tight + motion + wide (전체)

예시:
  python garbage_matte_gen.py input.png
  python garbage_matte_gen.py input.png --motion
  python garbage_matte_gen.py input.png --wide --sam2 --checkpoint sam2_hiera_small.pt
  python garbage_matte_gen.py input.png --motion --wide --sam2 --checkpoint sam2_hiera_small.pt
        """)
    parser.add_argument("input",  help="입력 이미지 또는 디렉터리")
    parser.add_argument("--output", "-o", default="output")
    parser.add_argument("--model",  default="yolov8n-seg.pt")
    parser.add_argument("--conf",   type=float, default=0.25)
    parser.add_argument("--debug",  action="store_true")
    # 출력 타입 플래그 (additive)
    parser.add_argument("--motion", action="store_true",
                        help="motion matte 추가 생성")
    parser.add_argument("--wide",   action="store_true",
                        help="wide matte 추가 생성 (SAM2 또는 YCbCr 폴백)")
    # SAM2 옵션 (--wide 사용 시에만 유효)
    parser.add_argument("--sam2",        action="store_true",
                        help="wide matte에 SAM2 사용 (--wide 필요)")
    parser.add_argument("--checkpoint",  default="sam2_hiera_small.pt",
                        help="SAM2 체크포인트 경로")
    parser.add_argument("--sam2_config", default="sam2_hiera_s.yaml",
                        help="SAM2 모델 설정 yaml")

    args    = parser.parse_args()
    in_path = Path(args.input)
    out_dir = Path(args.output)

    print(f"모델 로드: {args.model}")
    model = YOLO(args.model)

    sam2_predictor = None
    if args.wide and args.sam2:
        sam2_predictor = load_sam2_predictor(args.checkpoint, args.sam2_config)
    elif args.sam2 and not args.wide:
        print("[경고] --sam2는 --wide 없이 사용 불가 — 무시됨")

    IMAGE_EXTS = {'.jpg', '.jpeg', '.png', '.tif', '.tiff', '.bmp'}

    if in_path.is_dir():
        files = sorted(f for f in in_path.iterdir()
                       if f.suffix.lower() in IMAGE_EXTS)
        print(f"배치 처리: {len(files)}개 이미지")
        prev = None
        for f in files:
            prev = process(f, out_dir, model, args.conf, args.debug, prev,
                           sam2_predictor, args.motion, args.wide)
    else:
        process(in_path, out_dir, model, args.conf, args.debug,
                sam2_predictor=sam2_predictor,
                with_motion=args.motion,
                with_wide=args.wide)

    print("\n완료.")


if __name__ == "__main__":
    main()