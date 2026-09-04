import * as path from 'node:path';

export interface CredentialEndpointInput {
  platform: 'darwin' | 'linux' | 'win32';
  homeDir: string;
  appData?: string;
  username: string;
}

export function credentialConfigDir(input: CredentialEndpointInput): string {
  return input.platform === 'win32'
    ? path.win32.join(input.appData || input.homeDir, 'Tiginal')
    : path.posix.join(input.homeDir, '.config', 'tiginal');
}

export function credentialSocketPathFor(input: CredentialEndpointInput): string {
  if (input.platform === 'win32') {
    const username = input.username.replace(/[^A-Za-z0-9_.-]+/g, '_');
    return `\\\\.\\pipe\\tiginal-cred-${username}`;
  }
  return path.posix.join(credentialConfigDir(input), 'cred.sock');
}
