require('dotenv').config();

const { app, BrowserWindow } = require('electron');
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
