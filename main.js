require('dotenv').config();

const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

// Required for speech synthesis on Linux
if (process.platform === 'linux') {
    app.commandLine.appendSwitch('enable-speech-dispatcher');
}

function createWindow() {
    const win = new BrowserWindow({
        width: 600,
        height: 850,
        webPreferences: {
            webSecurity: false,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    win.loadFile('flashcard.html');
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('save-audio-file', async (_, payload) => {
    const { relativePath, byteArray } = payload || {};

    if (typeof relativePath !== 'string' || !relativePath.startsWith('indonesian_audio/')) {
        throw new Error('Invalid audio path');
    }
    if (!relativePath.endsWith('.mp3')) {
        throw new Error('Audio file must be MP3');
    }
    if (!Array.isArray(byteArray)) {
        throw new Error('Invalid audio payload');
    }

    const resolvedPath = path.resolve(__dirname, relativePath);
    const audioDir = path.resolve(__dirname, 'indonesian_audio');
    if (!resolvedPath.startsWith(audioDir + path.sep)) {
        throw new Error('Audio path escapes indonesian_audio directory');
    }

    await fs.promises.mkdir(path.dirname(resolvedPath), { recursive: true });
    await fs.promises.writeFile(resolvedPath, Buffer.from(byteArray));

    return { ok: true, savedPath: resolvedPath };
});
