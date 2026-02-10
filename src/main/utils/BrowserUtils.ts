import { BrowserWindow, app } from 'electron';

/**
 * Perform a web fetch using a hidden Electron BrowserWindow.
 * This ensures we can capture JS-rendered content (SPA) which a simple fetch() cannot.
 */
export async function performWebFetch(url: string, prompt?: string): Promise<string> {
    return new Promise((resolve, reject) => {
        let win: BrowserWindow | null = new BrowserWindow({
            show: false,
            width: 1024,
            height: 768,
            webPreferences: {
                offscreen: true,
                nodeIntegration: false,
                contextIsolation: true,
                sandbox: true,
                webSecurity: true 
            }
        });

        const cleanup = () => {
            if (win) {
                win.destroy();
                win = null;
            }
        };

        // Set timeout
        const timeout = setTimeout(() => {
            cleanup();
            reject(new Error(`WebFetch timed out for ${url}`));
        }, 30000);

        win.loadURL(url, { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' })
            .catch(err => {
                clearTimeout(timeout);
                cleanup();
                reject(new Error(`Failed to load URL: ${err.message}`));
            });

        win.webContents.on('did-finish-load', async () => {
            if (!win) return;
            try {
                // Execute script to extract content
                // We use a simple strategy: Readability-like or just body text
                // Since we don't want to add huge dependencies efficiently here, we'll do a basic text extraction + title
                const result = await win.webContents.executeJavaScript(`
                    (function() {
                        // Simple cleanup
                        const clone = document.cloneNode(true);
                        const doc = clone;
                        
                        // Remove scripts, styles, nav, footers, etc to reduce noise
                        const trash = doc.querySelectorAll('script, style, noscript, iframe, svg, nav, footer, header, .ad, .advertisement, [role="alert"], [role="banner"], [role="dialog"]');
                        trash.forEach(el => el.remove());
                        
                        let markdown = '';
                        const title = document.title;
                        const body = document.body.innerText.replace(/\\n{3,}/g, '\\n\\n'); // normalize newlines
                        
                        return { title, body };
                    })()
                `);
                
                clearTimeout(timeout);
                cleanup();
                
                const content = `Title: ${result.title}\nURL: ${url}\n\n${result.body}`;
                resolve(content);
            } catch (err) {
                clearTimeout(timeout);
                cleanup();
                reject(new Error(`Failed to extract content: ${(err as Error).message}`));
            }
        });
        
        win.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
            if (errorCode === -3) return; // ABORTED usually fine
            clearTimeout(timeout);
            cleanup();
            reject(new Error(`Failed to load: ${errorDescription} (${errorCode})`));
        });
    });
}
