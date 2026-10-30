import type { Answer } from './Api.ts'

const status = /^[*_>\s]*STATUS:\s*(done|continue)\b[\s:\u2014\u2013-]*(.*?)[*_\s]*$/i

export function parse(round: number, message: string, at: number): Answer {
  const lines = message.trimEnd().split('\n')
  const found = status.exec(lines.at(-1) ?? '')
  const verdict = found?.[1]?.toLowerCase()
  return {
    at,
    done: verdict === 'done',
    next: verdict === 'continue' ? found?.[2]?.trim() || null : null,
    round,
    text: (found ? lines.slice(0, -1) : lines).join('\n').trim(),
  }
}

export function excerpt(text: string, length = 220) {
  const plain = text
    .split('\n')
    .filter((line) => !/^\s*(\||[-:| ]{3,}$|#{1,6}\s*$)/.test(line))
    .map((line) => line.replace(/^\s*(#{1,6}|>|[-*+]|\d+\.)\s+/, '').replace(/[*_`]/g, '').trim())
    .filter(Boolean)
    .join(' ')
  return plain.length > length ? plain.slice(0, length - 1).trimEnd() + '…' : plain
}
