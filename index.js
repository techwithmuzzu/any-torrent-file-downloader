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
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
        { urls: 'stun:stun.stunprotocol.org:3478' },
        { urls: 'stun:stun.sipnet.net:3478' },
        { urls: 'stun:stun.ideasip.com:3478' },
        { urls: 'stun:stun.voiparound.com:3478' },
        { urls: 'stun:stun.voipbuster.com:3478' },
        { urls: 'stun:stun.voxgratia.org:3478' },
        { urls: 'stun:stun.ekiga.net' }
      ]
    },
    maxConns: 400,
    downloadLimit: -1,
    uploadLimit: -1
  },
  dht: true,
  webSeeds: true,
  maxConns: 400
});
const PORT = process.env.PORT || 3000;
const WS_PORT = process.env.WS_PORT || 3001;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const downloadsDir = path.join(__dirname, 'downloads');

if (!fs.existsSync(downloadsDir)) fs.mkdirSync(downloadsDir);

// Add this at the top of your Express app configuration
app.use((req, res, next) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  next();
});
app.use(compression());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(downloadsDir, { maxAge: '1d' }));

let activeTorrents = [];
let completedTorrents = [];

// Initialize WebSocket server
let wss;
let wsPort = Number(WS_PORT);

function createWebSocketServer(startPort) {
  return new Promise((resolve, reject) => {
    const tryPort = (port) => {
      const server = new WebSocketServer({ port });

      server.on('listening', () => {
        console.log(`📡 WebSocket server running at ws://localhost:${port}`);
        resolve({ server, port });
      });

      server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          console.warn(`⚠️ Port ${port} in use, trying ${port + 1}...`);
          tryPort(port + 1);
        } else {
          reject(err);
        }
      });
    };

    tryPort(startPort);
  });
}

// Add this function to clean up stuck state
function cleanupStuckTorrents() {
  const stuckTorrents = activeTorrents.filter(t => t.fetching && !t.name);
  stuckTorrents.forEach(torrent => {
    try {
      const clientTorrent = client.get(torrent.infoHash);
      if (clientTorrent) {
        client.remove(torrent.infoHash);
      }
      const index = activeTorrents.indexOf(torrent);
      if (index !== -1) activeTorrents.splice(index, 1);
    } catch (err) {
      console.warn('Cleanup warning:', err.message);
    }
  });
}

// Function to save torrent state
function saveTorrentState() {
  const state = {
    activeTorrents: activeTorrents.map(t => ({
      infoHash: t.infoHash,
      magnetURI: t.magnetURI,
      name: t.name,
      progress: t.progress || 0,
      paused: t.paused || false
    })),
    completedTorrents: completedTorrents
  };

  try {
    fs.writeFileSync(path.join(__dirname, 'torrent-state.json'), JSON.stringify(state, null, 2));
  } catch (err) {
    console.warn('Could not save torrent state:', err.message);
  }
}


// Function to restore torrent state
function restoreTorrentState() {
  try {
    const stateFile = path.join(__dirname, 'torrent-state.json');
    if (fs.existsSync(stateFile)) {
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));

      // Restore completed torrents
      completedTorrents = state.completedTorrents || [];

      // Restore active torrents
      if (state.activeTorrents && state.activeTorrents.length > 0) {
        console.log(`🔄 Resuming ${state.activeTorrents.length} interrupted downloads...`);

        state.activeTorrents.forEach((torrentData, index) => {
          if (torrentData.magnetURI) {
            setTimeout(() => {
              try {
                const torrent = client.add(torrentData.magnetURI, {
                  path: downloadsDir,
                  announce: [
                    'udp://tracker.opentrackr.org:1337/announce',
                    'udp://open.tracker.cl:1337/announce',
                    'udp://tracker.torrent.eu.org:451/announce',
                    'udp://tracker.moeking.me:6969/announce',
                    'udp://opentracker.i2p.rocks:6969/announce',
                    'udp://tracker.internetwarriors.net:1337/announce',
                    'udp://tracker.openbittorrent.com:6969/announce',
                    'udp://exodus.desync.com:6969/announce',
                    'udp://tracker.cyberia.is:6969/announce',
                    'udp://9.rarbg.com:2810/announce',
                    'udp://tracker.ds.is:6969/announce',
                    'udp://tracker.tiny-vps.com:6969/announce',
                    'udp://retracker.lanta-net.ru:2710/announce',
                    'udp://tracker.zerobytes.xyz:1337/announce',
                    'http://tracker.files.fm:6969/announce',
                    'http://tracker.opentrackr.org:1337/announce'
                  ],
                  maxWebConns: 400,
                  strategy: 'rarest',
                  skipVerify: false,
                  dht: true,
                  webSeeds: true
                });

                torrent.fetching = true;
                activeTorrents.push(torrent);
                console.log(`🔄 Fetching torrent: ${torrentData.name || 'unknown'}`);

                // Timeout for fetching metadata
                const metadataTimeout = setTimeout(() => {
                  if (torrent.fetching && !torrent.name) {
                    console.log(`⏰ Timeout fetching torrent: ${torrentData.name || 'unknown'}, removing...`);
                    client.remove(torrent.infoHash);
                    const torrentIndex = activeTorrents.findIndex(t => t.infoHash === torrent.infoHash);
                    if (torrentIndex !== -1) {
                      activeTorrents.splice(torrentIndex, 1);
                      throttledBroadcast();
                    }
                  }
                }, 30000);

                // Event listeners for restored torrents
                torrent.on('metadata', () => {
                  clearTimeout(metadataTimeout);
                  torrent.fetching = false;
                  torrent.done = false;
                  torrent.paused = false;
                  torrent.startTime = Date.now();
                  console.log(`⏳ Resumed download: ${torrent.name}`);
                  throttledBroadcast();
                });

                torrent.on('download', () => {
                  throttledBroadcast();
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
                    const torrentIndex = activeTorrents.findIndex(t => t.infoHash === torrent.infoHash);
                    if (torrentIndex !== -1) {
                      activeTorrents.splice(torrentIndex, 1);
                      throttledBroadcast();
                    }
                  }, 30000);
                });

                torrent.on('error', (err) => {
                  clearTimeout(metadataTimeout);
                  console.error(`❌ Restored torrent error for ${torrent.name || 'unknown'}:`, err.message);
                  torrent.fetching = false;
                  const torrentIndex = activeTorrents.findIndex(t => t.infoHash === torrent.infoHash);
                  if (torrentIndex !== -1) {
                    activeTorrents.splice(torrentIndex, 1);
                    throttledBroadcast();
                  }
                });

              } catch (err) {
                console.warn(`Could not restore torrent ${torrentData.name}:`, err.message);
              }
            }, 1000 * index); // Stagger the restoration
          }
        });
      }

      // Clean up state file
      fs.unlinkSync(stateFile);
    }
  } catch (err) {
    console.warn('Could not restore torrent state:', err.message);
  }
}

try {
  const { server, port } = await createWebSocketServer(wsPort);
  wss = server;
  wsPort = port;
  cleanupStuckTorrents();
  restoreTorrentState();
} catch (err) {
  console.error('❌ Failed to start WebSocket server:', err.message);
  process.exit(1);
}


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
  if (!wss || wss.clients.size === 0) return;

  const status = {
    active: activeTorrents.map(t => ({
      infoHash: t.infoHash,
      name: t.name || 'Fetching metadata...',
      progress: ((t.progress || 0) * 100).toFixed(1),
      downloaded: formatBytes(t.downloaded || 0),
      total: formatBytes(t.length || 0),
      speed: formatBytes(t.downloadSpeed || 0),
      timeRemaining: formatTime(t.timeRemaining || 0),
      peers: t.numPeers || 0,
      done: t.done || false,
      paused: t.paused || false,
      fetching: t.fetching || false,
      metadataFetched: !!t.name
    })),
    completed: completedTorrents.slice(-10),
    stats: {
      activeCount: activeTorrents.length,
      totalTorrents: client.torrents.length,
      downloadedFiles: fs.existsSync(downloadsDir) ? fs.readdirSync(downloadsDir).length : 0
    }
  };

  wss.clients.forEach(client => {
    if (client.readyState === 1) { // WebSocket.OPEN
      try {
        client.send(JSON.stringify(status));
      } catch (err) {
        console.warn('WebSocket send error:', err.message);
      }
    }
  });
}

wss.on('connection', ws => {
  console.log('WebSocket client connected');
  ws.on('error', (err) => {
    console.warn('WebSocket client error:', err.message);
  });
  broadcastStatus();
});

// Throttle status updates
let lastUpdate = 0;
function throttledBroadcast() {
  const now = Date.now();
  if (now - lastUpdate >= 1000) { // Update every 1 second
    broadcastStatus();
    lastUpdate = now;
  }
}

app.get('/', (req, res) => {
  const downloadedFiles = fs.readdirSync(downloadsDir);
  const completedList = downloadedFiles
    .map(f => {
      const safeName = path.basename(f);
      const filePath = path.join(downloadsDir, safeName);

      if (!fs.existsSync(filePath)) {
        return null;
      }

      const stats = fs.statSync(filePath);
      return {
        name: f,
        size: formatBytes(stats.size),
        date: stats.mtime
      };
    })
    .filter(file => file !== null)
    .sort((a, b) => b.date - a.date)
    .map(file => `
      <li class="file-item" data-file="${file.name}">
        <div class="file-info">
          <a href="/${file.name}" download>${file.name}</a>
          <span class="file-size">${file.size}</span>
        </div>
        <div class="file-date">${file.date.toLocaleString()}</div>
        <div class="torrent-controls">
          <button class="control-btn delete-btn" 
                  onclick="deleteFile('${file.name}')">
            Delete
          </button>
        </div>
      </li>
    `).join('');

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
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
        input[type=text]::placeholder {
          color: #6b7280;
          font-style: italic;
        }
        input[type=text]:invalid {
          border-color: #ef4444;
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
        .delete-btn { background: #e74c3c; }
        .delete-btn:hover { background: #c0392b; }
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
        .loading-overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(0,0,0,0.7);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          display: none;
        }
        .loader {
          border: 8px solid #f3f3f3;
          border-top: 8px solid #667eea;
          border-radius: 50%;
          width: 60px;
          height: 60px;
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes slideIn {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        .loading-text {
          color: white;
          font-size: 1.2em;
          margin-top: 20px;
          text-align: center;
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
      <div class="loading-overlay" id="loadingOverlay">
        <div>
          <div class="loader"></div>
          <div class="loading-text">Fetching torrent...</div>
        </div>
      </div>
      <div class="container">
        <h1>Optimized Torrent Downloader</h1>
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
          <form method="POST" action="/download" onsubmit="showLoading()">
            <input type="text" name="magnet" placeholder="Paste magnet link here..." required />
            <button type="submit">Start Download</button>
          </form>
          <div id="alertContainer" style="position: fixed; top: 20px; right: 20px; z-index: 1001;"></div>
        </div>
        <div class="section">
          <h2>Active Downloads</h2>
          <ul class="torrent-list" id="torrentList">
            <div class="empty-state">No active downloads</div>
          </ul>
        </div>
        <div class="section">
          <h2>Downloaded Files</h2>
          <ul class="file-list">
          ${completedList || '<div class="empty-state">No completed files</div>'}
          </ul>
        </div>
      </div>
      <script>
        let lastUpdates = {};

        function showLoading() {
          document.getElementById('loadingOverlay').style.display = 'flex';
          showAlert('Starting download...', 'info');
        }

        function hideLoading() {
          document.getElementById('loadingOverlay').style.display = 'none';
        }

        function showAlert(message, type = 'info') {
          const alertContainer = document.getElementById('alertContainer');
          const alert = document.createElement('div');
          alert.style.cssText = \`
            padding: 15px 20px; margin-bottom: 10px; border-radius: 8px; color: white; font-weight: bold;
            background: \${type === 'success' ? '#2ecc71' : type === 'error' ? '#e74c3c' : '#3498db'};
            box-shadow: 0 4px 12px rgba(0,0,0,0.3); animation: slideIn 0.3s ease;
          \`;
          alert.textContent = message;
          alertContainer.appendChild(alert);
          setTimeout(() => alert.remove(), 4000);
        }

        function deleteFile(fileName) {
          if (confirm('Are you sure you want to delete ' + fileName + '?')) {
            fetch('/delete', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ fileName })
            }).then(response => response.json())
              .then(data => {
                if (data.success) {
                  document.querySelector('[data-file="' + fileName + '"]').remove();
                  document.getElementById('completedCount').textContent = parseInt(document.getElementById('completedCount').textContent) - 1;
                } else {
                  alert(data.error);
                }
              });
          }
        }
        
        const ws = new WebSocket('ws://localhost:${wsPort}');
        ws.onmessage = (event) => {
          const data = JSON.parse(event.data);
          
          if (data.error && data.infoHash) {
            hideLoading();
            showAlert('Failed to fetch torrent metadata', 'error');
            return;
          }

          if (data.metadataFetched) {
            showAlert('Metadata fetched successfully!', 'success');
            setTimeout(() => {
              window.location.href = '/';
            }, 1000);
          }

          const torrentList = document.getElementById('torrentList');
          document.getElementById('activeCount').textContent = data.stats.activeCount;
          document.getElementById('completedCount').textContent = data.stats.downloadedFiles;
          document.getElementById('totalTorrents').textContent = data.stats.totalTorrents;

          if (data.active.length === 0) {
            torrentList.innerHTML = '<div class="empty-state">No active downloads</div>';
            return;
          }

          torrentList.innerHTML = data.active.map(t => {
            const statusText = t.fetching ? "Fetching metadata..." : 
                              t.done ? "Completed" : 
                              t.paused ? "Paused" : "Downloading";
            
            return \`
              <li class="torrent-item" data-hash="\${t.infoHash}">
                <div class="torrent-info">
                  <strong>\${t.name}</strong>
                  <span class="torrent-status">\${statusText}</span>
                </div>
                <div class="progress-container">
                  <div class="progress-bar">
                    <div class="progress-fill" style="width: \${t.progress}%"></div>
                  </div>
                  <span class="progress-text">\${t.progress}%</span>
                </div>
                <div class="torrent-details">
                  <span>Size: \${t.downloaded} / \${t.total}</span>
                  <span>Speed: \${t.speed}/s</span>
                  <span>ETA: \${t.timeRemaining}</span>
                  <span>Peers: \${t.peers}</span>
                </div>
                <div class="torrent-controls">
                  <button class="control-btn \${t.paused ? 'resume-btn' : 'pause-btn'}" 
                          onclick="controlTorrent('\${t.infoHash}', '\${t.paused ? 'resume' : 'pause'}')">
                    \${t.paused ? 'Resume' : 'Pause'}
                  </button>
                  <button class="control-btn cancel-btn" 
                          onclick="controlTorrent('\${t.infoHash}', 'cancel')">
                    Cancel
                  </button>
                </div>
              </li>
            \`;
          }).join('');
        };

        ws.onopen = () => {
          console.log('WebSocket connected');
        };

        ws.onclose = () => {
          console.log('WebSocket disconnected');
          setTimeout(() => {
            location.reload();
          }, 3000);
        };

        ws.onerror = (error) => {
          console.error('WebSocket error:', error);
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

  // Check for duplicates
  if (activeTorrents.some(t => t.infoHash === infoHash) || 
      client.torrents.some(t => t.infoHash === infoHash)) {
    return res.status(400).send(`
      <div style="text-align: center; padding: 50px; font-family: Arial;">
        <h2>⚠️ Duplicate Torrent</h2>
        <p>This torrent is already being downloaded or has been downloaded</p>
        <a href="/" style="color: #667eea; text-decoration: none; font-weight: bold;">← Back to Downloads</a>
      </div>
    `);
  }

  try {
    const torrent = client.add(magnetURI, {
      path: downloadsDir,
      announce: [
        'udp://tracker.opentrackr.org:1337/announce',
        'udp://tracker.openbittorrent.com:6969/announce',
        'udp://tracker.internetwarriors.net:1337/announce',
        'udp://exodus.desync.com:6969/announce',
        'udp://tracker.cyberia.is:6969/announce',
        'udp://tracker.torrent.eu.org:451/announce',
        'udp://tracker.moeking.me:6969/announce',
        'udp://open.tracker.cl:1337/announce',
        'udp://opentracker.i2p.rocks:6969/announce',
        'udp://9.rarbg.com:2810/announce'
      ],
      maxWebConns: 200,
      strategy: 'rarest',
      dht: true,
      webSeeds: true
    });

    torrent.fetching = true;
    torrent.magnetURI = magnetURI;
    activeTorrents.push(torrent);
    console.log(`🔄 Fetching torrent: ${magnetURI}`);

    const metadataTimeout = setTimeout(() => {
      if (torrent.fetching && !torrent.name) {
        console.log(`⏰ Metadata timeout for torrent`);
        torrent.fetching = false;
        try {
          client.remove(torrent.infoHash);
        } catch (err) {
          console.warn('Error removing timed out torrent:', err.message);
        }
        
        const index = activeTorrents.findIndex(t => t.infoHash === torrent.infoHash);
        if (index !== -1) activeTorrents.splice(index, 1);

        broadcastToClients({
          error: true,
          message: "Torrent metadata fetch timed out",
          infoHash: torrent.infoHash
        });
      }
    }, 120000); // 2 minutes timeout

    torrent.on('metadata', () => {
      clearTimeout(metadataTimeout);
      console.log(`⏳ Starting download: ${torrent.name}`);
      torrent.startTime = Date.now();
      torrent.done = false;
      torrent.paused = false;
      torrent.fetching = false;

      broadcastToClients({
        metadataFetched: true,
        infoHash: torrent.infoHash
      });

      broadcastStatus();
    });

    torrent.on('download', () => {
      throttledBroadcast();
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
          throttledBroadcast();
        }
      }, 30000);
    });

    torrent.on('error', (err) => {
      clearTimeout(metadataTimeout);
      console.error(`❌ Torrent error for ${torrent.name || 'unknown'}:`, err.message);
      torrent.fetching = false;

      // Enhanced retry logic
      if (!torrent.retryCount && shouldRetry(err)) {
        handleTorrentRetry(torrent, magnetURI);
        return;
      }

      // Remove failed torrent
      const index = activeTorrents.findIndex(t => t.infoHash === torrent.infoHash);
      if (index !== -1) {
        activeTorrents.splice(index, 1);
      }
      throttledBroadcast();

      broadcastToClients({
        error: true,
        infoHash: torrent.infoHash,
        message: err.message
      });
    });

    res.send(`
      <div style="text-align: center; padding: 50px; font-family: Arial;">
        <h2>🚀 Download Started!</h2>
        <p>Fetching torrent metadata...</p>
        <script>
          setTimeout(() => {
            window.location.href = '/';
          }, 2000);
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

function shouldRetry(err) {
  const retryableErrors = [
    'metadata',
    'timeout',
    'no peers',
    'connection',
    'network'
  ];
  return retryableErrors.some(keyword => 
    err.message.toLowerCase().includes(keyword)
  );
}

function broadcastToClients(message) {
  if (!wss || wss.clients.size === 0) return;
  
  wss.clients.forEach(client => {
    if (client.readyState === 1) { // WebSocket.OPEN
      try {
        client.send(JSON.stringify(message));
      } catch (err) {
        console.warn('WebSocket broadcast error:', err.message);
      }
    }
  });
}

function handleTorrentRetry(originalTorrent, magnetURI) {
  originalTorrent.retryCount = 1;
  console.log('🔄 Retrying torrent fetch in 5 seconds...');

  // Remove failed torrent
  try {
    client.remove(originalTorrent.infoHash);
  } catch (err) {
    console.warn('Error removing failed torrent:', err.message);
  }

  const index = activeTorrents.findIndex(t => t.infoHash === originalTorrent.infoHash);
  if (index !== -1) activeTorrents.splice(index, 1);

  broadcastToClients({
    retry: true,
    infoHash: originalTorrent.infoHash,
    message: 'Retrying torrent fetch...'
  });

  setTimeout(() => {
    try {
      console.log('🔄 Starting retry attempt...');
      const retryTorrent = client.add(magnetURI, {
        path: downloadsDir,
        announce: [
          'udp://tracker.opentrackr.org:1337/announce',
          'udp://open.tracker.cl:1337/announce',
          'udp://tracker.torrent.eu.org:451/announce',
          'udp://tracker.moeking.me:6969/announce',
          'udp://opentracker.i2p.rocks:6969/announce',
          'udp://tracker.internetwarriors.net:1337/announce',
          'udp://tracker.openbittorrent.com:6969/announce',
          'udp://exodus.desync.com:6969/announce',
          'udp://tracker.cyberia.is:6969/announce',
          'udp://9.rarbg.com:2810/announce'
        ],
        maxWebConns: 200,
        strategy: 'rarest',
        skipVerify: false,
        dht: true,
        webSeeds: true
      });

      retryTorrent.fetching = true;
      retryTorrent.retryCount = 1;
      retryTorrent.magnetURI = magnetURI;
      activeTorrents.push(retryTorrent);

      const retryTimeout = setTimeout(() => {
        if (retryTorrent.fetching && !retryTorrent.name) {
          console.log(`⏰ Retry timeout for torrent`);
          retryTorrent.fetching = false;
          try {
            client.remove(retryTorrent.infoHash);
          } catch (err) {
            console.warn('Error removing retry torrent:', err.message);
          }
          
          const retryIndex = activeTorrents.findIndex(t => t.infoHash === retryTorrent.infoHash);
          if (retryIndex !== -1) activeTorrents.splice(retryIndex, 1);

          broadcastToClients({
            error: true,
            message: "Retry failed - torrent metadata fetch timed out",
            infoHash: retryTorrent.infoHash
          });
        }
      }, 180000); // 3 minutes for retry

      // Set up retry torrent event handlers
      setupTorrentEventHandlers(retryTorrent, retryTimeout);

    } catch (retryErr) {
      console.error('❌ Retry attempt failed:', retryErr.message);
      broadcastToClients({
        error: true,
        infoHash: originalTorrent.infoHash,
        message: `Retry failed: ${retryErr.message}`
      });
    }
  }, 5000);
}

function setupTorrentEventHandlers(torrent, timeout) {
  torrent.on('metadata', () => {
    clearTimeout(timeout);
    console.log(`✅ ${torrent.retryCount ? 'Retry successful' : 'Metadata fetched'}: ${torrent.name}`);
    torrent.startTime = Date.now();
    torrent.done = false;
    torrent.paused = false;
    torrent.fetching = false;

    broadcastToClients({
      metadataFetched: true,
      infoHash: torrent.infoHash,
      message: torrent.retryCount ? 'Retry successful! Download starting...' : 'Metadata fetched successfully!'
    });
    
    throttledBroadcast();
  });

  torrent.on('download', () => {
    throttledBroadcast();
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
        throttledBroadcast();
      }
    }, 30000);
  });

  torrent.on('error', (err) => {
    clearTimeout(timeout);
    console.error(`❌ ${torrent.retryCount ? 'Retry also failed' : 'Torrent error'} for ${torrent.name || 'unknown'}:`, err.message);
    torrent.fetching = false;

    const index = activeTorrents.findIndex(t => t.infoHash === torrent.infoHash);
    if (index !== -1) {
      activeTorrents.splice(index, 1);
    }
    throttledBroadcast();

    broadcastToClients({
      error: true,
      infoHash: torrent.infoHash,
      message: torrent.retryCount ? `Final failure: ${err.message}` : err.message
    });
  });
}

app.post('/control', express.json(), (req, res) => {
  const { infoHash, action } = req.body;
  
  if (!infoHash || !action) {
    return res.json({ error: 'Missing infoHash or action' });
  }

  const torrent = client.get(infoHash);
  if (!torrent) {
    return res.json({ error: 'Torrent not found' });
  }

  try {
    switch (action) {
      case 'pause':
        torrent.pause();
        torrent.paused = true;
        break;
      case 'resume':
        torrent.resume();
        torrent.paused = false;
        break;
      case 'cancel':
      case 'stop':
        client.remove(infoHash, (err) => {
          if (err) {
            console.warn('Error removing torrent:', err.message);
          }
          const index = activeTorrents.findIndex(t => t.infoHash === infoHash);
          if (index !== -1) {
            activeTorrents.splice(index, 1);
          }
          throttledBroadcast();
        });
        break;
      default:
        return res.json({ error: 'Invalid action' });
    }
    
    throttledBroadcast();
    res.json({ success: true });
  } catch (err) {
    console.error('Control error:', err.message);
    res.json({ error: err.message });
  }
});

app.post('/delete', express.json(), (req, res) => {
  const { fileName } = req.body;

  if (!fileName) {
    return res.json({ error: 'File name is required' });
  }

  const safeName = path.basename(fileName);
  const filePath = path.join(downloadsDir, safeName);

  try {
    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      if (stats.isFile()) {
        fs.unlinkSync(filePath);
        console.log(`🗑️ Deleted file: ${fileName}`);
        
        const index = completedTorrents.findIndex(t => t.name === fileName);
        if (index !== -1) {
          completedTorrents.splice(index, 1);
        }
        
        throttledBroadcast();
        res.json({ success: true });
      } else {
        res.json({ error: 'Not a file' });
      }
    } else {
      res.json({ error: 'File not found' });
    }
  } catch (err) {
    console.error(`❌ Error deleting file ${fileName}:`, err.message);
    res.json({ error: err.message });
  }
});

// Cleanup old completed torrents periodically
// Update the existing cleanup interval
setInterval(() => {
  const now = Date.now();
  const stuckTorrents = activeTorrents.filter(torrent => {
    const isStuck = !torrent.fetching && 
                   torrent.progress < 1 && 
                   torrent.startTime &&
                   (now - torrent.startTime) > 5 * 60 * 1000 && // 5 minutes
                   torrent.downloadSpeed === 0 && 
                   torrent.numPeers === 0;
    return isStuck;
  });

  stuckTorrents.forEach(torrent => {
    console.log(`⏰ Removing stuck torrent: ${torrent.name}`);
    try {
      client.remove(torrent.infoHash);
    } catch (err) {
      console.warn('Error removing stuck torrent:', err.message);
    }
    
    const index = activeTorrents.indexOf(torrent);
    if (index !== -1) {
      activeTorrents.splice(index, 1);
    }
  });

  if (stuckTorrents.length > 0) {
    throttledBroadcast();
  }
}, 60 * 1000); // Run every minute // Run every hour


// Graceful shutdown with better port disposal
const gracefulShutdown = () => {
  console.log('\n🛑 Shutting down gracefully...');
  
  // Save state before shutdown
  saveTorrentState();
  
  // Pause all active torrents
  activeTorrents.forEach(torrent => {
    try {
      if (torrent.pause) {
        torrent.pause();
      }
    } catch (err) {
      console.warn(`Warning: Could not pause torrent ${torrent.name}:`, err.message);
    }
  });

  // Close WebSocket server
  if (wss) {
    wss.close(() => {
      console.log('✅ WebSocket server closed');
    });
  }

  // Destroy WebTorrent client
  if (client) {
    client.destroy((err) => {
      if (err) {
        console.error('❌ Error destroying client:', err.message);
      } else {
        console.log('✅ WebTorrent client destroyed');
      }
      process.exit(0);
    });
  } else {
    process.exit(0);
  }

  // Force exit after 10 seconds
  setTimeout(() => {
    console.log('⚠️ Force exiting...');
    process.exit(1);
  }, 10000);
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  gracefulShutdown();
});

app.listen(PORT, () => {
  console.log(`🚀 Optimized Torrent Downloader running at http://localhost:${PORT}`);
  console.log(`📡 WebSocket server running at ws://localhost:${wsPort}`);
  console.log(`📁 Downloads directory: ${downloadsDir}`);
});