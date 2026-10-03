import { ApiError, judge, type GameEnv } from './game.ts'

export interface ClozeView {
  title: string
  surface: string
  parts: (string | { id: number; letters: string[] })[]
  complete: boolean
}

export function parseCloze(template: string) {
  const parts = template.split(/\[\[([^[\]]+)\]\]/g)
  if (
    parts.length < 3 ||
    parts.some((part, index) =>
      index % 2 ? !part.trim() || /\s/.test(part) : /\[\[|\]\]/.test(part),
    )
  ) {
    throw new ApiError(400, '请用 [[答案]] 标记至少一处填空；标记须成对，答案不能含空白或嵌套标记')
  }
  return parts
}

export async function clozeAction(
  env: GameEnv,
  input: unknown,
  puzzle: { title: string; surface: string; template: string; hint?: string },
) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ApiError(400, '请求格式不正确')
  }
  const body = input as Record<string, unknown>
  const { title, surface, template } = puzzle
  const parts = parseCloze(template)
  const answers = parts.filter((_, index) => index % 2 === 1).map((text) => [...text])
  const story = parts.join('')

  function view(guesses: string[][], reveal = false): ClozeView {
    const letters = answers.map((answer, id) =>
      answer.map((char, position) => (reveal || guesses[id]?.[position] === char ? char : '')),
    )
    return {
      title,
      surface,
      parts: parts.map((text, index) =>
        index % 2 ? { id: (index - 1) / 2, letters: letters[(index - 1) / 2] } : text,
      ),
      complete: letters.every((word) => word.every(Boolean)),
    }
  }

  if (body.action === 'open') return view([])
  if (body.action === 'reveal') return view([], true)
  if (body.action === 'check') {
    const guesses = body.guesses
    if (
      !Array.isArray(guesses) ||
      guesses.length !== answers.length ||
      guesses.some(
        (word, id) =>
          !Array.isArray(word) ||
          word.length !== answers[id].length ||
          word.some((char) => typeof char !== 'string' || [...char].length > 1),
      )
    )
      throw new ApiError(400, '请在每个空格中填写一个字')
    return view(guesses)
  }
  if (body.action === 'ask') {
    if (
      body.history !== undefined &&
      (!Array.isArray(body.history) ||
        body.history.length > 100 ||
        body.history.some(
          (turn) => !turn || typeof turn !== 'object' || typeof turn.text !== 'string',
        ))
    ) {
      throw new ApiError(400, '提问记录格式不正确')
    }
    const {
      truth: _truth,
      story: _story,
      ...turn
    } = await judge(
      env,
      {
        title,
        surface:
          surface +
          '\n\n填空故事：\n' +
          parts
            .map((text, index) =>
              index % 2 ? `【第 ${(index + 1) / 2} 处：${'□'.repeat([...text].length)}】` : text,
            )
            .join(''),
        truth: story,
        story,
        hint: puzzle.hint ?? '',
      },
      body,
    )
    return {
      ...turn,
      solved: false,
      revealed: false,
      reply: turn.solved
        ? '推理正确！继续把故事中的缺字补齐吧。'
        : turn.revealed
          ? '点击「揭晓」可以查看完整故事；也可以继续提问、填字。'
          : turn.reply,
      verdict: turn.solved ? 'yes' : turn.verdict,
    }
  }
  throw new ApiError(400, '未知的填空操作')
}
