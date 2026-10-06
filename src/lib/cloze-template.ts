/**
 * 填空汤底的编辑模型。存储格式仍是 [[答案]]（后端按它判题），
 * 但作者看到和操作的是「一串字 + 被选中的字」：
 * 写故事时是纯文本，挖空时在字上点选，保存前再拼回带标记的模板。
 */

const MARK = /\[\[([^[\]]+)\]\]/g

/** 能挖空的字：不是空白，也不是标点／符号。空格、逗号这些留在空与空之间原样显示。 */
export function isBlankable(char: string) {
  return !/[\s\p{P}\p{S}]/u.test(char)
}

export interface ClozeDoc {
  /** 故事里的每个字（按码点，和后端数格子的方式一致） */
  chars: string[]
  /** 被挖空的字在 chars 里的下标 */
  blanks: Set<number>
}

/** 把带标记的模板拆成纯文字 + 挖空下标。模板里写错的标记会原样留作文字。 */
export function parseDoc(template: string): ClozeDoc {
  const chars: string[] = []
  const blanks = new Set<number>()
  let cursor = 0
  for (const match of template.matchAll(MARK)) {
    chars.push(...template.slice(cursor, match.index))
    for (const char of match[1]) {
      if (isBlankable(char)) blanks.add(chars.length)
      chars.push(char)
    }
    cursor = match.index + match[0].length
  }
  chars.push(...template.slice(cursor))
  return { chars, blanks }
}

/** 连续的、被选中的字合成一处填空：[[雨伞]]。 */
export function composeDoc({ chars, blanks }: ClozeDoc): string {
  let out = ''
  let open = false
  chars.forEach((char, index) => {
    const blank = blanks.has(index) && isBlankable(char)
    if (blank !== open) out += blank ? '[[' : ']]'
    open = blank
    out += char
  })
  return open ? `${out}]]` : out
}

/** 作者改了故事文字：公共前后缀之外的字算改过，挖空只保留没动的部分，并随位置平移。 */
export function editText(doc: ClozeDoc, text: string): ClozeDoc {
  const next = [...text]
  const old = doc.chars
  const limit = Math.min(old.length, next.length)
  let head = 0
  while (head < limit && old[head] === next[head]) head++
  let tail = 0
  while (tail < limit - head && old[old.length - 1 - tail] === next[next.length - 1 - tail]) tail++
  const shift = next.length - old.length
  const blanks = new Set<number>()
  for (const index of doc.blanks) {
    if (index < head) blanks.add(index)
    else if (index >= old.length - tail) blanks.add(index + shift)
  }
  return { chars: next, blanks }
}

/** 起点到终点之间（含两端）可挖的字的下标。 */
export function blankableBetween(chars: string[], a: number, b: number): number[] {
  const [from, to] = a <= b ? [a, b] : [b, a]
  const out: number[] = []
  for (let index = from; index <= to; index++) if (isBlankable(chars[index])) out.push(index)
  return out
}

/**
 * 对一段字下手：这些字已经全是空，就一起取消；否则全部挖成空。
 * 返回新的集合，不改原来的。
 */
export function paint(blanks: Set<number>, indexes: number[], mode?: 'add' | 'remove') {
  const next = new Set(blanks)
  const remove = mode ? mode === 'remove' : indexes.length > 0 && indexes.every((i) => next.has(i))
  for (const index of indexes) {
    if (remove) next.delete(index)
    else next.add(index)
  }
  return next
}

export interface BlankGroup {
  start: number
  end: number
}

/** 当前有几处填空（连续的空算一处）。 */
export function blankGroups({ chars, blanks }: ClozeDoc): BlankGroup[] {
  const groups: BlankGroup[] = []
  chars.forEach((char, index) => {
    if (!blanks.has(index) || !isBlankable(char)) return
    const last = groups[groups.length - 1]
    if (last && last.end === index) last.end = index + 1
    else groups.push({ start: index, end: index + 1 })
  })
  return groups
}

/** 后端 parseCloze 会拒绝的情况，提前告诉作者；没挖空不算错误，只是还没开始。 */
export type ClozeIssue = 'unpaired' | 'blank' | 'spaced' | 'tooLong'

export function clozeIssues(template: string, maxLength = 2000): ClozeIssue[] {
  const issues = new Set<ClozeIssue>()
  let rest = ''
  let cursor = 0
  for (const match of template.matchAll(MARK)) {
    rest += template.slice(cursor, match.index)
    cursor = match.index + match[0].length
    if (!match[1].trim()) issues.add('blank')
    else if (/\s/.test(match[1])) issues.add('spaced')
  }
  rest += template.slice(cursor)
  if (/\[\[|\]\]/.test(rest)) issues.add('unpaired')
  if ([...template].length > maxLength) issues.add('tooLong')
  return [...issues]
}
