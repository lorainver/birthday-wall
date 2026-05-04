const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = 3000;
const HOST = '8.137.117.134';
const DATA_FILE = path.join(__dirname, 'data', 'blessings.json');
const MBTI_FILE = path.join(__dirname, 'data', 'mbti_results.json');

// 加载 MBTI 测试结果
let mbtiResults = {};
try {
  const mbtiData = fs.readFileSync(MBTI_FILE, 'utf-8');
  mbtiResults = JSON.parse(mbtiData);
} catch {
  mbtiResults = {};
}

function saveMbtiResults() {
  fs.writeFileSync(MBTI_FILE, JSON.stringify(mbtiResults, null, 2));
}

// 配置音频上传目录
const AUDIO_DIR = path.join(__dirname, 'assets', 'audio');
if (!fs.existsSync(AUDIO_DIR)) {
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
}

// 配置 multer
const storage = multer.diskStorage({
  destination: AUDIO_DIR,
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    cb(null, uniqueSuffix + '.webm');
  }
});
const upload = multer({ 
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }
});

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

// 提交祝福（支持带音频）
app.post('/api/blessing', upload.single('audio'), (req, res) => {
  const { name, message, color, emoji, mbti_type } = req.body;
  if (!message || !message.trim()) {
    return res.status(400).json({ error: '祝福内容不能为空' });
  }
  
  const audioFile = req.file ? '/assets/audio/' + req.file.filename : '';
  
  const blessing = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: (name || '匿名').trim(),
    message: message.trim(),
    color: color || '#ffffff',
    emoji: emoji || '',
    audio: audioFile,
    mbti_type: mbti_type || '',
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

// 撤回祝福
app.delete('/api/blessing/:id', (req, res) => {
  const { id } = req.params;
  const idx = blessings.findIndex(b => b.id === id);
  if (idx === -1) {
    return res.status(404).json({ error: '祝福不存在' });
  }
  
  // 删除音频文件（如果有）
  const blessing = blessings[idx];
  if (blessing.audio) {
    const audioPath = path.join(__dirname, 'public', blessing.audio);
    fs.unlink(audioPath, () => {}); // 忽略错误
  }
  
  // 从数组中删除
  blessings.splice(idx, 1);
  saveBlessings();
  
  // 广播删除消息
  const payload = JSON.stringify({ type: 'delete_blessing', id });
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(payload);
    }
  });
  
  res.json({ success: true });
});

// 保存 MBTI 测试结果
app.post('/api/mbti-result', (req, res) => {
  const { userId, mbti_type } = req.body;
  if (!userId || !mbti_type) {
    return res.status(400).json({ error: '参数不完整' });
  }
  mbtiResults[userId] = { mbti_type, time: new Date().toISOString() };
  saveMbtiResults();
  res.json({ success: true, mbti_type });
});

// 获取 MBTI 测试结果
app.get('/api/mbti-result/:userId', (req, res) => {
  const result = mbtiResults[req.params.userId];
  if (!result) {
    return res.status(404).json({ error: '未找到测试结果' });
  }
  res.json(result);
});

// 生成二维码
app.get('/api/qrcode', async (req, res) => {
  try {
    const type = req.query.type;
    const url = type === 'display'
      ? 'http://' + HOST + ':' + PORT
      : 'http://' + HOST + ':' + PORT + '/submit';
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
  console.log('🎂 生日祝福墙已启动!');
  console.log('   大屏展示: http://' + HOST + ':' + PORT);
  console.log('   手机提交: http://' + HOST + ':' + PORT + '/submit');
  console.log('   二维码页: http://' + HOST + ':' + PORT + '/qrcode');
});
