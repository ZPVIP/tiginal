export const IMAGE_ATTACHMENT_FORMAT_MESSAGE = 'Tiginal supports JPEG and PNG images only. Please convert the image and try again.';

export type SupportedImageMimeType = 'image/jpeg' | 'image/png';

export type ImageAttachmentMimeTypeValidation =
  | { ok: true; mimeType: SupportedImageMimeType }
  | { ok: false; message: string };

export type ImageAttachmentDataUrlValidation =
  | {
      ok: true;
      attachment: {
        mimeType: SupportedImageMimeType;
        encoding: 'base64' | 'percent-encoded';
        data: string;
      };
    }
  | { ok: false; message: string };

export type ImageAttachmentBytesValidation =
  | { ok: true }
  | { ok: false; message: string };

function formatUnsupportedImageMessage(fileName?: string): string {
  const subject = fileName ? `"${fileName}"` : 'This image';
  return `${subject} cannot be attached. ${IMAGE_ATTACHMENT_FORMAT_MESSAGE}`;
}

export function validateImageAttachmentMimeType(
  mimeType: string,
  fileName?: string,
): ImageAttachmentMimeTypeValidation {
  const normalizedMimeType = mimeType.trim().toLowerCase();
  if (normalizedMimeType === 'image/jpeg' || normalizedMimeType === 'image/png') {
    return { ok: true, mimeType: normalizedMimeType };
  }
  if (normalizedMimeType === 'image/jpg') {
    return { ok: true, mimeType: 'image/jpeg' };
  }

  return { ok: false, message: formatUnsupportedImageMessage(fileName) };
}

function startsWithBytes(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte);
}

export function validateImageAttachmentBytes(
  mimeType: SupportedImageMimeType,
  bytes: Uint8Array,
  fileName?: string,
): ImageAttachmentBytesValidation {
  switch (mimeType) {
    case 'image/jpeg':
      return startsWithBytes(bytes, [0xff, 0xd8, 0xff])
        ? { ok: true }
        : { ok: false, message: formatUnsupportedImageMessage(fileName) };
    case 'image/png':
      return startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
        ? { ok: true }
        : { ok: false, message: formatUnsupportedImageMessage(fileName) };
    default: {
      const _exhaustive: never = mimeType;
      return _exhaustive;
    }
  }
}

export function parseImageAttachmentDataUrl(dataUrl: string): ImageAttachmentDataUrlValidation {
  const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) {
    return {
      ok: false,
      message: `This image could not be read. ${IMAGE_ATTACHMENT_FORMAT_MESSAGE}`,
    };
  }

  const mimeTypeValidation = validateImageAttachmentMimeType(match[1]);
  if (!mimeTypeValidation.ok) return mimeTypeValidation;

  return {
    ok: true,
    attachment: {
      mimeType: mimeTypeValidation.mimeType,
      encoding: match[2] ? 'base64' : 'percent-encoded',
      data: match[3],
    },
  };
}
