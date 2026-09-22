/**
 * 读者群的客户端出口：数据本身在 shared/community.ts（服务端也要用）。
 *
 * 邀请**只在中文界面出现**：群是中文社区，把英文/日文读者送进去只会让人一脸茫然。
 */
export { isCommunityLink, QQ_GROUP } from '../../shared/community.ts'

/** 邀请只给中文界面看。 */
export function showsGroupInvite(locale: string): boolean {
  return locale === 'zh-CN'
}
