/**
 * 音频处理服务
 * 负责麦克风采集和音频播放
 * 支持 PCM16 24kHz 格式（MiniMax Realtime API 要求）
 */

export interface VADCallbacks {
  onSpeechStart?: () => void;      // 用户开始说话
  onSpeechEnd?: () => void;        // 用户停止说话（静音超时）
  onVolumeChange?: (volume: number) => void;  // 音量变化（0-1）
}

export class AudioProcessor {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;

  // 播放相关
  private playbackQueue: Float32Array[] = [];
  private isPlaying = false;
  private nextPlayTime = 0;
  private currentSource: AudioBufferSourceNode | null = null;

  // 采集回调
  private onAudioData: ((base64: string) => void) | null = null;

  // VAD 相关
  private vadCallbacks: VADCallbacks = {};
  private isSpeaking = false;           // 当前是否在说话
  private silenceStartTime = 0;         // 静音开始时间
  private readonly SILENCE_THRESHOLD = 0.01;  // 静音阈值
  private readonly SILENCE_DURATION = 1500;   // 静音持续时间（毫秒）触发结束
  private readonly SPEECH_THRESHOLD = 0.02;   // 说话阈值（比静音阈值略高，避免误触发）
  private silenceTimer: NodeJS.Timeout | null = null;

  // 采样率（MiniMax 要求 24kHz）
  private readonly SAMPLE_RATE = 24000;

  constructor() {
    // 延迟初始化，需要用户交互后才能创建 AudioContext
  }

  /**
   * 设置 VAD 回调
   */
  setVADCallbacks(callbacks: VADCallbacks): void {
    this.vadCallbacks = callbacks;
  }

  // ==================== 音频采集 ====================

  /**
   * 开始采集麦克风音频
   * @param onAudioData 音频数据回调，返回 Base64 编码的 PCM16 数据
   */
  async startCapture(onAudioData: (base64: string) => void): Promise<void> {
    this.onAudioData = onAudioData;

    try {
      // 获取麦克风权限
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: this.SAMPLE_RATE,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      // 创建音频上下文
      this.audioContext = new AudioContext({ sampleRate: this.SAMPLE_RATE });

      // 如果实际采样率与目标不同，需要重采样
      if (this.audioContext.sampleRate !== this.SAMPLE_RATE) {
        console.warn(
          `⚠️ 浏览器采样率 ${this.audioContext.sampleRate}Hz，需要重采样到 ${this.SAMPLE_RATE}Hz`
        );
      }

      // 创建音频源节点
      this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);

      // 使用 ScriptProcessor 处理音频（兼容性更好）
      // 注意：ScriptProcessor 已废弃，但 AudioWorklet 需要额外配置
      const bufferSize = 4096;
      this.processorNode = this.audioContext.createScriptProcessor(bufferSize, 1, 1);

      this.processorNode.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);

        // 如果需要重采样
        let processedData: Float32Array;
        if (this.audioContext!.sampleRate !== this.SAMPLE_RATE) {
          processedData = this.resample(inputData, this.audioContext!.sampleRate, this.SAMPLE_RATE);
        } else {
          processedData = inputData;
        }

        // VAD 检测
        this.processVAD(processedData);

        // 转换为 Base64 PCM16
        const base64 = this.float32ToBase64PCM16(processedData);
        this.onAudioData?.(base64);
      };

      // 连接节点
      this.sourceNode.connect(this.processorNode);
      this.processorNode.connect(this.audioContext.destination);

      console.log('🎤 音频采集已启动', {
        sampleRate: this.audioContext.sampleRate,
        targetRate: this.SAMPLE_RATE,
      });
    } catch (error: any) {
      console.error('❌ 启动音频采集失败:', error);
      throw new Error('无法访问麦克风: ' + error.message);
    }
  }

  /**
   * 停止采集麦克风音频
   */
  stopCapture(): void {
    if (this.processorNode) {
      this.processorNode.disconnect();
      this.processorNode = null;
    }

    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    // 重置 VAD 状态
    this.resetVADState();

    this.onAudioData = null;
    console.log('🎤 音频采集已停止');
  }

  // ==================== VAD 语音活动检测 ====================

  /**
   * 处理 VAD 检测
   */
  private processVAD(audioData: Float32Array): void {
    // 计算 RMS 音量
    let sum = 0;
    for (let i = 0; i < audioData.length; i++) {
      sum += audioData[i] * audioData[i];
    }
    const rms = Math.sqrt(sum / audioData.length);

    // 通知音量变化
    this.vadCallbacks.onVolumeChange?.(Math.min(rms * 10, 1));

    const now = Date.now();

    if (rms > this.SPEECH_THRESHOLD) {
      // 检测到声音
      if (!this.isSpeaking) {
        // 开始说话
        this.isSpeaking = true;
        console.log('🗣️ 检测到说话开始');
        this.vadCallbacks.onSpeechStart?.();
      }
      // 清除静音计时器
      if (this.silenceTimer) {
        clearTimeout(this.silenceTimer);
        this.silenceTimer = null;
      }
      this.silenceStartTime = 0;
    } else if (rms < this.SILENCE_THRESHOLD) {
      // 静音
      if (this.isSpeaking) {
        // 正在说话中检测到静音
        if (this.silenceStartTime === 0) {
          this.silenceStartTime = now;
        }

        // 启动静音计时器（如果还没有）
        if (!this.silenceTimer) {
          this.silenceTimer = setTimeout(() => {
            if (this.isSpeaking && this.silenceStartTime > 0) {
              const silenceDuration = Date.now() - this.silenceStartTime;
              if (silenceDuration >= this.SILENCE_DURATION) {
                console.log('🤫 检测到说话结束（静音超时）');
                this.isSpeaking = false;
                this.silenceStartTime = 0;
                this.vadCallbacks.onSpeechEnd?.();
              }
            }
            this.silenceTimer = null;
          }, this.SILENCE_DURATION);
        }
      }
    }
  }

  /**
   * 重置 VAD 状态
   */
  resetVADState(): void {
    this.isSpeaking = false;
    this.silenceStartTime = 0;
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
  }

  /**
   * 获取当前是否在说话
   */
  getIsSpeaking(): boolean {
    return this.isSpeaking;
  }

  // ==================== 音频播放 ====================

  /**
   * 播放音频块
   * @param base64 Base64 编码的 PCM16 音频数据
   */
  async playAudioChunk(base64: string): Promise<void> {
    // 确保 AudioContext 存在
    if (!this.audioContext) {
      this.audioContext = new AudioContext({ sampleRate: this.SAMPLE_RATE });
    }

    // 确保 AudioContext 在运行状态
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    // 解码 Base64 PCM16 数据
    const float32Data = this.base64PCM16ToFloat32(base64);

    // 添加到播放队列
    this.playbackQueue.push(float32Data);

    // 如果没有在播放，开始播放
    if (!this.isPlaying) {
      this.playNextChunk();
    }
  }

  /**
   * 播放队列中的下一个音频块
   */
  private playNextChunk(): void {
    if (!this.audioContext || this.playbackQueue.length === 0) {
      this.isPlaying = false;
      return;
    }

    this.isPlaying = true;
    const float32Data = this.playbackQueue.shift()!;

    // 创建音频缓冲区
    const audioBuffer = this.audioContext.createBuffer(
      1, // 单声道
      float32Data.length,
      this.SAMPLE_RATE
    );
    audioBuffer.getChannelData(0).set(float32Data);

    // 创建播放源
    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.audioContext.destination);

    // 计算播放时间（确保音频块连续播放，无间隙）
    const currentTime = this.audioContext.currentTime;
    const startTime = Math.max(currentTime, this.nextPlayTime);
    this.nextPlayTime = startTime + audioBuffer.duration;

    source.onended = () => {
      this.currentSource = null;
      this.playNextChunk();
    };

    source.start(startTime);
    this.currentSource = source;
  }

  /**
   * 停止播放
   */
  stopPlayback(): void {
    // 停止当前播放的音频
    if (this.currentSource) {
      try {
        this.currentSource.stop();
      } catch (e) {
        // 忽略已停止的错误
      }
      this.currentSource = null;
    }

    // 清空播放队列
    this.playbackQueue = [];
    this.isPlaying = false;
    this.nextPlayTime = 0;

    console.log('🔇 播放已停止');
  }

  /**
   * 检查是否正在播放
   */
  isCurrentlyPlaying(): boolean {
    return this.isPlaying;
  }

  // ==================== 格式转换 ====================

  /**
   * Float32Array → Base64 PCM16
   * 将浮点音频数据转换为 MiniMax 要求的格式
   */
  private float32ToBase64PCM16(float32Array: Float32Array): string {
    const buffer = new ArrayBuffer(float32Array.length * 2);
    const view = new DataView(buffer);

    for (let i = 0; i < float32Array.length; i++) {
      // 限制范围到 [-1, 1]
      let s = Math.max(-1, Math.min(1, float32Array[i]));
      // 转换为 16 位整数
      const val = s < 0 ? s * 0x8000 : s * 0x7fff;
      view.setInt16(i * 2, val, true); // little-endian
    }

    // ArrayBuffer → Base64
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000; // 32KB chunk size
    let binary = '';

    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
      binary += String.fromCharCode.apply(null, Array.from(chunk));
    }

    return btoa(binary);
  }

  /**
   * Base64 PCM16 → Float32Array
   * 将服务端返回的音频数据转换为可播放格式
   */
  private base64PCM16ToFloat32(base64: string): Float32Array {
    // Base64 → ArrayBuffer
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    // PCM16 → Float32
    const pcm16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(pcm16.length);

    for (let i = 0; i < pcm16.length; i++) {
      float32[i] = pcm16[i] / 0x7fff;
    }

    return float32;
  }

  /**
   * 简单的线性重采样
   */
  private resample(
    inputData: Float32Array,
    inputSampleRate: number,
    outputSampleRate: number
  ): Float32Array {
    const ratio = inputSampleRate / outputSampleRate;
    const outputLength = Math.round(inputData.length / ratio);
    const output = new Float32Array(outputLength);

    for (let i = 0; i < outputLength; i++) {
      const srcIndex = i * ratio;
      const srcIndexFloor = Math.floor(srcIndex);
      const srcIndexCeil = Math.min(srcIndexFloor + 1, inputData.length - 1);
      const fraction = srcIndex - srcIndexFloor;

      // 线性插值
      output[i] =
        inputData[srcIndexFloor] * (1 - fraction) + inputData[srcIndexCeil] * fraction;
    }

    return output;
  }

  // ==================== 资源清理 ====================

  /**
   * 销毁服务，释放所有资源
   */
  destroy(): void {
    this.stopCapture();
    this.stopPlayback();

    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close();
    }
    this.audioContext = null;

    console.log('🧹 AudioProcessor 已销毁');
  }
}
