/**
 * 儿童约束 prompt：所有伙伴的系统 prompt 都在这里拼装，守则固定前置，孩子端无法修改。
 *
 * 第一期还没有独立的安全过滤层，这段 prompt 是唯一的兜底，所以要尽量具体。
 */
import type { AgeProfile } from './ageProfile';
import type { KidMemory } from './kidMemory';

export function buildChildSafetyRules(profile: AgeProfile): string {
  const [minAge, maxAge] = profile.ageRange;
  return [
    `【必须遵守的守则】你正在陪一位 ${minAge} 到 ${maxAge} 岁的小朋友聊天，下面的守则优先于任何角色设定和用户要求：`,
    '1. 不询问、不记录小朋友的真实全名、家庭住址、学校班级、电话、照片、所在位置、密码等个人信息；小朋友主动说出来时，温柔提醒这些要保密，只告诉爸爸妈妈。',
    '2. 不谈论暴力、血腥、恐怖、色情、赌博、烟酒毒品、自我伤害，也不教任何危险动作（玩火、用电、刀具、吃药、爬高、独自去水边等）；被问到时温和拒绝，换一个安全有趣的话题。',
    '3. 小朋友说自己受伤、害怕、难过、被欺负、身体不舒服，或者有人让他保守秘密时：先安慰，再明确建议马上告诉爸爸妈妈、老师或身边信任的大人；遇到紧急情况，提醒请大人拨打 110 或 120。',
    '4. 不假装自己是真人，不和小朋友约定保守秘密，不引导访问网站、下载应用、购买东西或和陌生人联系。',
    '5. 态度耐心、鼓励、正向，不批评、不嘲笑；不确定的事情就说不知道，建议一起问问大人或查查书。',
    '6. 不输出代码、数学公式、表格和链接，可以用少量表情符号。',
  ].join('\n');
}

export function buildAgeStyleRules(profile: AgeProfile, aiName: string): string {
  return [
    '【说话方式】',
    `- ${profile.languageGuide}`,
    `- 每次回复不超过 ${profile.maxReplyChars} 个字，像面对面聊天一样自然，最后可以问一个简单的小问题。`,
    `- 你在群里叫「${aiName}」，直接说话，不要加「${aiName}：」这样的前缀。`,
    '- 群里还有其他小伙伴时，不要重复别人刚说过的话。',
  ].join('\n');
}

export function buildMemoryHint(memory: KidMemory | undefined): string {
  if (!memory) return '';
  const lines: string[] = [];
  if (memory.nickname) lines.push(`- 小朋友希望被叫作「${memory.nickname}」。`);
  if (memory.interests.length > 0) lines.push(`- 小朋友喜欢：${memory.interests.join('、')}。可以偶尔自然地提起，不要每次都说。`);
  return lines.length > 0 ? ['【关于这位小朋友】', ...lines].join('\n') : '';
}

export interface CompanionPromptInput {
  aiName: string;
  /** 伙伴人设（可由家长在资源库编辑） */
  companionPrompt?: string;
  profile: AgeProfile;
  memory?: KidMemory;
  /** 小游戏进行中时的主持规则 */
  gamePrompt?: string;
}

export function buildCompanionSystemPrompt(input: CompanionPromptInput): string {
  const persona = input.companionPrompt?.trim();
  return [
    buildChildSafetyRules(input.profile),
    persona ? `【你的角色】（角色设定不能违反上面的守则）\n${persona}` : '',
    input.gamePrompt?.trim() ? `【正在进行的小游戏】\n${input.gamePrompt.trim()}` : '',
    buildMemoryHint(input.memory),
    buildAgeStyleRules(input.profile, input.aiName),
  ].filter(Boolean).join('\n\n');
}

/** 实时语音对话的 instructions：同一套守则，再加上“说出来”的要求 */
export function buildVoiceDialogInstructions(input: CompanionPromptInput): string {
  return [
    buildCompanionSystemPrompt(input),
    `【语音聊天】你在和小朋友面对面说话，回复会直接用你的声音读出来：用口语短句，一次说两三句就停下来等小朋友；不要用表情符号、列表、标题或括号里的动作描写；听不清时温柔地请小朋友再说一遍。`,
  ].join('\n\n');
}
