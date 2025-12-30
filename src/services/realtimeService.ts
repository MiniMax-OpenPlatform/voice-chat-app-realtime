/**
 * MiniMax Realtime API 服务
 * 基于 WebSocket 的实时语音对话服务
 */

export interface RealtimeConfig {
  apiKey: string;
  model?: string;
  voice?: string;
  instructions?: string;
  useProxy?: boolean;  // 是否使用本地代理（解决浏览器认证问题）
  proxyUrl?: string;   // 代理服务器地址
}

export interface RealtimeCallbacks {
  // 连接状态
  onConnected?: () => void;
  onDisconnected?: () => void;

  // 用户语音 ASR
  onUserTranscript?: (transcript: string) => void;

  // AI 响应
  onResponseStart?: () => void;
  onTextDelta?: (delta: string) => void;
  onTextDone?: (text: string) => void;
  onAudioDelta?: (audioBase64: string) => void;
  onAudioDone?: () => void;
  onAudioTranscriptDelta?: (delta: string) => void;
  onAudioTranscriptDone?: (transcript: string) => void;
  onResponseDone?: (usage: ResponseUsage | null) => void;

  // 错误
  onError?: (error: { type: string; message: string; code?: string }) => void;
}

export interface ResponseUsage {
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  total_asr_time?: number;
  total_audio_characters?: number;
}

export class RealtimeService {
  private ws: WebSocket | null = null;
  private config: RealtimeConfig;
  private callbacks: RealtimeCallbacks = {};
  private isConnected = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;
  private connectResolve: (() => void) | null = null;
  private connectReject: ((error: Error) => void) | null = null;
  private manualDisconnect = false;  // 标记是否为用户主动断开
  private heartbeatInterval: NodeJS.Timeout | null = null;  // 心跳定时器
  private readonly HEARTBEAT_INTERVAL = 60000;  // 心跳间隔：60秒（小于120秒超时）

  constructor(config: RealtimeConfig) {
    this.config = {
      model: 'abab6.5s-chat',
      voice: 'male-qn-qingse',
      useProxy: true,  // 默认使用代理
      proxyUrl: 'ws://localhost:8080',
      ...config,
    };
  }

  // ==================== 连接管理 ====================

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.isConnected) {
        resolve();
        return;
      }

      // 根据配置选择连接方式
      let url: string;
      if (this.config.useProxy) {
        // 使用本地代理服务器（推荐，解决浏览器认证问题）
        url = `${this.config.proxyUrl}?apiKey=${encodeURIComponent(this.config.apiKey)}&model=${this.config.model}`;
        console.log('🔌 通过代理连接 Realtime API...');
      } else {
        // 直连（仅用于测试，浏览器可能无法正常认证）
        url = `wss://api.minimaxi.com/ws/v1/realtime?model=${this.config.model}`;
        console.log('🔌 直接连接 Realtime API...');
      }

      try {
        this.ws = new WebSocket(url);
      } catch (e) {
        console.error('WebSocket 创建失败:', e);
        reject(e);
        return;
      }

      // 保存 resolve/reject 以便在收到 proxy.connected 事件时调用
      this.connectResolve = resolve;
      this.connectReject = reject;

      this.ws.onopen = () => {
        console.log('✅ WebSocket 已连接');
        // 如果使用代理，等待 proxy.connected 事件确认
        if (!this.config.useProxy) {
          this.isConnected = true;
          this.reconnectAttempts = 0;
          this.initSession();
          this.callbacks.onConnected?.();
          this.connectResolve?.();
          this.connectResolve = null;
          this.connectReject = null;
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleServerEvent(data);
        } catch (e) {
          console.error('❌ 解析消息失败:', e);
        }
      };

      this.ws.onerror = (error) => {
        console.error('❌ WebSocket 错误:', error);
        const errorMsg = this.config.useProxy
          ? 'WebSocket 连接失败，请确保代理服务器已启动 (node server/proxy.js)'
          : 'WebSocket 连接失败';
        this.connectReject?.(new Error(errorMsg));
        this.connectResolve = null;
        this.connectReject = null;
      };

      this.ws.onclose = (event) => {
        console.log('🔌 WebSocket 已断开', event.code, event.reason);
        this.isConnected = false;
        this.callbacks.onDisconnected?.();

        // 如果是用户主动断开，不尝试重连
        if (this.manualDisconnect) {
          console.log('📴 用户主动断开，不进行重连');
          this.manualDisconnect = false;
          return;
        }

        // 意外断开时尝试重连
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          console.log(`🔄 尝试重连 (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
          setTimeout(() => this.connect(), 2000);
        }
      };
    });
  }

  disconnect(): void {
    // 标记为用户主动断开，阻止自动重连
    this.manualDisconnect = true;
    // 停止心跳
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }

  // ==================== 心跳保活 ====================

  /**
   * 启动心跳，每60秒发送一次 task_continue 事件保持连接
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      if (this.isConnected) {
        console.log('💓 发送心跳...');
        this.send({
          event: 'task_continue',
          text: '',
        });
      }
    }, this.HEARTBEAT_INTERVAL);
  }

  /**
   * 停止心跳
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  // ==================== 会话配置 ====================

  private initSession(): void {
    this.send({
      type: 'session.update',
      session: {
        modalities: ['text', 'audio'],
        instructions: this.config.instructions || '你是一位友善的助手。',
        voice: this.config.voice,
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        temperature: 0.7,
      },
    });
  }

  updateSession(session: Partial<{
    modalities: string[];
    instructions: string;
    voice: string;
    temperature: number;
    max_response_output_tokens: number;
  }>): void {
    this.send({
      type: 'session.update',
      session,
    });
  }

  // ==================== 音频输入 ====================

  /**
   * 追加音频数据到缓冲区
   * @param audioBase64 Base64 编码的 PCM16 音频数据
   */
  appendAudio(audioBase64: string): void {
    this.send({
      type: 'input_audio_buffer.append',
      audio: audioBase64,
    });
  }

  /**
   * 提交音频缓冲区，触发 ASR 识别
   */
  commitAudio(): void {
    this.send({ type: 'input_audio_buffer.commit' });
  }

  /**
   * 清空音频缓冲区
   */
  clearAudioBuffer(): void {
    this.send({ type: 'input_audio_buffer.clear' });
  }

  // ==================== 文本输入 ====================

  /**
   * 发送文本消息
   * @param text 用户输入的文本
   */
  sendText(text: string): void {
    // MiniMax Realtime API 需要在 response.create 中包含 input
    this.send({
      type: 'response.create',
      response: {
        modalities: ['text', 'audio'],
        input: [
          {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text }],
          },
        ],
      },
    });
  }

  // ==================== 响应控制 ====================

  /**
   * 触发模型生成响应
   */
  createResponse(options?: {
    modalities?: string[];
    instructions?: string;
    voice?: string;
  }): void {
    this.send({
      type: 'response.create',
      response: {
        modalities: options?.modalities || ['text', 'audio'],
        ...options,
      },
    });
  }

  /**
   * 打断当前响应
   * 注意：MiniMax Realtime API 不支持 response.cancel 和 input_audio_buffer.clear
   * 只能在本地停止播放，服务端会继续发送数据直到响应完成
   */
  interrupt(): void {
    // MiniMax API 不支持打断命令，只在本地处理
    // 不发送任何命令到服务端
  }

  // ==================== 对话管理 ====================

  /**
   * 删除对话项
   * @param itemId 要删除的项目 ID
   */
  deleteConversationItem(itemId: string): void {
    this.send({
      type: 'conversation.item.delete',
      item_id: itemId,
    });
  }

  // ==================== 事件处理 ====================

  private handleServerEvent(event: any): void {
    const eventType = event.type;

    // 调试日志（可以根据需要关闭）
    if (!eventType.includes('delta')) {
      console.log('📨 收到事件:', eventType, event);
    }

    switch (eventType) {
      // ============ 代理事件 ============
      case 'proxy.connected':
        console.log('✅ 代理已连接到 MiniMax Realtime API');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.initSession();
        // 启动心跳保持连接
        this.startHeartbeat();
        this.callbacks.onConnected?.();
        this.connectResolve?.();
        this.connectResolve = null;
        this.connectReject = null;
        break;

      // ============ 会话事件 ============
      case 'session.created':
        console.log('📋 会话已创建:', event.session?.id);
        break;

      case 'session.updated':
        console.log('📋 会话已更新:', event.session);
        break;

      // ============ 对话事件 ============
      case 'conversation.created':
        console.log('💬 对话已创建:', event.conversation?.id);
        break;

      case 'conversation.item.created':
        this.handleItemCreated(event);
        break;

      case 'conversation.item.deleted':
        console.log('🗑️ 对话项已删除:', event.item_id);
        break;

      // ============ 音频缓冲区事件 ============
      case 'input_audio_buffer.committed':
        console.log('✅ 音频已提交, item_id:', event.item_id);
        break;

      case 'input_audio_buffer.cleared':
        console.log('🗑️ 音频缓冲区已清空');
        break;

      // ============ 响应事件 ============
      case 'response.created':
        console.log('🤖 响应开始:', event.response?.id);
        this.callbacks.onResponseStart?.();
        break;

      case 'response.output_item.added':
        console.log('📝 输出项添加:', event.item?.id);
        break;

      case 'response.output_item.done':
        console.log('✅ 输出项完成:', event.item?.id);
        break;

      // ============ 文本流式输出 ============
      case 'response.text.delta':
        this.callbacks.onTextDelta?.(event.delta);
        break;

      case 'response.text.done':
        this.callbacks.onTextDone?.(event.text);
        break;

      // ============ 音频流式输出 ============
      case 'response.audio.delta':
        this.callbacks.onAudioDelta?.(event.delta);
        break;

      case 'response.audio.done':
        this.callbacks.onAudioDone?.();
        break;

      // ============ AI 语音转录 ============
      case 'response.audio_transcript.delta':
        this.callbacks.onAudioTranscriptDelta?.(event.delta);
        break;

      case 'response.audio_transcript.done':
        this.callbacks.onAudioTranscriptDone?.(event.transcript);
        break;

      // ============ 响应完成 ============
      case 'response.done':
        console.log('✅ 响应完成:', event.response?.status);
        this.callbacks.onResponseDone?.(event.response?.usage || null);
        break;

      // ============ 错误事件 ============
      case 'error':
        console.error('❌ API 错误:', event.error);
        this.callbacks.onError?.({
          type: event.error?.type || 'unknown',
          message: event.error?.message || '未知错误',
          code: event.error?.code,
        });
        break;

      default:
        // 未处理的事件类型
        if (!eventType.includes('delta')) {
          console.log('📌 未处理事件:', eventType);
        }
    }
  }

  /**
   * 处理对话项创建事件
   */
  private handleItemCreated(event: any): void {
    const item = event.item;

    if (item?.role === 'user' && item?.content) {
      // 检查是否有 ASR 转录结果
      for (const content of item.content) {
        if (content.type === 'input_audio' && content.transcript) {
          console.log('🎤 用户语音识别:', content.transcript);
          this.callbacks.onUserTranscript?.(content.transcript);
        }
      }
    }
  }

  // ==================== 工具方法 ====================

  private send(event: object): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('⚠️ WebSocket 未连接，无法发送:', event);
      return;
    }
    const message = JSON.stringify(event);
    this.ws.send(message);
  }

  setCallbacks(callbacks: RealtimeCallbacks): void {
    this.callbacks = callbacks;
  }

  isConnectedState(): boolean {
    return this.isConnected;
  }

  getConfig(): RealtimeConfig {
    return { ...this.config };
  }
}
