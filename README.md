# Voice Chat App - Realtime API

基于 MiniMax Realtime API 的智能语音对话应用，实现低延迟的实时语音交互体验。

## 特性

- 🎤 **实时语音识别** - 使用 WebSocket 流式传输音频
- 🤖 **智能对话** - 集成 MiniMax 大语言模型
- 🔊 **流式语音合成** - 实时播放 AI 语音回复
- ⚡ **低延迟** - 首字延迟 < 0.5 秒
- 🔄 **语音打断** - 支持打断 AI 说话

## 技术架构

```
┌─────────────────────────────────────────────────────────────┐
│  浏览器                                                      │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────┐  │
│  │ MediaStream │───▶│  WebSocket  │───▶│  Web Audio API  │  │
│  │   (采集)    │    │  (全双工)   │    │    (播放)        │  │
│  │   PCM 24kHz │    │  Realtime   │    │                 │  │
│  └─────────────┘    └─────────────┘    └─────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## 与传统方案对比

| 指标 | 传统方案 (ASR+LLM+TTS) | Realtime API |
|------|------------------------|--------------|
| 首字延迟 | 3-5 秒 | < 0.5 秒 |
| API 调用 | 3 次/轮 | 1 次/轮 |
| 代码复杂度 | 高 | 低 |
| 语音打断 | 需手动实现 | 原生支持 |

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

复制 `.env.example` 为 `.env` 并填入 API Key：

```bash
cp .env.example .env
```

编辑 `.env` 文件：

```
REACT_APP_API_KEY=your_minimax_api_key_here
REACT_APP_MODEL=abab6.5s-chat
REACT_APP_DEFAULT_VOICE=male-qn-qingse
```

### 3. 启动服务

由于浏览器 WebSocket 无法设置自定义 Authorization header，需要先启动代理服务器：

**方式一：分别启动（推荐调试时使用）**

```bash
# 终端 1：启动代理服务器
npm run proxy

# 终端 2：启动前端
npm start
```

**方式二：同时启动**

```bash
npm run dev
```

访问 http://localhost:3000

> 注意：代理服务器运行在 ws://localhost:8080

## 项目结构

```
src/
├── App.tsx                    # 主应用组件
├── App.css                    # 样式文件
├── types.ts                   # 类型定义
├── index.tsx                  # 入口文件
└── services/
    ├── realtimeService.ts     # Realtime API 服务
    └── audioProcessor.ts      # 音频采集和播放

server/
├── proxy.js                   # WebSocket 代理服务器
└── package.json               # 代理服务器依赖
```

## 核心组件

### RealtimeService

负责 WebSocket 连接和事件处理：

- `connect()` - 建立连接
- `sendText(text)` - 发送文本消息
- `appendAudio(base64)` - 发送音频数据
- `commitAudio()` - 提交音频触发识别
- `createResponse()` - 触发 AI 响应
- `interrupt()` - 打断当前响应

### AudioProcessor

负责音频采集和播放：

- `startCapture(callback)` - 开始采集麦克风
- `stopCapture()` - 停止采集
- `playAudioChunk(base64)` - 播放音频块
- `stopPlayback()` - 停止播放

## 音频格式

- 格式：PCM16
- 采样率：24kHz
- 声道：单声道
- 编码：Base64

## 浏览器兼容性

| 浏览器 | 支持 |
|--------|------|
| Chrome 90+ | ✅ |
| Edge 90+ | ✅ |
| Safari 14+ | ✅ |
| Firefox | ⚠️ 部分支持 |

## License

MIT
