/**
 * 角色群聊会话标题：用 LLM 总结生成简短标题。
 * 复用 llmChatComplete（非流式聚合）+ resolveCompanionCredentials（成员未配模型时用伙伴模型）。
 * 任何失败都返回 null，由调用方回退到首条消息截断标题。
 */
import { llmChatComplete } from '@/utils/llmClient';
import { resolveCompanionCredentials } from '@/utils/companionCredentials';
import { cleanGeneratedTitle } from '@/config/chatSessions';

/** 生成标题时的最大长度（比截断标题更短，更像“标题”） */
const GENERATED_TITLE_MAX_LEN = 24;

export interface GenerateSessionTitleInput {
  /** 首条用户消息 */
  userMessage: string;
  /** 首条 AI 回复（可选，提供后总结更准） */
  aiMessage?: string;
  /** 调用模型与（可选）Provider；为空时使用伙伴模型 */
  model?: string;
  providerId?: string;
}

/**
 * 用 LLM 总结生成简短会话标题。
 * @returns 清洗后的标题；不可用时返回 null。
 */
export async function generateSessionTitle(
  input: GenerateSessionTitleInput,
): Promise<string | null> {
  const userMessage = (input.userMessage || '').trim();
  if (!userMessage) return null;

  try {
    const creds = await resolveCompanionCredentials(input.model, input.providerId);

    const aiPart = input.aiMessage?.trim()
      ? `\nAssistant: ${input.aiMessage.trim().slice(0, 800)}`
      : '';
    const conversation = `User: ${userMessage.slice(0, 1200)}${aiPart}`.slice(0, 1600);

    const system = [
      'You generate a very concise chat title that summarizes the conversation topic.',
      'Rules: at most 6 words or 16 Chinese characters;',
      'no surrounding quotes; no trailing punctuation;',
      'use the SAME language as the conversation;',
      'output ONLY the title text, nothing else.',
    ].join(' ');

    const text = await llmChatComplete({
      ...creds,
      temperature: 0.2,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: conversation },
      ],
    });

    const title = cleanGeneratedTitle(text, GENERATED_TITLE_MAX_LEN);
    return title || null;
  } catch (e) {
    console.warn('[sessionTitle] generate failed:', e);
    return null;
  }
}
