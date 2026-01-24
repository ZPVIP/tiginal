
/**
 * Network Utilities
 */

/**
 * Perform a fetch with automatic fallback for localhost IPv6 issues.
 * Node 17+ defaults to IPv6 (::1) for localhost, but many services (like Ollama) listen on IPv4 (127.0.0.1).
 * If a request to localhost fails with ECONNREFUSED, this will retry with 127.0.0.1.
 */
export async function fetchWithLocalhostFallback(url: string, options: RequestInit): Promise<Response> {
    try {
        return await fetch(url, options);
    } catch (e) {
        const err = e as Error & { code?: string; cause?: any };
        
        // Check for localhost connection refusal
        if (url.includes('localhost') && (err.code === 'ECONNREFUSED' || err.cause?.code === 'ECONNREFUSED')) {
            const ipv4Url = url.replace('localhost', '127.0.0.1');
            
            if (process.env.NODE_ENV !== 'production') {
                console.log(`[NetworkUtils] Connection refused on localhost, retrying with IPv4: ${ipv4Url}`);
            }
            
            try {
                return await fetch(ipv4Url, options);
            } catch (retryErr) {
                // If retry fails, throw the original error to keep the context clear, 
                // or maybe we should log the retry failure and throw original?
                // Let's throw the retry error actually as it might be specific (e.g. 127.0.0.1 also refused)
                throw retryErr; 
            }
        }
        
        throw e;
    }
}
