export const uiZh = {
  copy: '复制', copied: '已复制', footnotes: '脚注', code: '代码', wrap: '自动换行', unwrap: '不换行',
  prepared: '卡片将在最终回复中显示', preparing: '正在准备视图…', error: '视图未能显示', invalid: '视图数据无效',
  local: '仅本地预览；此卡片不会发送回答。', answerFailed: '回答未能发送，请重试。',
  chart: '图表', chartOptions: '图表选项', viewAsChart: '查看图表', viewAsTable: '查看表格', copyData: '复制数据',
  chartNumber: '图表 {n}', value: '值', series: '系列', view: '视图', sources: '来源', progress: '进度', yourAnswer: '你的回答',
  options: '选项', submit: '提交', cancel: '取消', confirm: '确认', send: '发送', selected: '已选择',
  sending: '正在发送…', filling: '正在填入输入框…', filled: '已填入输入框，请检查后发送', fillFailed: '未能填入输入框，请检查当前草稿状态',
  fillDraft: '填入输入框', waitingDock: '请在输入框上方的卡片中回答。', expired: '这张卡片已过期，请让模型重新生成。', dismissFailed: '关闭失败，请重试。', dismissView: '关闭视图', draftConflict: '输入框已有草稿，请选择填入方式', replaceDraft: '替换草稿', appendDraft: '保留并追加',
  steps: '步骤',
}

export const uiEn: Record<keyof typeof uiZh, string> = {
  copy: 'Copy', copied: 'Copied', footnotes: 'Footnotes', code: 'Code', wrap: 'Wrap lines', unwrap: 'Do not wrap lines',
  prepared: 'The card will appear in the final reply', preparing: 'Preparing view…', error: 'The view could not be shown', invalid: 'Invalid view data',
  local: 'Local preview only; this card does not send an answer.', answerFailed: 'The answer could not be sent; try again.',
  chart: 'Chart', chartOptions: 'Chart options', viewAsChart: 'View as chart', viewAsTable: 'View as table', copyData: 'Copy data',
  chartNumber: 'Chart {n}', value: 'Value', series: 'Series', view: 'View', sources: 'Sources', progress: 'Progress', yourAnswer: 'Your answer',
  options: 'Options', submit: 'Submit', cancel: 'Cancel', confirm: 'Confirm', send: 'Send', selected: 'Selected',
  sending: 'Sending…', filling: 'Filling the composer…', filled: 'Added to the composer. Review and send when ready.', fillFailed: 'Could not fill the composer. Check its current draft state.',
  fillDraft: 'Fill composer', waitingDock: 'Answer in the card above the composer.', expired: 'This card has expired. Ask the model for a new one.', dismissFailed: 'Could not dismiss the view; try again.', dismissView: 'Dismiss view', draftConflict: 'The composer already has a draft. Choose how to add this answer', replaceDraft: 'Replace draft', appendDraft: 'Keep and append',
  steps: 'Steps',
}
