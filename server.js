const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = 3000;
const HOST = '8.137.117.134';
const DATA_FILE = path.join(__dirname, 'data', 'blessings.json');

// 加载祝福数据
let blessings = [];
try {
  const data = fs.readFileSync(DATA_FILE, 'utf-8');
  blessings = JSON.parse(data);
} catch {
  blessings = [];
}

function saveBlessings() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(blessings, null, 2));
}

// 中间件
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// 提交祝福
app.post('/api/blessing', (req, res) => {
  const { name, message, color, emoji } = req.body;
  if (!message || !message.trim()) {
    return res.status(400).json({ error: '祝福内容不能为空' });
  }
  const blessing = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: (name || '匿名').trim(),
    message: message.trim(),
    color: color || '#ffffff',
    emoji: emoji || '',
    time: new Date().toISOString(),
  };
  blessings.push(blessing);
  saveBlessings();

  // 广播给所有展示端
  const payload = JSON.stringify({ type: 'new_blessing', data: blessing });
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(payload);
    }
  });

  res.json({ success: true, blessing });
});

// 获取所有祝福
app.get('/api/blessings', (req, res) => {
  res.json(blessings);
});

// 生成二维码
app.get('/api/qrcode', async (req, res) => {
  try {
    const type = req.query.type;
    const url = type === 'display'
      ? `http://${HOST}:${PORT}`
      : `http://${HOST}:${PORT}/submit`;
    const qrDataUrl = await QRCode.toDataURL(url, {
      width: 400,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
    });
    res.json({ url, qr: qrDataUrl });
  } catch (err) {
    res.status(500).json({ error: '生成二维码失败' });
  }
});

// WebSocket 连接处理
wss.on('connection', (ws) => {
  console.log('展示端已连接');
  ws.on('close', () => console.log('展示端已断开'));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🎂 生日祝福墙已启动!`);
  console.log(`   大屏展示: http://${HOST}:${PORT}`);
  console.log(`   手机提交: http://${HOST}:${PORT}/submit`);
  console.log(`   二维码页: http://${HOST}:${PORT}/qrcode`);
});
