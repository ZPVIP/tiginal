import { net } from 'electron';

interface TokenCache {
    accessToken: string;
    expiresAt: number;
}

const tokenCache: Record<string, TokenCache> = {};

export async function getCopilotToken(oauthToken: string): Promise<string> {
    const cached = tokenCache[oauthToken];
    // Check if cached token is valid (with 5 min buffer)
    if (cached && cached.expiresAt > Date.now() + 5 * 60 * 1000) {
        return cached.accessToken;
    }

    // Refresh token logic
    try {
        const response = await fetch('https://api.github.com/copilot_internal/v2/token', {
            headers: {
                'Authorization': `Bearer ${oauthToken}`,
                'User-Agent': 'GitHubCopilotChat/0.35.0' // Match opencode-copilot-auth
            }
        });

        if (!response.ok) {
            // If the OAuth token is invalid (e.g. revoked), this will fail.
            // We should probably clear the cache and throw.
            delete tokenCache[oauthToken];
            throw new Error(`Failed to get Copilot token: ${response.status} ${await response.text()}`);
        }

        const data = await response.json() as { token: string; expires_at: number };
        
        tokenCache[oauthToken] = {
            accessToken: data.token,
            expiresAt: data.expires_at * 1000
        };

        return data.token;
    } catch (error) {
        console.error("Error refreshing Copilot token:", error);
        throw error;
    }
}
