
/**
 * Network Utilities
 */

/**
 * Perform a fetch with automatic fallback for localhost IPv6 issues.
 * Node 17+ defaults to IPv6 (::1) for localhost, but many services (like Ollama) listen on IPv4 (127.0.0.1).
 * If a request to localhost fails with ECONNREFUSED, this will retry with 127.0.0.1.
 */
export async function fetchWithLocalhostFallback(url: string, options: RequestInit): Promise<Response> {
    const isLocalhost = url.includes('localhost');
    
    // Proactive optimization: Try 127.0.0.1 first if it's localhost (avoids Node 17+ IPv6 issues on Mac)
    if (isLocalhost) {
        const ipv4Url = url.replace('localhost', '127.0.0.1');
        try {
            return await fetch(ipv4Url, options);
        } catch (e: any) {
             const err = e as Error & { code?: string; cause?: any };
             // If 127.0.0.1 failed, it might be that the server IS actually listening on ::1 or a specific host mapping
             // So we fallback to the original 'localhost' URL
             if (err.code === 'ECONNREFUSED' || err.cause?.code === 'ECONNREFUSED' || err.message.includes('fetch failed')) {
                 if (process.env.NODE_ENV !== 'production') {
                    console.log(`[NetworkUtils] Connection failed on 127.0.0.1, retrying with localhost: ${url}`);
                 }
                 return await fetch(url, options);
             }
             throw e;
        }
    }

    // Standard fetch for non-localhost
    return await fetch(url, options);
}
