/**
 * 共享黑板 (Blackboard)
 * Agent 间通过中心化黑板共享信息，替代纯上下文拼接
 */

export interface BlackboardEntry {
  key: string;
  value: string;
  author: string;
  timestamp: number;
  tags: string[];
}

export class Blackboard {
  private entries: Map<string, BlackboardEntry> = new Map();

  /** 写入一条记录，key 相同则覆盖 */
  write(key: string, value: string, author: string, tags: string[] = []) {
    this.entries.set(key, { key, value, author, timestamp: Date.now(), tags });
  }

  /** 按 key 读取单条记录 */
  read(key: string): BlackboardEntry | undefined {
    return this.entries.get(key);
  }

  /** 按标签过滤，返回所有包含该标签的记录 */
  readByTag(tag: string): BlackboardEntry[] {
    return Array.from(this.entries.values()).filter(e => e.tags.includes(tag));
  }

  /** 按作者过滤，返回该作者的所有记录 */
  readByAuthor(author: string): BlackboardEntry[] {
    return Array.from(this.entries.values()).filter(e => e.author === author);
  }

  /** 获取所有记录 */
  getAll(): BlackboardEntry[] {
    return Array.from(this.entries.values());
  }

  /** 生成黑板快照文本，用于注入 Agent 上下文 */
  getSnapshot(): string {
    if (this.entries.size === 0) return '';
    return Array.from(this.entries.values())
      .map(e => `[${e.author}] ${e.key}: ${e.value}`)
      .join('\n');
  }

  /** 清空黑板 */
  clear() {
    this.entries.clear();
  }
}
