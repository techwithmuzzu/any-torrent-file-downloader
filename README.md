# 🎬 Any Torrent File Downloader

A fast, optimized torrent downloader built with Node.js, Express, and WebTorrent.  
Includes real-time progress updates via WebSocket, pause/resume/cancel controls, Docker support, and a modern responsive UI.

---

## ✨ Features

- **Real-time Updates**: Live download progress using WebSocket (no page refresh).
- **Download Controls**: Pause, resume, or cancel torrents.
- **Optimized Performance**: WebTorrent settings tuned for faster downloads.
- **Docker Support**: Run easily in a container with persistent storage.
- **Styled UI**: Modern input field with shadow, border effects, and smooth layout.
- **Persistent Storage**: Downloads saved locally in the `./downloads` directory.

---

## 🧰 Prerequisites

- **Node.js**: v18.x or later (for non-Docker use)
- **Docker** and **Docker Compose**: For containerized setup
- **Git**: To clone the repository
- **Legal Torrents Only**: Always use legal content (e.g., Linux ISOs)

---

## 🚀 Setup and Run

### ✅ Option 1: Run with Docker

1. **Clone the Repository**

```bash
git clone https://github.com/techwithmuzzu/any-torrent-file-downloader.git
cd any-torrent-file-downloader
```

2. **Build and Start Docker Containers**

```bash
docker compose build
docker compose up -d
```

- App runs on:
  - `http://localhost:3000` → Web interface
  - `ws://localhost:3001` → WebSocket progress

3. **Stop the App**

```bash
docker compose down
```

---

### ✅ Option 2: Run without Docker

1. **Clone the Repository**

```bash
git clone https://github.com/techwithmuzzu/any-torrent-file-downloader.git
cd any-torrent-file-downloader
```

2. **Install Dependencies**

```bash
npm install
```

3. **Start the App**

```bash
npm start
```

- App available at: `http://localhost:3000`

---

## 💻 Usage

### 🎯 Start a Download

1. Paste a valid magnet link (e.g., Ubuntu ISO).
2. Click **"Start Download"**.

### 📊 Monitor Progress

- View live download stats (progress %, speed, peers).
- Use **Pause / Resume / Cancel** buttons to control each torrent.

### 📁 Access Downloaded Files

- Completed files will appear in the **"Downloaded Files"** section.
- Files are saved inside the `./downloads` folder.

---

## 🧪 Troubleshooting

### Docker Permissions

```bash
sudo usermod -aG docker $USER
newgrp docker
```

### UI Styling Not Working?

- Hard refresh browser: `Ctrl+Shift+R`
- Use **Incognito Mode**
- Inspect input: Should have `.download-form input[type=text]` with border shadow

### Docker Build Errors

```bash
docker compose build --no-cache
```

### WebSocket Not Connecting?

- Open port 3001:  
```bash
sudo ufw allow 3001
```
- Check browser console (`F12 → Console`) for WebSocket errors.

---

## ☁️ Cloud Deployment (Optional)

To host on a VPS or cloud provider (e.g., DigitalOcean, AWS EC2):

1. Install **Docker** and **Docker Compose**
2. Clone repo and run:

```bash
docker compose up -d
```

3. Open ports `3000` and `3001` in your firewall

> 🔐 Use **NGINX + Let's Encrypt** to add HTTPS support (recommended)

---

## ⚖️ Legal

Use this tool for downloading **only legal torrents**, such as:

- Linux distros (e.g., Ubuntu, Fedora)
- Open-source movies
- Public domain files

---

## 🪪 License

ISC License © 2025 TechWithMuzzu  
