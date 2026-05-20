#!/usr/bin/env node
/**
 * Claude Code CLI Agent Plugin for BotGroup.Chat
 *
 * 独立进程，通过 WebSocket 连接 Agent Bridge，
 * 接收 prompt → 调用 claude -p → 流式回传。
 *
 * 用法：
 *   node plugins/claude-plugin.mjs
 *
 * 环境变量（可选）：
 *   BRIDGE_URL   — Bridge WebSocket 地址
 *   CLAUDE_BIN   — claude 二进制路径（默认 "claude"）
 */

import { spawn } from 'child_process';
import WebSocket from 'ws';

const BRIDGE_URL = process.env.BRIDGE_URL || 'ws://localhost:19816/agent?name=claude-code';
const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';

let ws;
let reconnectTimer;
const activeTasks = new Map();

function connect() {
  console.log(`[claude-plugin] Connecting to ${BRIDGE_URL}...`);
  ws = new WebSocket(BRIDGE_URL);

  ws.on('open', () => {
    console.log('[claude-plugin] Connected to bridge.');
    ws.send(JSON.stringify({ type: 'register', name: 'claude-code' }));
  });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type === 'prompt') handlePrompt(msg);
    else if (msg.type === 'cancel') handleCancel(msg.id);
  });

  ws.on('close', () => {
    console.log('[claude-plugin] Disconnected. Reconnecting in 3s...');
    reconnectTimer = setTimeout(connect, 3000);
  });

  ws.on('error', (err) => {
    console.error('[claude-plugin] WS error:', err.message);
  });
}

function handlePrompt(msg) {
  const { id, text, cwd } = msg;
  console.log(`[claude-plugin] Task ${id}: executing claude -p ...`);

  const child = spawn(CLAUDE_BIN, ['-p', text, '--output-format', 'text'], {
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
  });

  child.on('error', (err) => {
    activeTasks.delete(id);
    send({ type: 'error', id, message: err.message });
  });
}

function handleCancel(id) {
  const child = activeTasks.get(id);
  if (child) { child.kill('SIGTERM'); activeTasks.delete(id); }
}

function send(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

process.on('SIGINT', () => {
  for (const [, child] of activeTasks) child.kill('SIGTERM');
  ws?.close();
  clearTimeout(reconnectTimer);
  process.exit(0);
});

connect();
