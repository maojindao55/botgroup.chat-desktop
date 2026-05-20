#!/usr/bin/env node
/**
 * OpenCode CLI Agent Plugin for BotGroup.Chat
 *
 * 用法：
 *   node plugins/opencode-plugin.mjs
 */

import { spawn } from 'child_process';
import WebSocket from 'ws';

const BRIDGE_URL = process.env.BRIDGE_URL || 'ws://localhost:19816/agent?name=opencode';
const OPENCODE_BIN = process.env.OPENCODE_BIN || 'opencode';

let ws;
let reconnectTimer;
const activeTasks = new Map();

function connect() {
  console.log(`[opencode-plugin] Connecting to ${BRIDGE_URL}...`);
  ws = new WebSocket(BRIDGE_URL);

  ws.on('open', () => {
    console.log('[opencode-plugin] Connected.');
    ws.send(JSON.stringify({ type: 'register', name: 'opencode' }));
  });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type === 'prompt') handlePrompt(msg);
    else if (msg.type === 'cancel') handleCancel(msg.id);
  });

  ws.on('close', () => {
    reconnectTimer = setTimeout(connect, 3000);
  });

  ws.on('error', (err) => {
    console.error('[opencode-plugin] WS error:', err.message);
  });
}

function handlePrompt(msg) {
  const { id, text, cwd } = msg;
  const child = spawn(OPENCODE_BIN, ['run', text], {
    cwd: cwd || process.cwd(),
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  activeTasks.set(id, child);

  child.stdout.on('data', (chunk) => send({ type: 'chunk', id, content: chunk.toString() }));
  child.stderr.on('data', (chunk) => send({ type: 'stderr', id, content: chunk.toString() }));
  child.on('close', (code) => { activeTasks.delete(id); send({ type: 'done', id, exit_code: code ?? -1 }); });
  child.on('error', (err) => { activeTasks.delete(id); send({ type: 'error', id, message: err.message }); });
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
  ws?.close(); clearTimeout(reconnectTimer); process.exit(0);
});

connect();
