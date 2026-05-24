const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('env', {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY || ''
});

contextBridge.exposeInMainWorld('electronAudio', {
    checkAudioDir: () =>
        ipcRenderer.invoke('check-audio-dir'),
    saveAudioFile: (relativePath, byteArray) =>
        ipcRenderer.invoke('save-audio-file', { relativePath, byteArray }),
    generateTtsAudio: (text) =>
        ipcRenderer.invoke('generate-tts-audio', text),
    generateTtsBytes: (text, speakingRate) =>
        ipcRenderer.invoke('generate-tts-bytes', { text, speakingRate })
});
