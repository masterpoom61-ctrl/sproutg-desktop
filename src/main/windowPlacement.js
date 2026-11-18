'use strict';

const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

let encodedCommand;

function validRect(rect) {
  return rect && [rect.x, rect.y, rect.width, rect.height].every(Number.isSafeInteger)
    && Math.abs(rect.x) <= 100000 && Math.abs(rect.y) <= 100000
    && rect.width > 0 && rect.width <= 20000 && rect.height > 0 && rect.height <= 20000;
}

function displayLayoutKey(displays) {
  return JSON.stringify(displays
    .map(({ id, bounds, workArea, scaleFactor }) => [id, bounds, workArea, scaleFactor])
    .sort(([a], [b]) => a - b));
}

async function nativeWindowBounds(window, rect) {
  if (process.platform !== 'win32' || !window || window.isDestroyed()) return null;
  if (rect !== undefined && !validRect(rect)) return null;
  try {
    if (!encodedCommand) {
      const script = fs.readFileSync(path.join(__dirname, 'windowPlacement.ps1'), 'utf8');
      encodedCommand = Buffer.from(script, 'utf16le').toString('base64');
      // CreateProcess limits the command line length. Only the local static helper
      // goes into the command line; the rectangle goes through the environment.
    }
    const handle = window.getNativeWindowHandle();
    const hwnd = handle.length === 8 ? handle.readBigUInt64LE().toString() : String(handle.readUInt32LE());
    const input = { hwnd, pid: process.pid, rect };
    const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    return await new Promise(resolve => {
      execFile(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encodedCommand], {
        windowsHide:true,
        timeout:3000,
        maxBuffer:8192,
        env:{ ...process.env, SPROUTG_WINDOW_PLACEMENT:JSON.stringify(input) }
      }, (error, stdout) => {
        if (error) { resolve(null); return; }
        try {
          const result = JSON.parse(stdout);
          resolve(validRect(result) ? result : null);
        } catch { resolve(null); }
      });
    });
  } catch { return null; }
}

module.exports = { nativeWindowBounds, validRect, displayLayoutKey };
