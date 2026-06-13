const ANSI_ESCAPE_PATTERN = /\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
const ORPHAN_SGR_PATTERN = /\[(?:\d{1,3};)*\d{1,3}m/g;

export function cleanCliOutputLine(line: string): string {
  return line
    .replace(ANSI_ESCAPE_PATTERN, '')
    .replace(ORPHAN_SGR_PATTERN, '')
    .replace(/[ \t]+$/g, '');
}

export function shouldSuppressCliOutputLine(line: string): boolean {
  const clean = cleanCliOutputLine(line).trim();

  if (!clean) return true;
  if (/^>\s*Sisyphus\s+-\s+Ultraworker\b/.test(clean)) return true;
  if (/\bERROR\s+codex_models_manager::manager:\s+failed to refresh available models:/i.test(clean)) return true;
  if (/^✗\s*Skill\s+".+"\s+failed$/.test(clean)) return true;
  if (/^Error:\s*Skill or command\s+".+"\s+not found\./.test(clean)) return true;

  return false;
}
