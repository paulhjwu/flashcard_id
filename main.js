require('dotenv').config();

const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { TextToSpeechClient } = require('@google-cloud/text-to-speech');

const ttsClient = new TextToSpeechClient({
    keyFilename: path.resolve(__dirname, process.env.GOOGLE_APPLICATION_CREDENTIALS || '')
});

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

ipcMain.handle('check-audio-dir', async () => {
    const audioDir = path.join(__dirname, 'indonesian_audio');
    try {
        const stat = await fs.promises.stat(audioDir);
        return { exists: stat.isDirectory() };
    } catch {
        return { exists: false };
    }
});

ipcMain.handle('generate-tts-bytes', async (_, { text, speakingRate }) => {
    if (typeof text !== 'string' || !text.trim()) throw new Error('Invalid TTS text');

    const [response] = await ttsClient.synthesizeSpeech({
        input: { text },
        voice: { languageCode: 'id-ID', ssmlGender: 'NEUTRAL' },
        audioConfig: { audioEncoding: 'MP3', speakingRate: speakingRate || 1.0 }
    });

    return { audioBase64: response.audioContent.toString('base64') };
});

ipcMain.handle('generate-tts-audio', async (_, text) => {
    if (typeof text !== 'string' || !text.trim()) throw new Error('Invalid TTS text');

    const [response] = await ttsClient.synthesizeSpeech({
        input: { text },
        voice: { languageCode: 'id-ID', ssmlGender: 'NEUTRAL' },
        audioConfig: { audioEncoding: 'MP3' }
    });

    const filename = text.replace(/ /g, '_') + '.mp3';
    const resolvedPath = path.join(__dirname, 'indonesian_audio', filename);
    await fs.promises.mkdir(path.join(__dirname, 'indonesian_audio'), { recursive: true });
    await fs.promises.writeFile(resolvedPath, response.audioContent);

    return { relativePath: 'indonesian_audio/' + filename };
});

ipcMain.handle('save-audio-file', async (_, payload) => {
    const { relativePath, byteArray } = payload || {};

    if (typeof relativePath !== 'string' || !relativePath.startsWith('indonesian_audio/')) {
        throw new Error('Invalid audio path');
    }
    if (!relativePath.endsWith('.mp3') && !relativePath.endsWith('.wav')) {
        throw new Error('Audio file must be MP3 or WAV');
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
