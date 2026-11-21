import type { AIMember } from '@/config/aiMembers';
import { request } from '@/utils/request';
import { readSseContent } from './chatStream';

export interface KidChatTurn {
  /** 'kid' 为孩子，其余为伙伴 id */
  speakerId: string;
  speakerName: string;
  content: string;
}

/** /api/chat 的 history 约定：孩子是 user，伙伴发言以「名字：内容」作为 assistant */
export function toApiHistory(turns: KidChatTurn[]) {
  return turns
    .filter((turn) => turn.content.trim())
    .map((turn) =>
      turn.speakerId === 'kid'
        ? { role: 'user', content: turn.content }
        : { role: 'assistant', content: `${turn.speakerName}：${turn.content}` },
    );
}

export interface CompanionReplyOptions {
  companion: AIMember;
  message: string;
  /** 不含本次 message 的历史 */
  history: KidChatTurn[];
  /** 本轮第几个回复的伙伴（0 起），决定 message 在 history 里的插入位置 */
  index?: number;
  gamePrompt?: string;
  allNames?: string[];
  onDelta?: (fullText: string) => void;
}

export async function streamCompanionReply(options: CompanionReplyOptions): Promise<string> {
  const { companion, message, history, index = 0, gamePrompt, onDelta } = options;
  const response = await request('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: companion.model,
      providerId: companion.providerId,
      message,
      history: toApiHistory(history),
      index,
      aiName: companion.name,
      custom_prompt: companion.customPrompt || '',
      gamePrompt,
    }),
  });
  if (!response.ok) {
    let reason = '';
    try {
      reason = (await response.json())?.message || '';
    } catch {
      // ignore
    }
    throw new Error(reason || `请求失败（${response.status}）`);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('没有收到回复');
  const text = await readSseContent(reader, {
    onDelta,
    speakerNames: options.allNames?.length ? options.allNames : [companion.name],
  });
  if (!text.trim()) throw new Error('小伙伴没有回答');
  return text;
}
