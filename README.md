# Garbage Matte Editor

AI-assisted garbage matte editor for virtual studio production. Part of **Project Méliès** by Magic Hour Inc.

Generates and refines garbage mattes using YOLO segmentation, with a browser-based editor for manual touch-up. Designed for chroma key workflows with Ultimatte and similar compositors.

## Quick Start

```bash
git clone https://github.com/moondive-cinema/gbg-mat-editor.git
cd gbg-mat-editor
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Place `yolov8n-seg.pt` in the project root, then:

```bash
python run.py
```

Browser opens automatically at `http://localhost:5555`.

## Usage

```bash
python run.py                              # default
python run.py --port 8080                  # custom port
python run.py --watch ~/Screenshots        # auto-load new images from folder
python run.py --model yolov8x-seg.pt       # use a different YOLO model
```

## Features

- **AI Mask Generation** — YOLO-based person/object segmentation with green screen detection
- **Brush Editor** — Keep/Kill brush with adjustable size for manual refinement
- **Crop** — Per-side percentage crop with visual overlay
- **Morph** — Expand/contract mask edges (separable dilate/erode)
- **Round Edge / Soft Edge** — Feather and blur mask boundaries
- **Video Stream** — Webcam or video file input with live preview and frame capture
- **Watch Folder** — Auto-load latest image from a monitored directory
- **TIFF Support** — Native uncompressed TIFF decoding (8/16-bit, RGB/Grayscale)
- **Save** — Exports matte + reference overlay PNG to configured output directory

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Ctrl+O` | Open media |
| `Ctrl+G` | Generate AI mask |
| `Ctrl+S` | Save |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Undo / Redo |
| `Ctrl+P` | Toggle video stream |
| `Q` | Stream smart action (toggle / live / capture) |
| `B` / `C` | Brush / Crop mode |
| `X` | Toggle Keep / Kill |
| `S` / `D` or `[` / `]` | Brush size ±5px |
| `W` / `E` | Morph contract / expand |
| `F` | Fit view |
| `O` | Open media |

Korean keyboard layout (ㅂ, ㅈ, ㄷ, etc.) is also supported.

## Project Structure

```
gbg-mat-editor/
├── run.py                  # Entry point
├── server/
│   ├── app.py              # Flask routes
│   ├── state.py            # Runtime state (model, config)
│   └── config.py           # Config file management
├── client/                 # Frontend source (Vite + React)
│   ├── src/
│   │   ├── App.jsx
│   │   ├── constants.js
│   │   ├── components/     # Toolbar, panels, folder picker
│   │   └── utils/          # Image processing, color utils
│   ├── package.json
│   └── vite.config.js
├── dist/                   # Built frontend (committed)
├── tests/                  # pytest API tests
├── garbage_matte_gen.py    # Core matte generation pipeline
└── requirements.txt
```

## Development

Frontend changes require Node.js:

```bash
cd client
npm install
npm run dev         # Dev server at localhost:5173 (proxies API to :5555)
```

In a separate terminal:

```bash
python run.py       # API server at localhost:5555
```

After changes, rebuild:

```bash
cd client
npm run build       # Outputs to dist/
```

Run backend tests:

```bash
python -m pytest tests/ -v
```

## Requirements

- Python 3.10+
- YOLO model file (`yolov8n-seg.pt` or similar)
- Node.js 18+ (for frontend development only)

## License

Proprietary — Magic Hour Inc.
