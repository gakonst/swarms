import * as Limits from '../shared/Limits.ts'
export const pace = typeof window !== 'undefined' && window.top !== window ? Limits.WebStage.framedPace : 1

export const scene = new Set((typeof location === 'undefined' ? '' : (new URLSearchParams(location.search).get('scene') ?? '')).split(',').filter(Boolean))

export const visitor = '0x7a3f5e1b2c4d6e8f9a0b1c2d3e4f5a6b7c8d9c2e'
