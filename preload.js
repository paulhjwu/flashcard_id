const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('env', {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY || ''
});

contextBridge.exposeInMainWorld('electronAudio', {
    saveAudioFile: (relativePath, byteArray) =>
        ipcRenderer.invoke('save-audio-file', { relativePath, byteArray })
});
