const DEVICE_KEY = 'turtle-soup.device.v1'

export interface LuckTier {
  key: string
  label: string
  min: number
  tone: string
  verses: string[]
}

const TIERS: LuckTier[] = [
  {
    key: 'great',
    label: '大吉',
    min: 90,
    tone: 'var(--v-yes)',
    verses: [
      '今天的直觉准得反常，值得相信第一次冒出来的念头。',
      '你会在最不起眼的细节里，摸到整件事的线头。',
      '主持人今天格外配合，问什么答什么都对得上。',
    ],
  },
  {
    key: 'good',
    label: '吉',
    min: 70,
    tone: 'var(--v-yes)',
    verses: [
      '线索会自己找上门，别急着下结论就好。',
      '多问一句，就能把缺口补上。',
      '方向是对的，只差把话说得更具体一点。',
    ],
  },
  {
    key: 'plain',
    label: '中平',
    min: 45,
    tone: 'var(--v-irrelevant)',
    verses: [
      '今天适合收集信息，不适合拍板。',
      '真相不会主动出现，但也不会躲得太远。',
      '先把已知的写下来，答案往往藏在重复的地方。',
    ],
  },
  {
    key: 'minor',
    label: '小凶',
    min: 25,
    tone: 'var(--v-partly)',
    verses: [
      '容易钻牛角尖，卡住时不妨换个问法。',
      '今天的第一直觉可能是个陷阱，多验一遍。',
      '别人云亦云，先确认自己真的读懂了汤面。',
    ],
  },
  {
    key: 'bad',
    label: '凶',
    min: 0,
    tone: 'var(--stamp)',
    verses: [
      '宜歇一歇。硬猜只会把线索搅得更乱。',
      '今天容易把巧合当成因果，慢一点再下判断。',
      '别在情绪里盘问，先喝口水再看汤面。',
    ],
  },
]

const GOOD = [
  '追问细节',
  '大胆猜测',
  '换个角度',
  '重读汤面',
  '记录时间线',
  '相信直觉',
  '检查反常之处',
  '先问是不是',
]

const BAD = [
  '凭空臆断',
  '连问三题',
  '熬夜盘问',
  '忽视细节',
  '轻信第一直觉',
  '半途而废',
  '急着揭晓',
  '自说自话',
]

export function getDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_KEY)
    if (existing) return existing
    const created = crypto.randomUUID()
    localStorage.setItem(DEVICE_KEY, created)
    return created
  } catch {
    return 'anonymous-device'
  }
}

export function todayKey(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

function fnv1a(input: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** Deterministic PRNG seeded by a single integer (xorshift-ish mixer). */
function seeded(seed: number): () => number {
  let state = seed || 0x9e3779b9
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface DailyLuck {
  date: string
  score: number
  tier: LuckTier
  verse: string
  good: string
  bad: string
  salt: string
  device: string
}

/**
 * 今日人品：盐值（站点域名）+ 日期 + 设备识别码三者哈希，得到当天唯一且稳定的结果。
 */
export function dailyLuck(date: string, salt: string, device: string): DailyLuck {
  const random = seeded(fnv1a(`${salt}|${date}|${device}`))
  const score = Math.floor(random() * 101)
  const tier = TIERS.find((item) => score >= item.min) ?? TIERS[TIERS.length - 1]
  const verse = tier.verses[Math.floor(random() * tier.verses.length)]
  const goodIndex = Math.floor(random() * GOOD.length)
  let badIndex = Math.floor(random() * BAD.length)
  if (badIndex === goodIndex) badIndex = (badIndex + 1) % BAD.length

  return {
    date,
    score,
    tier,
    verse,
    good: GOOD[goodIndex],
    bad: BAD[badIndex],
    salt,
    device,
  }
}
