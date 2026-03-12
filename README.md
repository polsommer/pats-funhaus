# Pi Media Gallery

A lightweight FastAPI-powered gallery designed for Raspberry Pi 4. It serves images and videos from a configurable `media/` directory, offers authenticated uploads, and ships with a responsive web UI tuned for low-dependency deployments.

## Features
- REST API for listing and retrieving media from the local filesystem
- Authenticated uploads via `X-Upload-Token` header with file type safeguards and optional size limits
- Responsive grid gallery with thumbnail previews, modal/lightbox, and inline video playback
- Minimal dependencies suitable for ARM SBCs

## Quickstart

### Prerequisites
Install a Python runtime with venv support, FFmpeg for derivative generation, and a tool for downloads:
- Debian/Ubuntu: `sudo apt-get update && sudo apt-get install -y python3 python3-venv python3-pip curl ffmpeg`
- Fedora: `sudo dnf install -y python3 python3-venv python3-pip curl ffmpeg`
- macOS (Homebrew): `brew install python curl ffmpeg`

### Guided script (fastest)
```bash
./quickstart.sh
```
The script prompts for your upload token, media directory, host, and port, sets up a virtual environment, installs dependencies, and optionally starts Uvicorn immediately. Run it from the repo root. Use `AUTO_START=no ./quickstart.sh` to skip the auto-start prompt.

### Manual setup
```bash
cd app
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export UPLOAD_TOKEN=changeme
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Visit `http://localhost:8000` for the gallery UI. Media is stored under `app/media` by default; override with `MEDIA_DIR`.

Environment knobs:
- `MAX_UPLOAD_BYTES`: optional upload cap in bytes. Default is `0` (no limit, useful for very large videos). Set a positive value to enforce a limit.
- `DERIVATIVES_DIR`: where generated thumbnails/posters/stream files are written (default: `<MEDIA_DIR>/.derivatives`).
- `ENABLE_VIDEO_DERIVATIVES`: set to `false` to skip H.264 stream derivative generation.
- `MAX_DERIVATIVE_WIDTH`: max width of generated previews/streams while preserving aspect ratio (default: `1280`).
- `TARGET_VIDEO_BITRATE`: ffmpeg bitrate target for generated H.264 stream assets (default: `2500k`).
- `ENABLE_AI_UPSCALER`: enable async upscaler jobs (`false` by default).
- `UPSCALER_BACKEND`: backend adapter name (`none` = copy-only fallback, `pil` = Pillow resize when installed).
- `UPSCALER_MODEL_PATH`: optional model path for external backends.
- `UPSCALER_USE_GPU` / `UPSCALER_FORCE_CPU`: runtime toggles for backend implementations.
- `UPSCALER_WORKER_CONCURRENCY`: number of parallel background workers (default: `1`, recommended for Pi).
- `UPSCALER_OUTPUT_DIR`: destination root for generated outputs (default: `<MEDIA_DIR>/upscaled`).
- `UPSCALER_OUTPUT_MODE`: `tree` (default, under `upscaled/`) or `sibling` (creates `*_upscaled_<profile>` next to source).
- `UPSCALER_ALLOWED_MIME_PREFIXES`: comma-separated accepted MIME prefixes (default: `image/,video/`).
- `UPSCALER_MAX_INPUT_BYTES`: per-job size cap (default: `83886080` bytes).
- `UPSCALER_MAX_VIDEO_SECONDS`: approximate max video duration cap used for guardrails.


### AI upscaler jobs (optional)

When enabled, upscaling runs asynchronously with job states: `queued`, `running`, `completed`, `failed`.

Submit a job:
```bash
curl -X POST \
  -H "X-Upload-Token: $UPLOAD_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"path":"family/photo.jpg","profile":"2x","overwrite":false}' \
  http://localhost:8000/api/upscale
```

Check status:
```bash
curl http://localhost:8000/api/upscale/<job_id>
```

List recent jobs:
```bash
curl http://localhost:8000/api/upscale
```

Cancel a running/queued job:
```bash
curl -X DELETE -H "X-Upload-Token: $UPLOAD_TOKEN" http://localhost:8000/api/upscale/<job_id>
```

Performance notes for Raspberry Pi:
- Keep `UPSCALER_WORKER_CONCURRENCY=1` unless you have active cooling and CPU headroom.
- `4x` profiles can take significantly longer than `2x`; for older Pi boards prefer `2x` or `denoise`.
- GPU acceleration depends on the chosen backend and platform support.

### Uploading

```bash
curl -X POST \
  -H "X-Upload-Token: $UPLOAD_TOKEN" \
  -F "file=@/path/to/photo.jpg" \
  http://localhost:8000/api/media
```

### Deleting

- Remove a single file:

  ```bash
  curl -X DELETE \
    -H "X-Upload-Token: $UPLOAD_TOKEN" \
    "http://localhost:8000/api/media?path=holiday/beach.jpg"
  ```

  - Returns `200` when deleted, `404` if the file is missing, and `400` when the path is invalid or the extension is not allowed.

- Delete multiple files at once:

  ```bash
  curl -X DELETE \
    -H "X-Upload-Token: $UPLOAD_TOKEN" \
    -H "Content-Type: application/json" \
    -d '["holiday/beach.jpg", "clips/birthday.mp4"]' \
    http://localhost:8000/api/media/batch
  ```

  - Returns `200` when all items are removed, `207` (Multi-Status) when some files fail (the response includes per-file results), and `404` when every requested file is missing.

### Categories

- Rename or retarget a category:

  ```bash
  curl -X PATCH \
    -H "X-Upload-Token: $UPLOAD_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"name": "Trips", "path": "travel"}' \
    http://localhost:8000/api/categories/old_name
  ```

- Delete a category:

  ```bash
  curl -X DELETE \
    -H "X-Upload-Token: $UPLOAD_TOKEN" \
    http://localhost:8000/api/categories/Trips
  ```

## Raspberry Pi deployment

### systemd service
Create `/etc/systemd/system/pi-media.service`:
```ini
[Unit]
Description=Pi Media Gallery
After=network.target

[Service]
User=pi
WorkingDirectory=/home/pi/pats-funhaus/app
Environment="UPLOAD_TOKEN=changeme" "MEDIA_DIR=/home/pi/media"
ExecStart=/usr/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
Restart=on-failure

[Install]
WantedBy=multi-user.target
```
Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now pi-media
```

### Docker (arm-friendly)
```Dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY app/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY app/ .
ENV HOST=0.0.0.0 PORT=8000
ENV MEDIA_DIR=/media
VOLUME ["/media"]
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```
Build and run on Pi:
```bash
docker build -t pi-media .
docker run -d --name pi-media \
  -e UPLOAD_TOKEN=changeme \
  -v /home/pi/media:/media \
  -p 8000:8000 pi-media
```

### nginx reverse proxy
Add an upstream in `/etc/nginx/sites-available/media`:
```nginx
server {
    listen 80;
    server_name _;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### Hardware-accelerated playback
For H.264 video on Raspberry Pi OS, enable hardware decoding:
```bash
sudo sed -i '/^#dtoverlay=vc4-kms-v3d/c\dtoverlay=vc4-kms-v3d' /boot/firmware/config.txt
sudo reboot
```
Most browsers on Pi will prefer H.264/MP4; encode uploads accordingly for smoother playback.

#### Intel iGPU (VAAPI) setup
For Intel iGPUs, enable VAAPI so the UI and transcoding tools can offload H.264 decode/encode:
- Install media drivers (Debian/Ubuntu example): `sudo apt install vainfo intel-media-va-driver-non-free`
- Verify support: run `vainfo` and confirm H.264 decode/encode profiles are listed
- Encode uploads with VAAPI-backed H.264 for smooth playback, e.g. `ffmpeg -hwaccel vaapi -hwaccel_output_format vaapi -i input.mkv -c:v h264_vaapi -b:v 4M -vf 'format=nv12|vaapi,hwupload' output.mp4`
- Browsers typically prioritize H.264; ensure uploaded files use H.264/MP4 for best compatibility
- In Docker, pass the GPU device into the container: `docker run ... --device /dev/dri ...` (and set `LIBVA_DRIVER_NAME` if needed)

### Derivative generation and Raspberry Pi acceleration
When FFmpeg is installed, uploads are post-processed to generate lightweight derivatives:
- `thumbnail_url` and `poster` JPG previews
- optional H.264 MP4 `stream_url` with `+faststart` for faster startup

On Raspberry Pi, hardware-assisted encode/decode can reduce CPU load. If your FFmpeg build includes V4L2 M2M codecs, you can adapt encoder flags to use `h264_v4l2m2m` instead of `libx264`. Validate available codecs with `ffmpeg -codecs | rg h264`.

For best browser compatibility on Pi, keep stream derivatives as H.264 + AAC in MP4 containers.
