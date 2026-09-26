export type MicrophoneSelection =
  | { kind: 'system-default' }
  | { kind: 'device'; deviceId: string };

export interface MicrophoneDeviceOption {
  selection: MicrophoneSelection;
  label: string;
}

export const DEFAULT_MICROPHONE_SELECTION: MicrophoneSelection = { kind: 'system-default' };

const SYSTEM_DEFAULT_VALUE = 'system-default';
const DEVICE_VALUE_PREFIX = 'device:';

export function microphoneSelectionValue(selection: MicrophoneSelection): string {
  return selection.kind === 'system-default'
    ? SYSTEM_DEFAULT_VALUE
    : `${DEVICE_VALUE_PREFIX}${selection.deviceId}`;
}

export function microphoneSelectionFromValue(value: string): MicrophoneSelection {
  return value.startsWith(DEVICE_VALUE_PREFIX)
    ? { kind: 'device', deviceId: value.slice(DEVICE_VALUE_PREFIX.length) }
    : DEFAULT_MICROPHONE_SELECTION;
}

export async function listMicrophoneDevices(requestPermission = false): Promise<MicrophoneDeviceOption[]> {
  if (!navigator.mediaDevices?.enumerateDevices) {
    throw new Error('Microphone device enumeration is unavailable');
  }

  if (requestPermission) {
    const permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of permissionStream.getTracks()) track.stop();
  }

  const devices = await navigator.mediaDevices.enumerateDevices();
  const microphones = devices.filter(device => device.kind === 'audioinput' && device.deviceId !== 'default');
  const seen = new Set<string>();
  const options: MicrophoneDeviceOption[] = [
    { selection: DEFAULT_MICROPHONE_SELECTION, label: 'System Default' },
  ];

  for (const device of microphones) {
    if (!device.deviceId || seen.has(device.deviceId)) continue;
    seen.add(device.deviceId);
    options.push({
      selection: { kind: 'device', deviceId: device.deviceId },
      label: device.label || `Microphone ${options.length}`,
    });
  }

  return options;
}
