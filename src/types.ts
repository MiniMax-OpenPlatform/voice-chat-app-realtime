/**
 * 类型定义
 */

// 聊天消息
export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  isAudio?: boolean; // 是否通过语音输入
}

// 连接状态
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

// 音色选项
export interface VoiceOption {
  id: string;
  name: string;
}

// 可用音色列表
export const VOICE_OPTIONS: VoiceOption[] = [
  { id: 'male-qn-qingse', name: '青涩青年男声' },
  { id: 'female-tianmei', name: '甜美女声' },
  { id: 'female-yujie', name: '御姐女声' },
  { id: 'presenter_male', name: '男性主持人' },
  { id: 'audiobook_male_2', name: '有声书男声' },
];

// 应用状态
export interface AppState {
  isConnected: boolean;
  isRecording: boolean;
  isResponding: boolean;
  error: string | null;
}
