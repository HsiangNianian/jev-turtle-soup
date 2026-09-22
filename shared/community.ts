/**
 * 读者群：积案拂尘·奇案特刊编辑部（QQ）。
 *
 * 放在 shared 里是因为**两边都要用**：主持人被问到「怎么反馈 / 怎么找你们」时
 * 要在回复里报出群名和群号（服务端），界面上的邀请要给出可点的链接（客户端）。
 * 一份数据两处引用，改群号只改这里。
 */
export const QQ_GROUP = {
  name: '积案拂尘·奇案特刊编辑部',
  number: '751476984',
  href: 'https://qm.qq.com/q/GCKLmli6uC',
  /** 群是中文社区——非中文回复里要如实说一句，别把人骗进去 */
  chineseOnly: true,
} as const

/** 是不是我们自己的群链接：离站页据此换一套更客气的说法。 */
export function isCommunityLink(url: string): boolean {
  try {
    return new URL(url).host.toLowerCase() === 'qm.qq.com'
  } catch {
    return false
  }
}
