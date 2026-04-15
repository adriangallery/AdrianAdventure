const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 800,
    minHeight: 450,
    fullscreen: false,
    fullscreenable: true,
    autoHideMenuBar: true,
    backgroundColor: '#06060c',
    title: 'ZEROadventure II',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Load the built game from dist/
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  // Hide menu bar
  win.setMenuBarVisibility(false);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});
