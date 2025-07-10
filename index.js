import express from 'express';
import WebTorrent from 'webtorrent';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import compression from 'compression';

const app = express();
const client = new WebTorrent({
  tracker: {
    rtcConfig: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    },
    maxConns: 100, // Increase max connections for faster downloads
    downloadLimit: -1, // Unlimited download speed
    uploadLimit: -1   // Unlimited upload speed
  }
});
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const downloadsDir = path.join(__dirname, 'downloads');

if (!fs.existsSync(downloadsDir)) fs.mkdirSync(downloadsDir);

app.use(compression()); // Enable compression for faster responses
app.use(express.urlencoded({ extended: true }));
app.use(express.static(downloadsDir, { maxAge: '1d' })); // Cache static files

// Store active & completed torrents
let activeTorrents = [];
let completedTorrents = [];

// WebSocket server for live updates
const wss = new WebSocketServer({ port: 3001 });

// Helper function to format bytes
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Helper function to format time
function formatTime(seconds) {
  if (seconds === Infinity || isNaN(seconds)) return 'Unknown';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return hours > 0 ? `${hours}h ${minutes}m ${secs}s` : minutes > 0 ? `${minutes}m ${secs}s` : `${secs}s`;
}

// Broadcast torrent status to all WebSocket clients
function broadcastStatus() {
  const status = {
    active: activeTorrents.map(t => ({
      infoHash: t.infoHash,
      name: t.name,
      progress: (t.progress * 100).toFixed(1),
      downloaded: formatBytes(t.downloaded),
      total: formatBytes(t.length),
      speed: formatBytes(t.downloadSpeed),
      timeRemaining: formatTime(t.timeRemaining),
      peers: t.numPeers,
      done: t.done,
      paused: t.paused
    })),
    completed: completedTorrents.slice(-10),
    stats: {
      activeCount: activeTorrents.length,
      totalTorrents: client.torrents.length,
      downloadedFiles: fs.readdirSync(downloadsDir).length
    }
  };
  wss.clients.forEach(client => {
    if (client.readyState === client.OPEN) {
      client.send(JSON.stringify(status));
    }
  });
}

wss.on('connection', ws => {
  console.log('WebSocket client connected');
  broadcastStatus(); // Send initial status
});

// Main page
app.get('/', (req, res) => {
  const downloadedFiles = fs.readdirSync(downloadsDir);
  const completedList = downloadedFiles
    .map(f => {
      const filePath = path.join(downloadsDir, f);
      const stats = fs.statSync(filePath);
      return {
        name: f,
        size: formatBytes(stats.size),
        date: stats.mtime
      };
    })
    .sort((a, b) => b.date - a.date)
    .map(file => `
      <li class="file-item">
        <div class="file-info">
          <a href="/${file.name}" download>${file.name}</a>
          <span class="file-size">${file.size}</span>
        </div>
        <div class="file-date">${file.date.toLocaleString()}</div>
      </li>
    `).join('');

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Optimized Torrent Downloader</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        body {
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          max-width: 1000px;
          margin: 0 auto;
          padding: 20px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
          color: #333;
        }
        .container {
          background: white;
          border-radius: 15px;
          padding: 30px;
          box-shadow: 0 10px 30px rgba(0,0,0,0.3);
        }
        h1 {
          text-align: center;
          color: #4a5568;
          margin-bottom: 30px;
          font-size: 2.5em;
          background: linear-gradient(45deg, #667eea, #764ba2);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .download-form {
          background: #f8f9fa;
          padding: 20px;
          border-radius: 10px;
          margin-bottom: 30px;
          border: 2px solid #e9ecef;
        }
        input[type=text] {
  width: 100%;
  padding: 18px 20px;
  margin-bottom: 20px;
  border-radius: 10px;
  border: 2px solid #d1d5db;
  background: #f9fafb;
  font-size: 18px;
  font-family: 'Segoe UI', sans-serif;
  color: #1f2937;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  transition: all 0.3s ease;
}
input[type=text]:focus,
input[type=text]:hover {
  outline: none;
  border-color: #4f46e5;
  background: #ffffff;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  transform: translateY(-1px);
}
        button {
          width: 100%;
          padding: 15px;
          background: linear-gradient(45deg, #667eea, #764ba2);
          border: none;
          color: white;
          border-radius: 8px;
          cursor: pointer;
          font-size: 16px;
          font-weight: bold;
          transition: transform 0.2s;
        }
        button:hover {
          transform: translateY(-2px);
        }
        .section {
          margin-bottom: 30px;
        }
        .section h2 {
          color: #4a5568;
          margin-bottom: 15px;
          font-size: 1.5em;
          border-bottom: 2px solid #e9ecef;
          padding-bottom: 10px;
        }
        .torrent-list, .file-list {
          background: #f8f9fa;
          border-radius: 10px;
          padding: 20px;
          list-style: none;
        }
        .torrent-item {
          background: white;
          margin-bottom: 15px;
          padding: 15px;
          border-radius: 8px;
          box-shadow: 0 2px 10px rgba(0,0,0,0.1);
          transition: transform 0.2s;
        }
        .torrent-item:hover {
          transform: translateY(-2px);
        }
        .torrent-info {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 10px;
        }
        .torrent-status {
          font-size: 0.9em;
          padding: 4px 8px;
          border-radius: 15px;
          background: #e9ecef;
        }
        .progress-container {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 10px;
        }
        .progress-bar {
          flex: 1;
          height: 20px;
          background: #e9ecef;
          border-radius: 10px;
          overflow: hidden;
        }
        .progress-fill {
          height: 100%;
          background: linear-gradient(90deg, #667eea, #764ba2);
          transition: width 0.3s ease;
        }
        .progress-text {
          font-weight: bold;
          min-width: 50px;
          text-align: right;
        }
        .torrent-details {
          display: flex;
          justify-content: space-between;
          font-size: 0.9em;
          color: #666;
          flex-wrap: wrap;
          gap: 10px;
        }
        .torrent-controls {
          margin-top: 10px;
          display: flex;
          gap: 10px;
        }
        .control-btn {
          padding: 8px 15px;
          border-radius: 5px;
          border: none;
          cursor: pointer;
          font-weight: bold;
          transition: background 0.3s;
        }
        .pause-btn { background: #f1c40f; }
        .pause-btn:hover { background: #e1b107; }
        .resume-btn { background: #2ecc71; }
        .resume-btn:hover { background: #27ae60; }
        .cancel-btn { background: #e74c3c; }
        .cancel-btn:hover { background: #c0392b; }
        .file-item {
          background: white;
          margin-bottom: 10px;
          padding: 15px;
          border-radius: 8px;
          box-shadow: 0 2px 5px rgba(0,0,0,0.1);
        }
        .file-info {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 5px;
        }
        .file-date {
          font-size: 0.8em;
          color: #666;
        }
        .file-size {
          font-size: 0.9em;
          color: #666;
          background: #e9ecef;
          padding: 2px 8px;
          border-radius: 10px;
        }
        a {
          color: #667eea;
          text-decoration: none;
          font-weight: bold;
        }
        a:hover {
          text-decoration: underline;
        }
        .empty-state {
          text-align: center;
          color: #666;
          font-style: italic;
          padding: 20px;
        }
        .stats {
          display: flex;
          justify-content: space-around;
          background: #f8f9fa;
          padding: 20px;
          border-radius: 10px;
          margin-bottom: 20px;
        }
        .stat-item {
          text-align: center;
        }
        .stat-number {
          font-size: 2em;
          font-weight: bold;
          color: #667eea;
        }
        .stat-label {
          color: #666;
          font-size: 0.9em;
        }
        @media (max-width: 768px) {
          .torrent-details, .torrent-controls {
            flex-direction: column;
            gap: 5px;
          }
          .file-info {
            flex-direction: column;
            align-items: flex-start;
          }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🎬 Optimized Torrent Downloader</h1>
        <div class="stats">
          <div class="stat-item">
            <div class="stat-number" id="activeCount">0</div>
            <div class="stat-label">Active Downloads</div>
          </div>
          <div class="stat-item">
            <div class="stat-number" id="completedCount">0</div>
            <div class="stat-label">Completed Files</div>
          </div>
          <div class="stat-item">
            <div class="stat-number" id="totalTorrents">0</div>
            <div class="stat-label">Total Torrents</div>
          </div>
        </div>
        <div class="download-form">
          <form method="POST" action="/download">
            <input name="magnet" type="text" placeholder="🧲 Paste magnet link here..." required />
            <button type="submit">🚀 Start Download</button>
          </form>
        </div>
        <div class="section">
          <h2>⬇️ Active Downloads</h2>
          <ul class="torrent-list" id="torrentList">
            <div class="empty-state">No active downloads</div>
          </ul>
        </div>
        <div class="section">
          <h2>📁 Downloaded Files</h2>
          <ul class="file-list">
            ${completedList || '<div class="empty-state">No completed files</div>'}
          </ul>
        </div>
      </div>
      <script>
        const ws = new WebSocket('ws://localhost:3001');
        ws.onmessage = (event) => {
          const data = JSON.parse(event.data);
          const torrentList = document.getElementById('torrentList');
          document.getElementById('activeCount').textContent = data.stats.activeCount;
          document.getElementById('completedCount').textContent = data.stats.downloadedFiles;
          document.getElementById('totalTorrents').textContent = data.stats.totalTorrents;

          if (data.active.length === 0) {
            torrentList.innerHTML = '<div class="empty-state">No active downloads</div>';
            return;
          }

          torrentList.innerHTML = data.active.map(t => \`
            <li class="torrent-item" data-hash="\${t.infoHash}">
              <div class="torrent-info">
                <strong>\${t.name}</strong>
                <span class="torrent-status">\${t.done ? "✅ Completed" : t.paused ? "⏸️ Paused" : "⬇️ Downloading"}</span>
              </div>
              <div class="progress-container">
                <div class="progress-bar">
                  <div class="progress-fill" style="width: \${t.progress}%"></div>
                </div>
                <span class="progress-text">\${t.progress}%</span>
              </div>
              <div class="torrent-details">
                <span>📊 \${t.downloaded} / \${t.total}</span>
                <span>🚀 \${t.speed}/s</span>
                <span>⏱️ \${t.timeRemaining}</span>
                <span>👥 \${t.peers} peers</span>
              </div>
              <div class="torrent-controls">
                <button class="control-btn \${t.paused ? 'resume-btn' : 'pause-btn'}" 
                        onclick="controlTorrent('\${t.infoHash}', '\${t.paused ? 'resume' : 'pause'}')">
                  \${t.paused ? '▶️ Resume' : '⏸️ Pause'}
                </button>
                <button class="control-btn cancel-btn" 
                        onclick="controlTorrent('\${t.infoHash}', 'cancel')">
                  ❌ Cancel
                </button>
              </div>
            </li>
          \`).join('');
        };

        function controlTorrent(infoHash, action) {
          fetch('/control', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ infoHash, action })
          }).then(response => response.json())
            .then(data => {
              if (data.error) alert(data.error);
            });
        }
      </script>
    </body>
    </html>
  `);
});

// Torrent download route
app.post('/download', (req, res) => {
  const magnetURI = req.body.magnet?.trim();

  if (!magnetURI || !magnetURI.startsWith("magnet:")) {
    return res.status(400).send(`
      <div style="text-align: center; padding: 50px; font-family: Arial;">
        <h2>❌ Invalid Magnet Link</h2>
        <p>Please provide a valid magnet link starting with "magnet:"</p>
        <a href="/" style="color: #667eea; text-decoration: none; font-weight: bold;">← Back to Downloads</a>
      </div>
    `);
  }

  const infoHashMatch = magnetURI.match(/xt=urn:btih:([a-fA-F0-9]+)/);
  const infoHash = infoHashMatch ? infoHashMatch[1].toLowerCase() : null;

  if (!infoHash) {
    return res.status(400).send(`
      <div style="text-align: center; padding: 50px; font-family: Arial;">
        <h2>❌ Invalid Magnet Link</h2>
        <p>Could not extract info hash from magnet link</p>
        <a href="/" style="color: #667eea; text-decoration: none; font-weight: bold;">← Back to Downloads</a>
      </div>
    `);
  }

  if (activeTorrents.some(t => t.infoHash === infoHash) || client.torrents.some(t => t.infoHash === infoHash)) {
    return res.status(400).send(`
      <div style="text-align: center; padding: 50px; font-family: Arial;">
        <h2>⚠️ Duplicate Torrent</h2>
        <p>This torrent is already being downloaded or has been downloaded</p>
        <a href="/" style="color: #667eea; text-decoration: none; font-weight: bold;">← Back to Downloads</a>
      </div>
    `);
  }

  try {
    client.add(magnetURI, {
      path: downloadsDir,
      announce: [
        'udp://tracker.opentrackr.org:1337/announce',
        'udp://tracker.openbittorrent.com:6969/announce',
        'udp://tracker.internetwarriors.net:1337/announce',
        'udp://tracker.coppersurfer.tk:6969/announce',
        'udp://tracker.leechers-paradise.org:6969/announce',
        'udp://9.rarbg.to:2710/announce',
        'udp://exodus.desync.com:6969/announce'
      ],
      maxWebConns: 200 // Optimize for faster connections
    }, torrent => {
      console.log(`⏳ Starting download: ${torrent.name}`);
      torrent.startTime = Date.now();
      torrent.done = false;
      torrent.paused = false;
      activeTorrents.push(torrent);

      torrent.on('download', () => {
        broadcastStatus();
      });

      torrent.on('done', () => {
        console.log(`✅ Download completed: ${torrent.name}`);
        torrent.done = true;
        completedTorrents.push({
          name: torrent.name,
          size: formatBytes(torrent.length),
          completedAt: new Date(),
          timeTaken: (Date.now() - torrent.startTime) / 1000
        });
        setTimeout(() => {
          const index = activeTorrents.findIndex(t => t.infoHash === torrent.infoHash);
          if (index !== -1) {
            activeTorrents.splice(index, 1);
            broadcastStatus();
          }
        }, 30000);
      });

      torrent.on('error', (err) => {
        console.error(`❌ Torrent error for ${torrent.name}:`, err.message);
        const index = activeTorrents.findIndex(t => t.infoHash === torrent.infoHash);
        if (index !== -1) {
          activeTorrents.splice(index, 1);
          broadcastStatus();
        }
      });

      broadcastStatus();
    });

    res.send(`
      <div style="text-align: center; padding: 50px; font-family: Arial;">
        <h2>🚀 Download Started!</h2>
        <p>Your torrent has been added to the download queue</p>
        <p>You will be redirected automatically...</p>
        <a href="/" style="color: #667eea; text-decoration: none; font-weight: bold;">← Back to Downloads</a>
        <script>
          setTimeout(() => {
            window.location.href = '/';
          }, 3000);
        </script>
      </div>
    `);
  } catch (err) {
    console.error('❌ Error adding torrent:', err.message);
    res.status(500).send(`
      <div style="text-align: center; padding: 50px; font-family: Arial;">
        <h2>❌ Download Error</h2>
        <p>Error: ${err.message}</p>
        <a href="/" style="color: #667eea; text-decoration: none; font-weight: bold;">← Back to Downloads</a>
      </div>
    `);
  }
});

// Torrent control route
app.post('/control', express.json(), (req, res) => {
  const { infoHash, action } = req.body;
  const torrent = client.get(infoHash);

  if (!torrent) {
    return res.json({ error: 'Torrent not found' });
  }

  try {
    if (action === 'pause') {
      torrent.pause();
      torrent.paused = true;
    } else if (action === 'resume') {
      torrent.resume();
      torrent.paused = false;
    } else if (action === 'cancel') {
      client.remove(infoHash, () => {
        const index = activeTorrents.findIndex(t => t.infoHash === infoHash);
        if (index !== -1) {
          activeTorrents.splice(index, 1);
        }
        broadcastStatus();
      });
    }
    broadcastStatus();
    res.json({ success: true });
  } catch (err) {
    res.json({ error: err.message });
  }
});

// Cleanup old torrents
setInterval(() => {
  const now = Date.now();
  const maxAge = 24 * 60 * 60 * 1000; // 24 hours
  completedTorrents = completedTorrents.filter(t => (now - t.completedAt.getTime()) < maxAge);
  broadcastStatus();
}, 60 * 60 * 1000);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down gracefully...');
  client.destroy(() => {
    console.log('✅ WebTorrent client destroyed');
    wss.close(() => {
      console.log('✅ WebSocket server closed');
      process.exit(0);
    });
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Optimized Torrent Downloader running at http://localhost:${PORT}`);
  console.log(`📡 WebSocket server running at ws://localhost:3001`);
  console.log(`📁 Downloads directory: ${downloadsDir}`);
});