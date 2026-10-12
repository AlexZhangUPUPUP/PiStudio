'use strict';

/**
 * Preload for the pi-gui desktop shell.
 *
 * The renderer only needs one thing from the main process: tell it which theme
 * is active so the native window background and the sidebar vibrancy match the
 * page. Without this, switching to light while the OS is dark left a dark window
 * showing through the transparent page.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('piDesktop', {
  setTheme: (mode) => ipcRenderer.send('pi-gui:set-theme', String(mode || 'system')),
});
