import { invoke, isTauri } from '@tauri-apps/api/core';

interface UserscriptInfo {
  filename: string;
  installUrl: string;
  mode: 'development' | 'standalone';
  paired: boolean;
}

export function setupUserscriptControls() {
  const button = (id: string) => document.getElementById(id) as HTMLButtonElement;
  const install = button('install-userscript');
  const copy = button('copy-userscript');
  const save = button('export-userscript');
  const details = document.getElementById('userscript-details')!;
  const result = document.getElementById('userscript-result')!;
  const native = isTauri();
  let busy = false;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function enable() {
    install.disabled = busy;
    copy.disabled = save.disabled = busy || !native;
  }

  async function refresh() {
    if (disposed || busy) return;
    if (!native) {
      details.textContent = 'Development script. Keep npm run dev running. Copy and export are available in the desktop app.';
      return;
    }
    try {
      const info = await invoke<UserscriptInfo>('userscript_info');
      if (disposed) return;
      details.textContent = info.mode === 'standalone'
        ? 'Bundled with this app and paired to this computer. No development server is needed.'
        : 'Development script. Keep the development bridge running for live updates.';
    } catch (error) {
      if (!disposed) details.textContent = String(error).replace(/^Error: /, '');
    }
  }

  async function run(command: string, message: string) {
    if (busy || disposed) return;
    busy = true;
    enable();
    clearTimeout(timer);
    result.hidden = true;
    try {
      const response = await invoke<string | null | undefined>(command);
      if (disposed) return;
      result.textContent = command === 'export_userscript' && response === null ? 'Export cancelled.' : message;
      result.dataset.error = 'false';
      result.hidden = false;
      timer = setTimeout(() => { result.hidden = true; }, 4000);
    } catch (error) {
      if (!disposed) {
        result.textContent = String(error).replace(/^Error: /, '');
        result.dataset.error = 'true';
        result.hidden = false;
      }
    } finally {
      busy = false;
      if (!disposed) enable();
    }
  }

  install.addEventListener('click', () => {
    if (native) void run('install_userscript', 'Installer opened in your browser.');
    else window.open('http://127.0.0.1:4317/install.user.js', '_blank', 'noopener,noreferrer');
  });
  copy.addEventListener('click', () => void run('copy_userscript', 'Userscript copied. Paste it into Tampermonkey.'));
  save.addEventListener('click', () => void run('export_userscript', 'Userscript exported.'));
  enable();
  return { refresh, dispose() { disposed = true; clearTimeout(timer); } };
}
