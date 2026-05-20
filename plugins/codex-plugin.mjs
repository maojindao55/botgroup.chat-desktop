#!/usr/bin/env node
/**
 * Codex CLI Agent Plugin for BotGroup.Chat
 *
 * 这是一个独立进程，通过 WebSocket 连接到 App 的 Agent Bridge，
 * 接收 prompt → 调用 codex exec → 流式回传输出。
 *
 * 用法：
 *   node plugins/codex-plugin.mjs
 *
 * 环境变量（可选）：
 *   BRIDGE_URL  — Bridge WebSocket 地址（默认 ws://localhost:19816/agent）
 *   CODEX_BIN   — codex 二进制路径（默认 "codex"）
 */

import { spawn } from 'child_process';
import WebSocket from 'ws'; // npm install ws

const BRIDGE_URL = process.env.BRIDGE_URL || 'ws://localhost:19816/agent?name=codex';
const CODEX_BIN = process.env.CODEX_BIN || 'codex';

let ws;
let reconnectTimer;
const activeTasks = new Map(); // id → ChildProcess

function connect() {
  console.log(`[codex-plugin] Connecting to ${BRIDGE_URL}...`);
  ws = new WebSocket(BRIDGE_URL);

  ws.on('open', () => {
    console.log('[codex-plugin] Connected to bridge.');
    ws.send(JSON.stringify({ type: 'register', name: 'codex', version: '0.132.0' }));
  });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === 'prompt') {
      handlePrompt(msg);
    } else if (msg.type === 'cancel') {
      handleCancel(msg.id);
    }
  });

  ws.on('close', () => {
    console.log('[codex-plugin] Disconnected. Reconnecting in 3s...');
    reconnectTimer = setTimeout(connect, 3000);
  });

  ws.on('error', (err) => {
    console.error('[codex-plugin] WS error:', err.message);
  });
}

function handlePrompt(msg) {
  const { id, text, cwd } = msg;
  console.log(`[codex-plugin] Task ${id}: executing codex...`);

  const args = ['exec', '--sandbox', 'workspace-write', text];
  const child = spawn(CODEX_BIN, args, {
    cwd: cwd || process.cwd(),
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  activeTasks.set(id, child);

  child.stdout.on('data', (chunk) => {
    send({ type: 'chunk', id, content: chunk.toString() });
  });

  child.stderr.on('data', (chunk) => {
    send({ type: 'stderr', id, content: chunk.toString() });
  });

  child.on('close', (code) => {
    activeTasks.delete(id);
    send({ type: 'done', id, exit_code: code ?? -1 });
    console.log(`[codex-plugin] Task ${id} done (exit ${code}).`);
  });

  child.on('error', (err) => {
    activeTasks.delete(id);
    send({ type: 'error', id, message: err.message });
  });
}

function handleCancel(id) {
  const child = activeTasks.get(id);
  if (child) {
    child.kill('SIGTERM');
    activeTasks.delete(id);
    console.log(`[codex-plugin] Task ${id} cancelled.`);
  }
}

function send(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('[codex-plugin] Shutting down...');
  for (const [id, child] of activeTasks) {
    child.kill('SIGTERM');
  }
  ws?.close();
  clearTimeout(reconnectTimer);
  process.exit(0);
});

connect();
