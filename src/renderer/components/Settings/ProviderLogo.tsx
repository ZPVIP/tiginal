import React, { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { ICONS } from '../../settings/icons';

interface ProviderLogoProps {
  providerId?: string;
  className?: string;
}

export function ProviderLogo({ providerId, className }: ProviderLogoProps) {
  const [failed, setFailed] = useState(false);
  const hasCatalogLogo = Boolean(providerId && providerId !== 'custom');

  useEffect(() => {
    setFailed(false);
  }, [providerId]);

  if (!hasCatalogLogo || failed) {
    return (
      <span
        aria-hidden="true"
        className={clsx('flex items-center justify-center', className)}
        dangerouslySetInnerHTML={{ __html: ICONS.custom }}
      />
    );
  }

  return (
    <img
      src={`https://models.dev/logos/${encodeURIComponent(providerId)}.svg`}
      alt=""
      aria-hidden="true"
      loading="lazy"
      referrerPolicy="no-referrer"
      className={clsx('object-contain', className)}
      onError={() => setFailed(true)}
    />
  );
}
