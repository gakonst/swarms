export const emojis = ['👍', '❤️', '😂', '🎉', '🔥', '👀', '🚀', '🙏', '💯', '🤔', '✅', '😮'] as const

export type Emoji = (typeof emojis)[number]

export const perMinute = 30

export function known(emoji: string): emoji is Emoji {
  return (emojis as readonly string[]).includes(emoji)
}
