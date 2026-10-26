import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ZhihuService } from './index.ts'
import type { ZhihuJsonValue } from './open-platform.ts'

/** Publishing is a human confirmation action in the preview pane. The tool can
 * prepare the same saved draft, but never receives a UI review ticket. */
export function createZhihuSyncTool(service: ZhihuService) {
  return defineTool({
    name: 'zhihu_sync',
    description: '管理知乎文章、提问和想法草稿，校验预览或上传配图。上传会将图片发送到知乎；实际发布需用户在预览界面确认，当前分支未提供发布界面。',
    parameters: {
      action: { type: 'string', enum: ['list', 'get', 'save', 'prepare', 'upload_image'], required: true },
      offset: { type: 'integer', description: 'list 分页位置；省略从头读取，后续使用返回的 nextOffset。' },
      id: { type: 'string', description: 'get、prepare 或更新草稿时填写已有 ID。' },
      expectedRevision: { type: 'integer', description: 'prepare 或更新时填写上次读取的 revision。' },
      image: { type: 'object', description: 'upload_image 时填写图片内容。', properties: {
        fileName: { type: 'string', required: true },
        contentBase64: { type: 'string', required: true, description: 'JPEG、PNG、GIF、WebP 或 BMP 的标准 base64。GIF最大15 MB，其他最大30 MB。' },
        scene: { type: 'string', required: true, enum: ['article', 'question', 'pin'] },
      }, additionalProperties: false },
      draft: {
        type: 'object', description: 'save 时提供完整草稿；只做格式适配，不自动删改正文。',
        properties: {
          type: { type: 'string', enum: ['article', 'question', 'pin'], required: true },
          title: { type: 'string', required: true },
          body: { type: 'string', required: true },
          format: { type: 'string', enum: ['markdown', 'html'], required: true },
          images: { type: 'array', description: '已上传的知乎图片；本地图片请通过 upload_image 上传后引用。', items: {
            type: 'object', properties: {
              url: { type: 'string', required: true }, originalUrl: { type: 'string', description: '正文中的原始图片引用。' },
              width: { type: 'number' }, height: { type: 'number' }, watermark: { type: 'boolean' }, mediaId: { type: 'string' },
            }, additionalProperties: false,
          } },
          linkCard: { type: 'object', description: '想法的独立链接卡片，与图片互斥。', properties: {
            url: { type: 'string', required: true }, title: { type: 'string' }, cover: { type: 'string' },
          }, additionalProperties: false },
          settings: { type: 'object', properties: {
            commentPermission: { type: 'string', enum: ['all', 'nobody', 'followee', 'censor', 'follower', 'follower_n_days'] },
            creationStatement: { type: 'string', enum: ['spoiler', 'medical_advice', 'fictional_creation', 'contain_finance', 'ai_creation'] },
            tableOfContentsEnabled: { type: 'boolean' },
            topics: { type: 'array', items: { type: 'string' }, description: '用户提供的知乎话题链接，文章最多3个，提问最多5个。' },
            ring: { type: 'string', description: '想法的知乎圈子链接。' },
          }, additionalProperties: false },
        },
        additionalProperties: false,
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true, properties: {} },
      render(_args, value) { return [{ type: 'text' as const, text: JSON.stringify(value) }] },
    },
    isConcurrencySafe(args) { return args.action === 'list' || args.action === 'get' },
    async execute(args, exec) {
      if (!service.syncCall) throw new Error('知乎同步服务未启用。')
      if (args.action === 'upload_image') {
        return await service.syncCall('sync.media.upload', args.image, exec.signal, 'tool') as Record<string, ZhihuJsonValue>
      }
      const result = await service.syncCall(`sync.${args.action}`, {
        ...(args.offset === undefined ? {} : { offset: args.offset }),
        ...(args.id === undefined ? {} : { id: args.id }),
        ...(args.expectedRevision === undefined ? {} : { expectedRevision: args.expectedRevision }),
        ...(args.draft === undefined ? {} : { draft: args.draft }),
      }, exec.signal, 'tool')
      return result as Record<string, ZhihuJsonValue>
    },
  })
}
