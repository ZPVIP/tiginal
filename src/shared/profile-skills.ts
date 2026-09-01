function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseProfileSkills(value: unknown): unknown {
  if (typeof value !== 'string') return value;

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function shouldUseSkillsForProfile(profileSkills: unknown): boolean {
  const config = parseProfileSkills(profileSkills);
  if (!isRecord(config) || config.global_enabled !== true) return false;

  return Array.isArray(config.enabled_skill_ids) && config.enabled_skill_ids.length > 0;
}
