import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Message, VOICE_OPTIONS, ConnectionStatus } from './types';
import { RealtimeService } from './services/realtimeService';
import { AudioProcessor } from './services/audioProcessor';
import './App.css';

// 默认系统提示词
const DEFAULT_SYSTEM_PROMPT = `你是一位友善、专业的英语学习辅助助手，致力于帮助用户提升英语表达能力。你的核心职责包括：

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
  const [isConversationMode, setIsConversationMode] = useState(false);  // 持续对话模式
  const [isListening, setIsListening] = useState(false);  // 正在监听用户说话
  const [isResponding, setIsResponding] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [selectedVoice, setSelectedVoice] = useState('male-qn-qingse');
  const [volume, setVolume] = useState(0);  // 麦克风音量

  // 配置状态
  const [apiKey, setApiKey] = useState(process.env.REACT_APP_API_KEY || '');
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
  const [showSettings, setShowSettings] = useState(false);  // 设置面板显示

  // ==================== Refs ====================
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const realtimeRef = useRef<RealtimeService | null>(null);
  const audioProcessorRef = useRef<AudioProcessor | null>(null);
  const streamingTextRef = useRef('');
  const isInterruptedRef = useRef(false);  // 打断标志，用于忽略后续音频数据
  const isConversationModeRef = useRef(false);  // 对话模式 ref（用于回调中访问最新状态）
  const hasSpeechRef = useRef(false);  // 本轮是否有说话

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

  // 启动麦克风监听
  const startListening = useCallback(async () => {
    if (!audioProcessorRef.current || !realtimeRef.current?.isConnectedState()) return;

    try {
      hasSpeechRef.current = false;
      audioProcessorRef.current.resetVADState();
      await audioProcessorRef.current.startCapture((base64) => {
        realtimeRef.current?.appendAudio(base64);
      });
      setIsListening(true);
      console.log('👂 开始监听...');
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  // 用于在回调中调用最新版本的 startListening
  const startListeningRef = useRef(startListening);
  startListeningRef.current = startListening;

  // 停止麦克风监听
  const stopListening = useCallback(() => {
    if (!audioProcessorRef.current) return;
    audioProcessorRef.current.stopCapture();
    setIsListening(false);
    setVolume(0);
    console.log('🔇 停止监听');
  }, []);

  // 处理用户说话结束（VAD 检测到静音）- 使用 ref 存储
  const handleSpeechEndRef = useRef(() => {});
  handleSpeechEndRef.current = () => {
    if (!isConversationModeRef.current || !hasSpeechRef.current) return;

    // 如果 AI 正在说话，不处理静音结束（等待用户继续说话或打断完成）
    if (isRespondingRef.current) return;

    console.log('📤 静音超时，提交音频并触发响应');
    // 不停止监听！保持麦克风开启以便检测打断
    // stopListening();

    // 重置说话状态，准备下一轮
    hasSpeechRef.current = false;
    audioProcessorRef.current?.resetVADState();

    // 提交音频并触发响应
    realtimeRef.current?.commitAudio();
    realtimeRef.current?.createResponse();
  };

  // 处理用户开始说话（VAD 检测到声音）- 使用 ref 存储
  const isRespondingRef = useRef(false);
  isRespondingRef.current = isResponding;
  const isListeningRef = useRef(false);
  isListeningRef.current = isListening;

  const handleSpeechStartRef = useRef(() => {});
  handleSpeechStartRef.current = () => {
    hasSpeechRef.current = true;

    // 如果 AI 正在说话，自动打断
    if (isRespondingRef.current) {
      console.log('🛑 用户开始说话，自动打断 AI');
      isInterruptedRef.current = true;
      audioProcessorRef.current?.stopPlayback();
      realtimeRef.current?.interrupt();
      // 清空之前的音频缓冲区，重新开始
      realtimeRef.current?.clearAudioBuffer();
      setIsResponding(false);
      setStreamingText('');
      streamingTextRef.current = '';
      // 重置 hasSpeech，让新的语音输入重新开始计算
      hasSpeechRef.current = true;
    }
  };

  // ==================== 初始化服务 ====================
  const initializeService = useCallback((key: string, prompt: string, voice: string) => {
    // 清理旧服务
    if (realtimeRef.current) {
      realtimeRef.current.disconnect();
    }
    if (audioProcessorRef.current) {
      audioProcessorRef.current.destroy();
    }

    // 初始化新服务
    realtimeRef.current = new RealtimeService({
      apiKey: key,
      voice: voice,
      instructions: prompt,
    });

    audioProcessorRef.current = new AudioProcessor();

    // 设置 VAD 回调
    audioProcessorRef.current.setVADCallbacks({
      onSpeechStart: () => handleSpeechStartRef.current(),
      onSpeechEnd: () => handleSpeechEndRef.current(),
      onVolumeChange: (vol) => setVolume(vol),
    });

    // 设置 Realtime 回调
    setupRealtimeCallbacks();

    console.log('✅ 服务已初始化');
  }, []);

  // 设置 Realtime 回调
  const setupRealtimeCallbacks = useCallback(() => {
    if (!realtimeRef.current) return;

    realtimeRef.current.setCallbacks({
      onConnected: () => {
        setConnectionStatus('connected');
        setError(null);
        console.log('✅ 已连接到 Realtime API');
      },

      onDisconnected: () => {
        setConnectionStatus('disconnected');
        isConversationModeRef.current = false;
        setIsConversationMode(false);
        setIsListening(false);
        setIsResponding(false);
      },

      onUserTranscript: (transcript) => {
        console.log('🎤 用户语音:', transcript);
        addMessage('user', transcript, true);
      },

      onResponseStart: () => {
        isInterruptedRef.current = false;
        setIsResponding(true);
        setStreamingText('');
        streamingTextRef.current = '';
      },

      onTextDelta: (delta) => {
        if (isInterruptedRef.current) return;
        setIsResponding(true);
        streamingTextRef.current += delta;
        setStreamingText(streamingTextRef.current);
      },

      onTextDone: (text) => {
        if (isInterruptedRef.current) return;
        addMessage('assistant', text);
        setStreamingText('');
        streamingTextRef.current = '';
      },

      onAudioDelta: (audioBase64) => {
        if (isInterruptedRef.current) return;
        setIsResponding(true);
        audioProcessorRef.current?.playAudioChunk(audioBase64);
      },

      onAudioDone: () => {
        console.log('🔊 AI 音频流接收完成');
        const checkPlaybackDone = () => {
          if (!audioProcessorRef.current?.isCurrentlyPlaying()) {
            console.log('🔊 AI 音频播放完成');
            if (!isInterruptedRef.current) {
              setIsResponding(false);
            }
            isInterruptedRef.current = false;

            if (isConversationModeRef.current) {
              console.log('🔄 AI 说完，继续监听...');
              hasSpeechRef.current = false;
              audioProcessorRef.current?.resetVADState();
              if (!isListeningRef.current) {
                startListeningRef.current();
              }
            }
          } else {
            setTimeout(checkPlaybackDone, 200);
          }
        };
        setTimeout(checkPlaybackDone, 200);
      },

      onResponseDone: (usage) => {
        if (usage) {
          console.log('📊 Token 使用:', usage);
        }
      },

      onError: (err) => {
        setError(`API 错误: ${err.message}`);
        setIsResponding(false);
      },
    });
  }, [addMessage]);

  // 初始化 effect
  useEffect(() => {
    const defaultVoice = process.env.REACT_APP_DEFAULT_VOICE || 'male-qn-qingse';
    setSelectedVoice(defaultVoice);

    // 只初始化 AudioProcessor
    audioProcessorRef.current = new AudioProcessor();
    audioProcessorRef.current.setVADCallbacks({
      onSpeechStart: () => handleSpeechStartRef.current(),
      onSpeechEnd: () => handleSpeechEndRef.current(),
      onVolumeChange: (vol) => setVolume(vol),
    });

    return () => {
      realtimeRef.current?.disconnect();
      audioProcessorRef.current?.destroy();
    };
  }, []);

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

    // 验证 API Key
    if (!apiKey.trim()) {
      setError('请输入 API Key');
      setShowSettings(true);
      return;
    }

    setConnectionStatus('connecting');
    setError(null);

    try {
      // 初始化或重新初始化服务
      realtimeRef.current = new RealtimeService({
        apiKey: apiKey.trim(),
        voice: selectedVoice,
        instructions: systemPrompt,
      });
      setupRealtimeCallbacks();

      await realtimeRef.current.connect();
    } catch (err: any) {
      setConnectionStatus('error');
      setError('连接失败: ' + err.message);
    }
  };

  const handleDisconnect = () => {
    // 退出对话模式
    isConversationModeRef.current = false;
    setIsConversationMode(false);
    stopListening();

    realtimeRef.current?.disconnect();
    audioProcessorRef.current?.stopPlayback();
    setConnectionStatus('disconnected');
    setIsResponding(false);
  };

  // ==================== 语音输入（对话模式切换） ====================
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

    if (isConversationMode) {
      // 退出对话模式
      console.log('🛑 退出对话模式');
      isConversationModeRef.current = false;
      setIsConversationMode(false);

      // 停止监听
      stopListening();

      // 清空音频缓冲区（不提交，避免空数据错误）
      realtimeRef.current?.clearAudioBuffer();

      // 停止 AI 播放
      if (isResponding) {
        isInterruptedRef.current = true;
        audioProcessorRef.current?.stopPlayback();
        realtimeRef.current?.interrupt();
        setIsResponding(false);
        setStreamingText('');
        streamingTextRef.current = '';
      }
    } else {
      // 进入对话模式
      console.log('🎙️ 进入对话模式');

      // 如果 AI 正在说话，打断它
      if (isResponding) {
        isInterruptedRef.current = true;
        audioProcessorRef.current?.stopPlayback();
        realtimeRef.current?.interrupt();
        setIsResponding(false);
        setStreamingText('');
        streamingTextRef.current = '';
      }

      // 设置对话模式
      isConversationModeRef.current = true;
      setIsConversationMode(true);

      // 开始监听
      await startListening();
      setError(null);
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
          <button
            className="btn btn-settings"
            onClick={() => setShowSettings(!showSettings)}
            title="设置"
          >
            ⚙️
          </button>
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

      {/* 设置面板 */}
      {showSettings && (
        <div className="settings-panel">
          <div className="settings-header">
            <h3>设置</h3>
            <button className="btn-close" onClick={() => setShowSettings(false)}>×</button>
          </div>

          <div className="settings-content">
            <div className="setting-item">
              <label>API Key</label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="输入 MiniMax API Key"
                disabled={isConnected}
              />
              {!apiKey && <span className="setting-hint">必填，用于连接 MiniMax Realtime API</span>}
            </div>

            <div className="setting-item">
              <label>人设提示词 (System Prompt)</label>
              <textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="输入 AI 助手的人设和行为指导..."
                rows={8}
                disabled={isConnected}
              />
              <span className="setting-hint">
                {isConnected ? '断开连接后可修改' : '定义 AI 助手的角色、性格和行为方式'}
              </span>
            </div>

            <div className="setting-actions">
              <button
                className="btn btn-reset"
                onClick={() => setSystemPrompt(DEFAULT_SYSTEM_PROMPT)}
                disabled={isConnected}
              >
                恢复默认
              </button>
            </div>
          </div>
        </div>
      )}

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
            {isResponding && !isConversationMode && (
              <button type="button" className="btn btn-interrupt" onClick={handleInterrupt} title="打断">
                ⏹️
              </button>
            )}

            <button
              type="button"
              className={`btn btn-voice ${isConversationMode ? 'conversation-mode' : ''} ${isListening ? 'listening' : ''}`}
              onClick={handleVoiceInput}
              disabled={connectionStatus === 'connecting'}
              title={isConversationMode ? '结束对话' : '开始对话'}
              style={isListening ? { boxShadow: `0 0 ${10 + volume * 30}px rgba(59, 130, 246, ${0.5 + volume * 0.5})` } : undefined}
            >
              {isConversationMode ? (isListening ? '👂' : '💬') : '🎤'}
            </button>

            {isResponding && !isConversationMode && (
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
          {isConversationMode && (
            <div className="status-item conversation">
              <span className="status-dot pulse"></span>
              <span>对话模式</span>
            </div>
          )}
          {isListening && (
            <div className="status-item recording">
              <span className="status-dot pulse"></span>
              <span>正在听...</span>
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
