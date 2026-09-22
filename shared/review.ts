import { z } from 'zod'

import { generateJson, resolveLlm, type GameEnv } from './game.ts'

/**
 * 上传前的自动体检。
 *
 * 玩家的第一次「回音」往往要等到有人玩过——太晚了。发布的那一刻就用 Jev
 * 看一眼稿子，把「汤面剧透 / 细节没交代 / 问不出来 / 没有唯一解」直接告诉作者。
 *
 * **只提示，不拦**：结果随创建响应一起回去，作者想改就改，想发照样能发。
 * 失败（没配 key、模型抽风）就返回 null，上传照常——体检不能成为发布的门槛。
 */

const ReviewSchema = z.object({
  issues: z.array(
    z.object({
      kind: z.enum(['spoiler', 'unexplained', 'unsolvable', 'no_unique']),
      detail: z.string().max(120),
    }),
  ),
})

export interface PuzzleIssue {
  kind: 'spoiler' | 'unexplained' | 'unsolvable' | 'no_unique'
  detail: string
}

const LANGUAGE: Record<string, string> = {
  'zh-CN': '简体中文',
  en: 'English',
  ja: '日本語',
}

function system(locale: string): string {
  return `你是海龟汤编辑。作者刚写好一碗汤，发布前请你先看一眼。

只依据给出的汤面和汤底判断，不要脑补设定。逐条指出问题；确实没问题就给空数组。
检查这四类：
- spoiler：汤面把原因或真相直接写了出来（剧透）。
- unexplained：汤面提到的细节，汤底没有交代。
- unsolvable：只靠「是 / 不是」提问，玩家问不到真相（真相依赖汤底没给的设定）。
- no_unique：汤底只是众多可能里的一种，玩家无法排除其它解释。

宁缺毋滥：只报确实成立的问题，一条也别硬凑。detail 不超过 40 字，用${LANGUAGE[locale] ?? '简体中文'}。

只输出一个 json 对象，不要 markdown 代码块：
{"issues":[{"kind":"unexplained","detail":"……"}]}`
}

export async function reviewPuzzle(
  env: GameEnv,
  puzzle: { title: string; surface: string; truth: string },
  locale = 'zh-CN',
): Promise<PuzzleIssue[] | null> {
  const cfg = resolveLlm(env)
  if (!cfg) return null
  try {
    const data = await generateJson<z.infer<typeof ReviewSchema>>(cfg, {
      system: system(locale),
      user: `汤面：${puzzle.surface}\n\n汤底：${puzzle.truth}`,
      effort: 'low',
      check: (raw) => {
        const parsed = ReviewSchema.safeParse(raw)
        if (!parsed.success) return { issues: ['json 结构不合法'] }
        return { value: parsed.data, issues: [] }
      },
    })
    return data.issues.slice(0, 5).map((issue) => ({
      kind: issue.kind,
      detail: issue.detail.slice(0, 120),
    }))
  } catch (error) {
    console.warn('[turtle-soup] 上传体检失败：', error)
    return null
  }
}
