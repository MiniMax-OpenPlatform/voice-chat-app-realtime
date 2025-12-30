import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Message, VOICE_OPTIONS, ConnectionStatus } from './types';
import { RealtimeService } from './services/realtimeService';
import { AudioProcessor } from './services/audioProcessor';
import './App.css';

// 系统提示词 - 英语学习助手
const SYSTEM_PROMPT = `你是一位友善、专业的英语学习辅助助手，致力于帮助用户提升英语表达能力。你的核心职责包括：

【评测维度】
针对用户的每一轮英语对话内容，请从以下三个维度进行评估：

1. 语法准确性（Grammar Accuracy）：
   - 仔细检查语法错误（时态、主谓一致、冠词使用、介词搭配等）
   - 如有错误：温和地指出具体问题，并简要说明正确用法
   - 如无错误：给予肯定鼓励

2. 表达地道性（Expression Authenticity）：
   - 判断用词和句式是否符合英语母语者的表达习惯
   - 如可优化：提供1-2个更地道、自然的表达方式供参考

3. 综合评分（0-100分）：
   - 根据语法准确性、词汇丰富度、表达流畅度综合打分

【反馈风格】
- 保持鼓励和正面的态度
- 建议要具体、可操作
- 语言简洁友好

【互动引导】
在完成评测反馈后，请主动提出一个相关的开放性问题来延续对话。

记住：你的目标是让学习过程轻松愉快，在纠正错误的同时保护用户的学习热情。`;

const App: React.FC = () => {
  // ==================== 状态 ====================
  const [messages, setMessages] = useState<Message[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [isRecording, setIsRecording] = useState(false);
  const [isResponding, setIsResponding] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [selectedVoice, setSelectedVoice] = useState('male-qn-qingse');

  // ==================== Refs ====================
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const realtimeRef = useRef<RealtimeService | null>(null);
  const audioProcessorRef = useRef<AudioProcessor | null>(null);
  const streamingTextRef = useRef('');
  const isInterruptedRef = useRef(false);  // 打断标志，用于忽略后续音频数据

  // ==================== 辅助函数 ====================
  const addMessage = useCallback((role: 'user' | 'assistant', content: string, isAudio = false) => {
    const message: Message = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      role,
      content,
      timestamp: new Date(),
      isAudio,
    };
    setMessages((prev) => [...prev, message]);
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // ==================== 初始化 ====================
  useEffect(() => {
    const apiKey = process.env.REACT_APP_API_KEY || '';
    const defaultVoice = process.env.REACT_APP_DEFAULT_VOICE || 'male-qn-qingse';

    if (!apiKey) {
      setError('请在 .env 文件中配置 REACT_APP_API_KEY');
      return;
    }

    setSelectedVoice(defaultVoice);

    // 初始化服务
    realtimeRef.current = new RealtimeService({
      apiKey,
      voice: defaultVoice,
      instructions: SYSTEM_PROMPT,
    });

    audioProcessorRef.current = new AudioProcessor();

    // 设置回调
    realtimeRef.current.setCallbacks({
      onConnected: () => {
        setConnectionStatus('connected');
        setError(null);
        console.log('✅ 已连接到 Realtime API');
      },

      onDisconnected: () => {
        setConnectionStatus('disconnected');
        setIsRecording(false);
        setIsResponding(false);
      },

      onUserTranscript: (transcript) => {
        // 用户语音识别完成
        console.log('🎤 用户语音:', transcript);
        addMessage('user', transcript, true);
      },

      onResponseStart: () => {
        // 新响应开始，重置打断标志
        isInterruptedRef.current = false;
        setIsResponding(true);
        setStreamingText('');
        streamingTextRef.current = '';
      },

      onTextDelta: (delta) => {
        // 如果已打断，忽略后续文本
        if (isInterruptedRef.current) return;
        setIsResponding(true);
        streamingTextRef.current += delta;
        setStreamingText(streamingTextRef.current);
      },

      onTextDone: (text) => {
        // 如果已打断，不添加消息
        if (isInterruptedRef.current) return;
        addMessage('assistant', text);
        setStreamingText('');
        streamingTextRef.current = '';
      },

      onAudioDelta: (audioBase64) => {
        // 如果已打断，忽略后续音频
        if (isInterruptedRef.current) return;
        setIsResponding(true);
        audioProcessorRef.current?.playAudioChunk(audioBase64);
      },

      onAudioDone: () => {
        console.log('🔊 AI 音频流接收完成');
        // 音频流接收完成，但本地可能还在播放
        // 延迟检查播放状态，等待播放队列清空
        const checkPlaybackDone = () => {
          if (!audioProcessorRef.current?.isCurrentlyPlaying()) {
            console.log('🔊 AI 音频播放完成');
            if (!isInterruptedRef.current) {
              setIsResponding(false);
            }
            isInterruptedRef.current = false;
          } else {
            // 还在播放，继续检查
            setTimeout(checkPlaybackDone, 200);
          }
        };
        setTimeout(checkPlaybackDone, 200);
      },

      onResponseDone: (usage) => {
        // 响应数据发送完成，但不立即隐藏打断按钮
        // 等待 onAudioDone 中的播放完成检查
        if (usage) {
          console.log('📊 Token 使用:', usage);
        }
      },

      onError: (err) => {
        setError(`API 错误: ${err.message}`);
        setIsResponding(false);
      },
    });

    return () => {
      realtimeRef.current?.disconnect();
      audioProcessorRef.current?.destroy();
    };
  }, [addMessage]);

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText]);

  // 自动清除错误
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  // ==================== 连接控制 ====================
  const handleConnect = async () => {
    if (connectionStatus === 'connecting') return;

    setConnectionStatus('connecting');
    setError(null);

    try {
      await realtimeRef.current?.connect();
    } catch (err: any) {
      setConnectionStatus('error');
      setError('连接失败: ' + err.message);
    }
  };

  const handleDisconnect = () => {
    realtimeRef.current?.disconnect();
    audioProcessorRef.current?.stopPlayback();
    setConnectionStatus('disconnected');
    setIsRecording(false);
    setIsResponding(false);
  };

  // ==================== 语音输入 ====================
  const handleVoiceInput = async () => {
    // 如果未连接，先连接
    if (!realtimeRef.current?.isConnectedState()) {
      await handleConnect();
      // 等待连接完成
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (!realtimeRef.current?.isConnectedState()) {
        return;
      }
    }

    if (isRecording) {
      // 停止录音
      audioProcessorRef.current?.stopCapture();
      setIsRecording(false);

      // 提交音频并触发响应
      realtimeRef.current?.commitAudio();
      realtimeRef.current?.createResponse();
    } else {
      // 如果 AI 正在说话，打断它
      if (isResponding) {
        audioProcessorRef.current?.stopPlayback();
        realtimeRef.current?.interrupt();
        setIsResponding(false);
        setStreamingText('');
      }

      // 开始录音
      try {
        await audioProcessorRef.current?.startCapture((base64) => {
          realtimeRef.current?.appendAudio(base64);
        });
        setIsRecording(true);
        setError(null);
      } catch (err: any) {
        setError(err.message);
      }
    }
  };

  // ==================== 打断 ====================
  const handleInterrupt = () => {
    // 设置打断标志，忽略后续收到的音频和文本数据
    isInterruptedRef.current = true;
    // 停止本地音频播放
    audioProcessorRef.current?.stopPlayback();
    // 清空音频输入缓冲区
    realtimeRef.current?.interrupt();
    // 清空流式文本显示
    setStreamingText('');
    streamingTextRef.current = '';
    // 隐藏打断按钮
    setIsResponding(false);
  };

  // ==================== 音色切换 ====================
  const handleVoiceChange = (voiceId: string) => {
    setSelectedVoice(voiceId);
    if (connectionStatus === 'connected') {
      realtimeRef.current?.updateSession({ voice: voiceId });
    }
  };

  // ==================== 清空对话 ====================
  const handleClearChat = () => {
    setMessages([]);
    setStreamingText('');
  };

  // ==================== 渲染 ====================
  const isConnected = connectionStatus === 'connected';

  return (
    <div className="app">
      {/* 头部 */}
      <header className="header">
        <div className="header-left">
          <h1>智能语音助手</h1>
          <span className="version-tag">Realtime API</span>
        </div>
        <div className="header-right">
          <span className={`connection-status ${connectionStatus}`}>
            {connectionStatus === 'connected' && '● 已连接'}
            {connectionStatus === 'connecting' && '○ 连接中...'}
            {connectionStatus === 'disconnected' && '○ 未连接'}
            {connectionStatus === 'error' && '● 连接错误'}
          </span>
          {isConnected ? (
            <button className="btn btn-disconnect" onClick={handleDisconnect}>
              断开连接
            </button>
          ) : (
            <button
              className="btn btn-connect"
              onClick={handleConnect}
              disabled={connectionStatus === 'connecting'}
            >
              {connectionStatus === 'connecting' ? '连接中...' : '连接'}
            </button>
          )}
        </div>
      </header>

      {/* 聊天区域 */}
      <div className="chat-container">
        <div className="messages-container">
          {messages.length === 0 && !streamingText ? (
            <div className="empty-state">
              <div className="empty-icon">👋</div>
              <h2>欢迎使用 MiniMax 智能语音助手</h2>
              <p>使用 Realtime API 实现低延迟语音对话</p>
              <div className="features">
                <div className="feature">
                  <span className="feature-icon">🎤</span>
                  <span>实时语音识别</span>
                </div>
                <div className="feature">
                  <span className="feature-icon">🤖</span>
                  <span>智能对话</span>
                </div>
                <div className="feature">
                  <span className="feature-icon">🔊</span>
                  <span>流式语音合成</span>
                </div>
              </div>
              {!isConnected && (
                <button className="btn btn-primary btn-large" onClick={handleConnect}>
                  开始使用
                </button>
              )}
            </div>
          ) : (
            <>
              {messages.map((message) => (
                <div key={message.id} className={`message ${message.role}`}>
                  <div className="message-bubble">
                    <div className="message-content">
                      {message.content}
                      {message.isAudio && <span className="audio-indicator">🎤</span>}
                    </div>
                    <div className="message-time">
                      {message.timestamp.toLocaleTimeString('zh-CN', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                  </div>
                </div>
              ))}

              {/* AI 响应流式显示 */}
              {streamingText && (
                <div className="message assistant">
                  <div className="message-bubble streaming">
                    <div className="message-content">
                      {streamingText}
                      <span className="streaming-cursor">▋</span>
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="error-message" onClick={clearError}>
            {error}
            <span className="error-close">×</span>
          </div>
        )}

        {/* 设置栏 */}
        <div className="settings-bar">
          <div className="voice-selector">
            <label>🎤 音色：</label>
            <select value={selectedVoice} onChange={(e) => handleVoiceChange(e.target.value)}>
              {VOICE_OPTIONS.map((voice) => (
                <option key={voice.id} value={voice.id}>
                  {voice.name}
                </option>
              ))}
            </select>
          </div>
          {messages.length > 0 && (
            <button className="btn btn-clear" onClick={handleClearChat}>
              🗑️ 清空对话
            </button>
          )}
        </div>

        {/* 语音输入区域 */}
        <div className="input-container">
          <div className="action-buttons">
            {isResponding && (
              <button type="button" className="btn btn-interrupt" onClick={handleInterrupt} title="打断">
                ⏹️
              </button>
            )}

            <button
              type="button"
              className={`btn btn-voice ${isRecording ? 'recording' : ''}`}
              onClick={handleVoiceInput}
              disabled={connectionStatus === 'connecting'}
              title={isRecording ? '停止录音' : '开始语音输入'}
            >
              {isRecording ? '🔴' : '🎤'}
            </button>

            {isResponding && (
              <div style={{ width: 56 }} /> /* 占位，保持按钮居中 */
            )}
          </div>
        </div>

        {/* 状态栏 */}
        <div className="status-bar">
          <div className="status-item">
            <span className={`status-dot ${isConnected ? 'active' : ''}`}></span>
            <span>Realtime API</span>
          </div>
          {isRecording && (
            <div className="status-item recording">
              <span className="status-dot pulse"></span>
              <span>录音中...</span>
            </div>
          )}
          {isResponding && (
            <div className="status-item">
              <span className="status-dot active"></span>
              <span>AI 回复中...</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;
