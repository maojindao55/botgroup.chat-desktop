/**
 * 头像输入规范化：把用户粘贴的链接 / 本地路径 / file:// / asset:// 统一分类。
 * 纯函数，便于单测；真正的文件复制由 Rust `import_avatar_path` 完成。
 */

export type AvatarInputKind = 'empty' | 'lobehub' | 'url' | 'file-path' | 'data' | 'invalid';

export interface NormalizedAvatarInput {
  kind: AvatarInputKind;
  value: string;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** 去掉首尾空白、引号、尖括号（常见于复制链接/HTML 片段） */
export function cleanAvatarInput(raw: string): string {
  let value = (raw || '').trim();
  value = value.replace(/^[<'"“”]+/, '').replace(/[>'"“”]+$/, '').trim();
  return value;
}

export function normalizeAvatarInput(raw: string): NormalizedAvatarInput {
  const value = cleanAvatarInput(raw);
  if (!value) return { kind: 'empty', value: '' };

  if (value.startsWith('lobehub:')) return { kind: 'lobehub', value };

  if (value.startsWith('data:image/')) return { kind: 'data', value };
  if (value.startsWith('data:') || value.startsWith('blob:')) {
    return { kind: 'invalid', value };
  }

  // Tauri asset 协议：asset://localhost/<path> 或 http://asset.localhost/<path>
  for (const prefix of ['asset://localhost/', 'http://asset.localhost/', 'https://asset.localhost/']) {
    if (value.startsWith(prefix)) {
      let path = safeDecode(value.slice(prefix.length));
      if (!/^[A-Za-z]:[\\/]/.test(path) && !path.startsWith('/')) {
        path = `/${path}`;
      }
      return { kind: 'file-path', value: path };
    }
  }

  if (value.startsWith('file://')) {
    let path = safeDecode(value.slice('file://'.length));
    // Windows: file:///C:/x -> C:/x
    if (/^\/[A-Za-z]:\//.test(path)) path = path.slice(1);
    return { kind: 'file-path', value: path };
  }

  // Windows 绝对路径 C:\x 或 C:/x
  if (/^[A-Za-z]:[\\/]/.test(value)) {
    return { kind: 'file-path', value: value.replace(/\\/g, '/') };
  }

  if (value.startsWith('/') || value.startsWith('~/')) {
    return { kind: 'file-path', value };
  }

  if (/^https?:\/\//i.test(value)) return { kind: 'url', value };

  return { kind: 'invalid', value };
}
