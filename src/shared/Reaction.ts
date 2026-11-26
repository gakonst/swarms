import * as Limits from './Limits.ts'
export const emojis = ['👍', '❤️', '😂', '🎉', '🔥', '👀', '🚀', '🙏', '💯', '🤔', '✅', '😮'] as const

export type Emoji = (typeof emojis)[number]

export const perMinute = Limits.SharedReaction.perMinute

export function known(emoji: string): emoji is Emoji {
  return (emojis as readonly string[]).includes(emoji)
}
