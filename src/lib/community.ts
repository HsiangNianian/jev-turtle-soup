/**
 * 读者群：积案拂尘·奇案特刊编辑部（QQ）。
 *
 * 只有一处定义 —— 群链接哪天换了，改这里就行，不用满仓库找。
 * 邀请**只在中文界面出现**：群是中文社区，把英文/日文读者送进去只会让人一脸茫然。
 */
export const QQ_GROUP = {
  name: '积案拂尘·奇案特刊编辑部',
  number: '751476984',
  href: 'https://qm.qq.com/q/GCKLmli6uC',
} as const

/** 邀请只给中文界面看。 */
export function showsGroupInvite(locale: string): boolean {
  return locale === 'zh-CN'
}

/**
 * 是不是我们自己的群链接。
 * 离站中转页据此换一套更客气的说法：通用警告写着「我们不对它的隐私做法负责」，
 * 对一条「来加入我们吧」的邀请来说太像在防贼。
 */
export function isCommunityLink(url: string): boolean {
  try {
    return new URL(url).host.toLowerCase() === 'qm.qq.com'
  } catch {
    return false
  }
}
