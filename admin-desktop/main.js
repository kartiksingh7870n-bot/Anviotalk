/**
 * Anvio Talk — Admin Console (Desktop)
 * Standalone Electron app. Opens the admin dashboard in a dedicated window.
 * Security: every data action goes through the local server's verifyAdminAuth
 * (Bearer token from Firebase login with kartiksingh7870n@gmail.com or admin@anviotalk.com).
 */
const { app, BrowserWindow, Menu, shell, dialog } = require('electron');
const path = require('path');

const APP_URL = process.env.ADMIN_APP_URL || 'http://localhost:3000';
const DASHBOARD_FILE = path.join(__dirname, 'dashboard.html');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: 'Anvio Talk — Admin Console',
    backgroundColor: '#0f172a',
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  // Remove default menu (cleaner software look)
  Menu.setApplicationMenu(null);

  mainWindow.loadFile(DASHBOARD_FILE);

  // Open external links in system browser instead of the app window
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});
