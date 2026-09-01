export const CONVERSATION_TITLE_DISPLAY_LIMIT = 30;

export function formatConversationTitle(title: string): string {
  const characters = Array.from(title);
  if (characters.length <= CONVERSATION_TITLE_DISPLAY_LIMIT) return title;

  return `${characters.slice(0, CONVERSATION_TITLE_DISPLAY_LIMIT - 3).join('')}...`;
}
