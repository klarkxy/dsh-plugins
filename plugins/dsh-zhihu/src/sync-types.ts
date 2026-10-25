/**
 * 知乎同步（zhihu-sync）发布链路的共享类型契约。
 *
 * 参考（只读镜像，H:\Reference\zhihu-sync-full_v0.1.4，MIT / author zhihu）：
 *   zhihu-sync/zhihu-validate/reference/conversion.md — 标题/正文/媒体转换规则
 *   zhihu-sync/zhihu-validate/reference/config.md     — 话题/目录/创作声明/评论权限/圈子
 *   zhihu-sync/zhihu-publish/reference/publish-*.md   — 各形态发布字段与交互确认项
 *
 * 字段命名约定：SyncDraft 用 camelCase；进入知乎 OpenAPI 请求体时由
 * sync-content 的 buildZhihuPublishRequest 映射为 snake_case。
 */

export type SyncContentType = 'article' | 'question' | 'pin'
export type SyncFormat = 'markdown' | 'html'

/** 文章可用的评论权限（publish-article.md 枚举）。 */
export const SYNC_ARTICLE_COMMENT_PERMISSIONS = ['all', 'nobody', 'followee', 'censor', 'follower'] as const
/** 想法可用的评论权限（publish-pin.md 枚举）。 */
export const SYNC_PIN_COMMENT_PERMISSIONS = ['all', 'nobody', 'followee', 'censor', 'follower_n_days'] as const
export type SyncCommentPermission =
  | (typeof SYNC_ARTICLE_COMMENT_PERMISSIONS)[number]
  | 'follower_n_days'

/** 文章创作声明枚举（publish-article.md）；pin 只允许 'ai_creation'。 */
export const SYNC_ARTICLE_CREATION_STATEMENTS = [
  'spoiler',
  'medical_advice',
  'fictional_creation',
  'contain_finance',
  'ai_creation',
] as const
export type SyncCreationStatement = (typeof SYNC_ARTICLE_CREATION_STATEMENTS)[number]

/**
 * 一张内容图片。url 始终是发布阶段使用的最终地址：
 * 由上传流程填好（有水印且成功时使用水印 URL，否则使用原图 URL）。
 * 本层不根据 mediaId 拼接或回退 URL。
 */
export interface SyncImage {
  /** 发布用最终 URL（知乎媒体地址）。 */
  url: string
  /**
   * 用户提供该图时的原始来源：本地文件绝对路径 / file: URI / 原始 http(s) URL。
   * 浏览器 File API 可能给出 `blob:` 或 `data:` 临时地址——此时该字段也允许
   * 是浏览器生成的临时引用（仅作标识，不保证可持久化）。
   * 仅用于正文图片按出现顺序一一映射和预览层展示，永不写入发布请求体。
   */
  originalUrl?: string
  width?: number
  height?: number
  /** 水印处理成功（watermark_image_key 与 media_key 不同）时为 true。 */
  watermark?: boolean
  /** media_key（v2-{md5hex}）。只作为记录字段，不用于拼接 URL。 */
  mediaId?: string
}

/** 想法独立链接卡片（想法正文之外的 linkCard，最多 1 个）。 */
export interface SyncLinkCard {
  /** 卡片目标链接（必填，绝对 http(s) URL）。 */
  url: string
  /** 卡片标题（对应 data_draft_title）。 */
  title?: string
  /** 封面图 URL（对应 data_draft_cover）。 */
  cover?: string
  /** 链接解析接口返回的数据，外链可省略。 */
  contentType?: string
  contentId?: string
  isFromForward?: boolean
}

/**
 * 发布阶段可交互确认的设置项。validate 阶段只收集与校验；
 * 是否真正写入请求体由 buildZhihuPublishRequest 按形态决定。
 */
export interface SyncPublishSettings {
  /**
   * 评论权限。article 可用 SYNC_ARTICLE_COMMENT_PERMISSIONS，
   * pin 可用 SYNC_PIN_COMMENT_PERMISSIONS；question 不发送。
   */
  commentPermission?: SyncCommentPermission
  /** 文章目录开关，仅 article 使用，默认 false。 */
  tableOfContentsEnabled?: boolean
  /**
   * 创作声明。article 可用全部枚举；pin 仅支持 'ai_creation'；
   * question 不支持该字段。
   */
  creationStatement?: SyncCreationStatement
  /**
   * 话题链接列表（用户粘贴的知乎话题 URL，形如
   * https://www.zhihu.com/topic/{topic_token}/hot）。
   * article 最多 3 个，question 最多 5 个；pin 话题在正文 #话题名# 中，忽略本字段。
   */
  topics?: string[]
  /**
   * 知乎圈子链接（https://www.zhihu.com/ring/host/{ring_id}），仅 pin 使用，最多 1 个。
   */
  ring?: string
}

/**
 * 保存与传输用的规范化草稿。等价于 zhihu-sync 的 draft + 已注入上传结果
 * 的图片引用（images[] 对应想法独立媒体区，正文图片在 body 中用
 * SyncImage.originalUrl 标记用户来源，由转换层解析为发布 URL）。
 */
export interface SyncDraft {
  type: SyncContentType
  /** 标题。question 结尾无问号时由转换层自动补全「？」；pin 可为空字符串。 */
  title: string
  /**
   * 正文源文本。format='markdown' 时为 Markdown；format='html' 时为
   * 用户/上游给出的 HTML 片段（白名单消毒后使用）。
   */
  body: string
  format: SyncFormat
  /** 图片清单：正文内图片（与 body 中图片按出现顺序一一对应）+ 想法独立媒体图。 */
  images?: SyncImage[]
  /** 想法独立链接卡片（与独立图片互斥，仅 pin）。 */
  linkCard?: SyncLinkCard | null
  settings?: SyncPublishSettings
}

export type SyncIssueSeverity = 'error' | 'warning'

export interface SyncIssue {
  severity: SyncIssueSeverity
  /** 稳定机器码，如 'title.too-long' / 'body.unsafe-html'。 */
  code: string
  message: string
}

export interface SyncCounts {
  /** 标题字数（question 含自动补全的问号）。 */
  titleChars: number
  /** 正文纯文本字数（去除 HTML 标签、公式/代码等语义内容仍计入）。 */
  bodyChars: number
  /** 生效图片数：article/question 为正文图片引用数，pin 为独立媒体区图片数。 */
  images: number
  /** 生效的话题数。 */
  topics: number
}

export interface SyncPrepared {
  /** 规范化后的草稿（可直接保存）。 */
  draft: SyncDraft
  /** 知乎适配正文 HTML（发布请求 content.html 的来源；想法仅正文部分）。 */
  html: string
  /** 校验/转换问题列表；error 会阻止发布，warning 表示已降级或需注意。 */
  issues: SyncIssue[]
  /** issues 中无 error 级时为 true。 */
  canPublish: boolean
  counts: SyncCounts
}
