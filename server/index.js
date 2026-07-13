'use strict';

const http = require('http');
const path = require('path');
const os = require('os');
const express = require('express');
const { WebSocketServer } = require('ws');
const config = require('./config');
const { Room } = require('./room');
const { listTargets, addTarget } = require('./game/roster');

const app = express();
const publicDir = path.join(__dirname, '..', 'public');

app.use(express.json({ limit: '6mb' }));
app.use(express.static(publicDir));

app.get('/health', (req, res) => {
  res.type('text').send('ok');
});

app.get('/api/info', (req, res) => {
  const joinUrls = getJoinUrls(config.port);
  res.json({
    name: 'SR Shooter 2',
    maxPlayers: config.maxPlayers,
    joinUrls,
    // alias kept for older admin clients
    lanUrls: joinUrls,
  });
});

app.get('/api/roster', (req, res) => {
  res.json({ targets: listTargets() });
});

/** Add target + optional PNG face (base64). Broadcasts updated roster to WS clients. */
app.post('/api/targets', (req, res) => {
  try {
    const name = (req.body && req.body.name) || '';
    const points = req.body && req.body.points;
    const faceBase64 = req.body && (req.body.faceBase64 || req.body.faceData);
    const faceOriginalName = (req.body && req.body.faceOriginalName) || 'face.png';
    if (!String(name).trim()) {
      res.status(400).json({ error: 'Name required' });
      return;
    }
    if (faceBase64 && !/png/i.test(faceOriginalName) && !String(faceBase64).includes('image/png')) {
      // still allow if magic bytes check passes in saveFacePng
    }
    const entry = addTarget({
      name,
      points,
      faceBase64: faceBase64 || '',
      faceOriginalName,
    });
    if (room) room.broadcastTargets();
    res.json({ ok: true, target: entry, targets: listTargets() });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to add target' });
  }
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const room = new Room();

wss.on('connection', (ws) => {
  room.handleConnect(ws);
  ws.on('message', (data) => room.handleMessage(ws, data.toString()));
  ws.on('close', () => room.handleClose(ws));
  ws.on('error', () => room.handleClose(ws));
});

const host = process.env.HOST || '0.0.0.0';
server.listen(config.port, host, () => {
  const urls = getJoinUrls(config.port);
  console.log('');
  console.log('  SR Shooter 2');
  console.log('  -----------');
  console.log(`  Bind:     ${host}:${config.port}`);
  console.log(`  Local:    http://localhost:${config.port}`);
  for (const u of urls) {
    console.log(`  Players:  ${u}`);
  }
  console.log(`  Admin:    ${urls[0] ? `${urls[0].replace(/\/$/, '')}/admin.html` : `http://localhost:${config.port}/admin.html`}`);
  console.log('');
});

/** Prefer PUBLIC_URL (production HTTPS domain); else LAN IPs for local play. */
function getJoinUrls(port) {
  const publicUrl = String(process.env.PUBLIC_URL || '')
    .trim()
    .replace(/\/$/, '');
  if (publicUrl) return [publicUrl];

  const urls = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        urls.push(`http://${iface.address}:${port}`);
      }
    }
  }
  return urls;
}
