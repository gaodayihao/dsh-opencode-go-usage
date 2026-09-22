/**
 * dsh-ocgo-usage locale dictionaries (zh/en).
 * @module dsh-ocgo-usage/client/locales
 */
/** Dictionary namespace this package registers. */
export const NS = 'ocgo';
/** Chinese copy. */
export const zh = {
    'ocgo.unavailable': '用量不可用',
    'ocgo.error': '查询失败：{code}',
    'ocgo.noconfig': '未配置：请设置 OPENCODE_GO_COOKIE（控制台会话 cookie，含 __Host-console_session）与 OPENCODE_GO_WORKSPACE_ID（或 $DSH_HOME/ocgo-usage.json）',
    'ocgo.refresh': '刷新',
    'ocgo.fetchedAt': 'upd {time}',
    'ocgo.rolling': '5h 滚动',
    'ocgo.weekly': '每周',
    'ocgo.monthly': '每月',
    'ocgo.rateLimited': '已限流',
    'ocgo.resetsIn': '剩余 {duration}',
    'ocgo.expand': '展开用量详情',
    'ocgo.collapse': '收起',
    'ocgo.sep': '·',
    'ocgo.set': '设置',
    'ocgo.save': '保存',
    'ocgo.workspaceID': 'workspace id',
    'ocgo.cookie': 'cookie',
    'ocgo.setHint': '从 opencode.ai 控制台复制整条 cookie（需含 __Host-console_session）；点击外部或按 Esc 保存',
};
/** English copy. */
export const en = {
    'ocgo.unavailable': 'usage unavailable',
    'ocgo.error': 'Query failed: {code}',
    'ocgo.noconfig': 'Not configured: set OPENCODE_GO_COOKIE (the console session cookie, including __Host-console_session) and OPENCODE_GO_WORKSPACE_ID (or $DSH_HOME/ocgo-usage.json)',
    'ocgo.refresh': 'Refresh',
    'ocgo.fetchedAt': 'upd {time}',
    'ocgo.rolling': '5h Rolling',
    'ocgo.weekly': 'Weekly',
    'ocgo.monthly': 'Monthly',
    'ocgo.rateLimited': 'rate-limited',
    'ocgo.resetsIn': 'resets in {duration}',
    'ocgo.expand': 'Show usage details',
    'ocgo.collapse': 'Collapse',
    'ocgo.sep': '·',
    'ocgo.set': 'Set',
    'ocgo.save': 'Save',
    'ocgo.workspaceID': 'workspace id',
    'ocgo.cookie': 'cookie',
    'ocgo.setHint': 'paste the whole opencode.ai console cookie (must include __Host-console_session); click outside or press Esc to save',
};
