import React, { useState, useEffect, useRef } from 'react';
import { X, Copy, CheckCircle2, RotateCw, ExternalLink } from 'lucide-react';

interface CopilotAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (token: string) => void;
}

const CLIENT_ID = "Iv1.b507a08c87ecfe98";

export function CopilotAuthModal({ isOpen, onClose, onSuccess }: CopilotAuthModalProps) {
  const [step, setStep] = useState<'init' | 'code' | 'success'>('init');
  const [deviceCode, setDeviceCode] = useState('');
  const [userCode, setUserCode] = useState('');
  const [verificationUri, setVerificationUri] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [expiresIn, setExpiresIn] = useState(0);
  const pollIntervalRef = useRef<NodeJS.Timeout | undefined>();

  useEffect(() => {
    if (isOpen) {
      startAuth();
    }
    return () => stopPolling();
  }, [isOpen]);

  const stopPolling = () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = undefined;
    }
  };

  const startAuth = async () => {
    setStep('init');
    setError(undefined);
    try {
      // Use IPC to bypass CORS
      const data = await window.electron.invoke('ai:github-auth-device-code', CLIENT_ID);
      
      setDeviceCode(data.device_code);
      setUserCode(data.user_code);
      setVerificationUri(data.verification_uri);
      setExpiresIn(data.expires_in);
      setStep('code');
      
      startPolling(data.device_code, data.interval);

    } catch (err) {
      setError((err as Error).message);
    }
  };

  const startPolling = (deviceCode: string, interval: number) => {
    stopPolling();
    pollIntervalRef.current = setInterval(async () => {
      try {
        // Use IPC to bypass CORS
        const data = await window.electron.invoke('ai:github-auth-poll-token', {
            clientId: CLIENT_ID,
            deviceCode
        });

        if (data.access_token) {
          stopPolling();
          setStep('success');
          // Wait a moment for user to see success
          setTimeout(() => {
             onSuccess(data.access_token);
             onClose();
          }, 1500);
        } else if (data.error === 'authorization_pending') {
          // Continue polling
        } else if (data.error === 'slow_down') {
          stopPolling();
          startPolling(deviceCode, interval + 5);
        } else if (data.error === 'expired_token') {
          stopPolling();
          setError('Code expired, please try again');
        } else {
             // other errors
        }
      } catch (e) {
         // ignore network bumps during poll
      }
    }, interval * 1000 + 100); // Add a small buffer
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(userCode);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-surface border border-border rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="p-6">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-xl font-semibold">GitHub Copilot Login</h3>
            <button onClick={onClose} className="text-text-muted hover:text-text-main transition-colors">
              <X size={20} />
            </button>
          </div>

          {step === 'init' && !error && (
            <div className="flex flex-col items-center justify-center py-12 space-y-4">
               <RotateCw className="animate-spin text-primary" size={32} />
               <p className="text-text-muted">Connecting to GitHub...</p>
            </div>
          )}

          {step === 'code' && (
            <div className="space-y-6">
              <div className="bg-surface-light p-4 rounded-lg border border-border text-center">
                 <p className="text-sm text-text-muted mb-2">Device Code</p>
                 <div className="flex items-center justify-center gap-3">
                    <code className="text-2xl font-mono text-primary font-bold tracking-wider">{userCode}</code>
                    <button 
                       onClick={handleCopyCode}
                       className="p-2 hover:bg-surface-hover rounded-lg text-text-muted hover:text-text-main transition-colors"
                       title="Copy Code"
                    >
                        <Copy size={18} />
                    </button>
                 </div>
              </div>

              <div className="space-y-4">
                  <ol className="list-decimal list-inside space-y-3 text-sm text-text-sec">
                      <li>Copy the code above</li>
                      <li>
                          Click the link below to open GitHub
                          <a 
                             href={verificationUri}
                             target="_blank"
                             rel="noopener noreferrer"
                             className="flex items-center gap-2 mt-2 px-4 py-3 bg-primary/10 hover:bg-primary/20 text-primary rounded-lg transition-colors border border-primary/20"
                          >
                              <ExternalLink size={16} />
                              <span>{verificationUri}</span>
                          </a>
                      </li>
                      <li>Paste the code and authorize</li>
                  </ol>
              </div>
              
              <div className="pt-4 border-t border-border flex justify-center">
                   <div className="flex items-center gap-2 text-xs text-text-muted">
                       <RotateCw size={12} className="animate-spin" />
                       Waiting for authorization...
                   </div>
              </div>
            </div>
          )}

          {step === 'success' && (
             <div className="flex flex-col items-center justify-center py-8 space-y-4 text-center">
                 <div className="w-16 h-16 bg-green-500/10 text-green-500 rounded-full flex items-center justify-center mb-2">
                     <CheckCircle2 size={32} />
                 </div>
                 <h4 className="text-lg font-medium text-text-main">Successfully Logged In!</h4>
                 <p className="text-sm text-text-muted">You can now use GitHub Copilot.</p>
             </div>
          )}

          {error && (
             <div className="flex flex-col items-center justify-center py-8 space-y-4 text-center">
                 <div className="w-16 h-16 bg-red-500/10 text-red-500 rounded-full flex items-center justify-center mb-2">
                     <X size={32} />
                 </div>
                 <h4 className="text-lg font-medium text-text-main">Login Failed</h4>
                 <p className="text-sm text-red-400">{error}</p>
                 <button 
                    onClick={startAuth}
                    className="mt-4 px-4 py-2 bg-surface-light hover:bg-surface-hover border border-border rounded-lg text-sm transition-colors"
                 >
                    Try Again
                 </button>
             </div>
          )}
        </div>
      </div>
    </div>
  );
}
