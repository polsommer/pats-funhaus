# Pi Media Gallery

A lightweight FastAPI-powered gallery designed for Raspberry Pi 4. It serves images and videos from a configurable `media/` directory, offers authenticated uploads, and ships with a responsive web UI tuned for low-dependency deployments.

## Features
- REST API for listing and retrieving media from the local filesystem
- Authenticated uploads via `X-Upload-Token` header with file type and size safeguards
- Responsive grid gallery with thumbnail previews, modal/lightbox, and inline video playback
- Minimal dependencies suitable for ARM SBCs

## Quickstart

### Prerequisites
Install a Python runtime with venv support and a tool for downloads:
- Debian/Ubuntu: `sudo apt-get update && sudo apt-get install -y python3 python3-venv python3-pip curl`
- Fedora: `sudo dnf install -y python3 python3-venv python3-pip curl`
- macOS (Homebrew): `brew install python curl`

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
    -H "Content-Type: application/json" \
    -d '{"name": "Trips", "path": "travel"}' \
    http://localhost:8000/api/categories/old_name
  ```

- Delete a category:

  ```bash
  curl -X DELETE http://localhost:8000/api/categories/Trips
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
