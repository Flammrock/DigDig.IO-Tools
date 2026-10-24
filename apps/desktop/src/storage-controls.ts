import { invoke, isTauri } from '@tauri-apps/api/core';

interface AppStorageInfo {
  mode: 'standalone' | 'development';
  dataDirectory: string;
  settingsFile: string;
  reportsDirectory: string;
  layoutCacheDirectory: string;
}

export function setupStorageControls() {
  const path = document.getElementById('app-data-path')!;
  const note = document.getElementById('app-storage-note')!;
  const locations = document.getElementById('app-storage-locations') as HTMLDetailsElement;
  const result = document.getElementById('app-storage-result')!;
  const open = document.getElementById('open-app-data') as HTMLButtonElement;
  const label = document.getElementById('open-app-data-label')!;
  const native = isTauri();
  let available = false;
  let loading = false;
  let opening = false;
  let disposed = false;

  function enable() {
    open.disabled = !native || !available || loading || opening;
    open.setAttribute('aria-busy', String(opening));
    label.textContent = opening ? 'Opening…' : 'Open in Explorer';
  }

  function showError(error: unknown) {
    result.textContent = String(error).replace(/^Error: /, '');
    result.hidden = false;
  }

  async function refresh() {
    if (disposed || loading || opening || !native) return;
    loading = true;
    result.hidden = true;
    enable();
    try {
      const info = await invoke<AppStorageInfo>('app_storage_info');
      if (disposed) return;
      path.textContent = info.dataDirectory;
      path.hidden = false;
      document.getElementById('app-settings-path')!.textContent = info.settingsFile;
      document.getElementById('app-reports-path')!.textContent = info.reportsDirectory;
      document.getElementById('app-cache-path')!.textContent = info.layoutCacheDirectory;
      note.textContent = info.mode === 'development'
        ? 'Development data is separate from the installed app. See file locations for the reports folder.'
        : 'Preferences, browser pairing, reports, and cached game layouts.';
      locations.hidden = false;
      available = true;
    } catch (error) {
      if (!disposed) {
        available = false;
        path.hidden = locations.hidden = true;
        note.textContent = 'The app data location is unavailable.';
        showError(error);
      }
    } finally {
      loading = false;
      if (!disposed) enable();
    }
  }

  async function openDirectory() {
    if (disposed || open.disabled) return;
    opening = true;
    result.hidden = true;
    enable();
    try {
      // The backend opens its configured directory; the UI sends no path.
      await invoke('open_app_data_directory');
    } catch (error) {
      if (!disposed) showError(error);
    } finally {
      opening = false;
      if (!disposed) enable();
    }
  }

  const onOpen = () => { void openDirectory(); };
  open.addEventListener('click', onOpen);
  if (!native) note.textContent = 'Open the desktop app to view its data location and open it in Explorer.';
  enable();
  return { refresh, dispose() { disposed = true; open.removeEventListener('click', onOpen); } };
}
