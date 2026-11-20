import { invoke } from '@tauri-apps/api/core';
import { llmChatReadableStream } from '@/utils/llmClient';
import { collectLegacyApiKeys, clearLegacyApiKeys } from '@/utils/legacyApiKeys';
import { resolveCompanionCredentials } from '@/utils/companionCredentials';
import { defaultGroups as staticGroups } from '@/config/groups';
import { prepareChatGroups } from '@/config/groupStorage';
import { builtinAIMembers, type AIMember } from '@/config/aiMembers';
import { builtinProviders, mapProviderToRust } from '@/config/providers';
import { loadAgeProfile } from '@/config/ageProfile';
import { loadKidMemory } from '@/config/kidMemory';
import { buildCompanionSystemPrompt } from '@/config/childPrompt';
import { normalizeDesktopUser } from '@/utils/userAvatar';

const isTauri = typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__ !== undefined;
if (isTauri) {
  localStorage.setItem('token', 'local_desktop_token_placeholder');
}
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

function loadStoredCustomGroups(): any[] {
  try {
    const stored = localStorage.getItem('custom_groups');
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((g: any) => (
      g && g.type === 'ai' && g.members && !g.memberIds ? { ...g, memberIds: g.members } : g
    ));
  } catch (e) {
    console.error('Failed to parse custom groups:', e);
    return [];
  }
}

function toSeedRow(m: AIMember) {
  return {
    id: m.id,
    kind: m.kind,
    name: m.name,
    avatar: m.avatar || null,
    description: m.description || null,
    tags: JSON.stringify(m.tags || []),
    source: m.source,
    config: JSON.stringify({
      providerId: m.providerId,
      model: m.model,
      schedulerTag: m.schedulerTag,
      customPrompt: m.customPrompt,
      stages: m.stages,
    }),
    enabled: 1,
  };
}

// Mock Response Helper
function mockResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

export async function request(url: string, options: RequestInit = {}) {
  // If not running in Tauri, fallback to standard HTTP fetch
  if (!isTauri) {
    const token = localStorage.getItem('token');
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    } as any;
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return fetch(`${API_BASE_URL}${url}`, {
      ...options,
      headers,
    });
  }

  // Running inside Tauri - Intercept and map endpoints
  const cleanUrl = url.split('?')[0];

  try {
    // 1. Initial configuration endpoint
    if (cleanUrl === '/api/init') {
      let user: any = null;
      try {
        user = await invoke('get_current_user');
      } catch (e) {
        console.error('Failed to get current user from Tauri SQLite:', e);
      }

      // If no user exists, create a default "本地用户" immediately to avoid empty user profile
      if (!user) {
        try {
          user = await invoke('create_local_user', { nickname: '本地用户' });
          localStorage.setItem('token', 'local_desktop_token_placeholder');
        } catch (e) {
          console.error('Failed to create default local user:', e);
        }
      }

      const allGroups = prepareChatGroups(staticGroups, loadStoredCustomGroups());

      try {
        // PR4: one-shot migration (localStorage → vault, member config → providerId)
        try {
          const alreadyDone = await invoke<boolean>('migration_status');
          if (!alreadyDone) {
            const migrationResult = await invoke<{ migrated: boolean }>('migrate_a_complete', {
              input: { localStorageKeys: collectLegacyApiKeys() },
            });
            if (migrationResult.migrated) {
              clearLegacyApiKeys();
              console.info('[init] PR4 data migration completed');
            }
          }
        } catch (migrationErr) {
          console.error('[init] PR4 migration failed:', migrationErr);
        }

        const dbMembers: { id: string }[] = await invoke('list_ai_members', { kind: 'llm' });
        const existingIds = new Set(dbMembers.map((m: { id: string }) => m.id));
        const missing = builtinAIMembers.filter((b) => !existingIds.has(b.id));
        if (missing.length > 0) {
          await invoke('seed_builtin_ai_members', { members: missing.map(toSeedRow) });
        }

        const dbProviders: { id: string }[] = await invoke('list_providers');
        const existingProviderIds = new Set(dbProviders.map(p => p.id));
        const missingProviders = builtinProviders.filter(p => !existingProviderIds.has(p.id));
        if (missingProviders.length > 0) {
          await invoke('seed_builtin_providers', {
            providers: missingProviders.map(mapProviderToRust),
          });
        }
      } catch (e) {
        console.error('Failed to initialize AI members from Tauri SQLite:', e);
      }

      return mockResponse({
        code: 200,
        data: {
          groups: allGroups,
          user: user || null
        }
      });
    }

    // 2. User info endpoint
    if (cleanUrl === '/api/user/info') {
      const user = await invoke('get_current_user');
      return mockResponse({
        code: 200,
        data: user ? normalizeDesktopUser(user as Record<string, unknown>) : null
      });
    }

    // 3. User update endpoint
    if (cleanUrl === '/api/user/update') {
      const body = JSON.parse(options.body as string);
      const user: any = await invoke('get_current_user');
      if (!user) {
        return mockResponse({ success: false, message: '用户不存在' }, 401);
      }
      const updatedUser = await invoke('update_user_info', {
        userId: user.id,
        nickname: body.nickname || user.nickname,
        avatarUrl: body.avatar_url || user.avatar_url || user.avatarUrl
      });
      return mockResponse({
        success: true,
        data: normalizeDesktopUser(updatedUser as Record<string, unknown>)
      });
    }

    // 3b. User avatar upload (legacy JSON path — prefer direct invoke from uploadUserAvatar)
    if (cleanUrl === '/api/user/avatar/upload') {
      const body = JSON.parse(options.body as string);
      const user: any = await invoke('get_current_user');
      if (!user) {
        return mockResponse({ success: false, message: '用户不存在' }, 401);
      }
      try {
        let bytes: Uint8Array;
        if (typeof body.data_base64 === 'string') {
          const binary = atob(body.data_base64);
          bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
        } else if (body.data instanceof Uint8Array) {
          bytes = body.data;
        } else {
          return mockResponse({ success: false, message: '无效的上传数据' }, 400);
        }
        const updatedUser = await invoke('upload_user_avatar', {
          userId: user.id,
          data: bytes,
          mimeType: body.mime_type,
        });
        return mockResponse({
          success: true,
          data: normalizeDesktopUser(updatedUser as Record<string, unknown>),
        });
      } catch (error) {
        return mockResponse({
          success: false,
          message: error instanceof Error ? error.message : '上传头像失败',
        }, 400);
      }
    }

    // 11. Chat API (Direct LLM streaming from client side)
    if (cleanUrl === '/api/chat') {
      const body = JSON.parse(options.body as string);
      const { message, custom_prompt, history, aiName, index, model, providerId, gamePrompt } = body;

      const creds = await resolveCompanionCredentials(model, providerId);

      // 儿童守则统一在这里前置，调用方无法绕过
      const systemPrompt = buildCompanionSystemPrompt({
        aiName,
        companionPrompt: custom_prompt,
        profile: loadAgeProfile(),
        memory: loadKidMemory(),
        gamePrompt,
      });

      const baseMessages = [
        { role: 'system', content: systemPrompt },
        ...history.slice(-10).map((h: { role: string; content: string }) => ({
          role: h.role === 'user' ? 'user' : 'assistant',
          content: h.content
        })),
      ];

      const userMessage = { role: 'user', content: message };
      if (index === 0) {
        baseMessages.push(userMessage);
      } else {
        baseMessages.splice(baseMessages.length - index, 0, userMessage);
      }

      const readable = await llmChatReadableStream({
        ...creds,
        messages: baseMessages,
        emitDoneMarker: false,
      });

      return new Response(readable, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        }
      });
    }

    // Default error for unhandled API calls
    return mockResponse({ success: false, message: `Desktop Mock API: ${cleanUrl} not implemented` }, 404);
  } catch (error: any) {
    console.error('Request intercept error:', error);
    return mockResponse({ success: false, message: error.message || 'Tauri operation failed' }, 500);
  }
}
