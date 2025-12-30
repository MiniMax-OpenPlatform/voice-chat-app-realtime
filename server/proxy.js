/**
 * WebSocket 代理服务器
 * 解决浏览器 WebSocket 无法设置自定义 Authorization header 的问题
 *
 * 启动方式: node server/proxy.js
 */

const WebSocket = require('ws');
const http = require('http');
const url = require('url');

const PORT = process.env.PROXY_PORT || 8080;
const MINIMAX_WS_URL = 'wss://api.minimaxi.com/ws/v1/realtime';

// 创建 HTTP 服务器
const server = http.createServer((req, res) => {
  // 健康检查端点
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  res.writeHead(404);
  res.end();
});

// 创建 WebSocket 服务器
const wss = new WebSocket.Server({ server });

wss.on('connection', (clientWs, req) => {
  console.log('📥 新客户端连接');

  // 从 URL 查询参数获取 API Key 和 model
  const parsedUrl = url.parse(req.url, true);
  const apiKey = parsedUrl.query.apiKey;
  const model = parsedUrl.query.model || 'abab6.5s-chat';

  if (!apiKey) {
    console.error('❌ 缺少 API Key');
    clientWs.close(4001, 'Missing API Key');
    return;
  }

  // 连接到 MiniMax Realtime API
  const minimaxUrl = `${MINIMAX_WS_URL}?model=${model}`;
  console.log('🔗 连接到 MiniMax:', minimaxUrl);

  const minimaxWs = new WebSocket(minimaxUrl, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
  });

  let isConnected = false;

  minimaxWs.on('open', () => {
    console.log('✅ 已连接到 MiniMax Realtime API');
    isConnected = true;

    // 通知客户端连接成功
    clientWs.send(JSON.stringify({
      type: 'proxy.connected',
      message: 'Connected to MiniMax Realtime API',
    }));
  });

  minimaxWs.on('message', (data) => {
    // 转发 MiniMax 的消息给客户端
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(data.toString());
    }
  });

  minimaxWs.on('error', (error) => {
    console.error('❌ MiniMax WebSocket 错误:', error.message);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify({
        type: 'error',
        error: {
          type: 'proxy_error',
          message: `MiniMax connection error: ${error.message}`,
        },
      }));
    }
  });

  minimaxWs.on('close', (code, reason) => {
    console.log('🔌 MiniMax 连接关闭:', code, reason.toString());
    isConnected = false;
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.close(code, reason.toString());
    }
  });

  // 处理客户端消息
  clientWs.on('message', (data) => {
    // 转发客户端消息到 MiniMax
    if (minimaxWs.readyState === WebSocket.OPEN) {
      minimaxWs.send(data.toString());
    } else {
      console.warn('⚠️ MiniMax 未连接，无法转发消息');
    }
  });

  clientWs.on('close', (code, reason) => {
    console.log('📤 客户端断开连接:', code, reason);
    if (minimaxWs.readyState === WebSocket.OPEN) {
      minimaxWs.close();
    }
  });

  clientWs.on('error', (error) => {
    console.error('❌ 客户端 WebSocket 错误:', error.message);
    if (minimaxWs.readyState === WebSocket.OPEN) {
      minimaxWs.close();
    }
  });
});

server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║     MiniMax Realtime API WebSocket Proxy Server          ║
╠══════════════════════════════════════════════════════════╣
║  端口: ${PORT}                                              ║
║  地址: ws://localhost:${PORT}                               ║
║                                                          ║
║  客户端连接格式:                                          ║
║  ws://localhost:${PORT}?apiKey=YOUR_KEY&model=abab6.5s-chat ║
╚══════════════════════════════════════════════════════════╝
  `);
});

// 优雅关闭
process.on('SIGINT', () => {
  console.log('\n🛑 正在关闭服务器...');
  wss.clients.forEach((client) => {
    client.close();
  });
  server.close(() => {
    console.log('👋 服务器已关闭');
    process.exit(0);
  });
});
