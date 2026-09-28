/**
 * 姓名判断（前端显示逻辑，不是真正的安全认证！）
 *
 * - 姓名在 visitors.json 名单里 -> full，能看到具体活动名称
 * - 其他任何人            -> guest，只能看到「忙碌 / 空闲」
 */

export type AccessLevel = 'full' | 'guest';

export interface Visitor {
  name: string;
  level: 'full' | 'guest';
}

/** 规范化姓名：去空格 + 转小写，方便匹配 */
function normalize(name: string): string {
  return name.trim().toLowerCase();
}

/** 根据输入的姓名返回权限级别 */
export function resolveLevel(input: string, visitors: Visitor[]): AccessLevel {
  const key = normalize(input);
  if (!key) return 'guest';

  const found = visitors.find((v) => normalize(v.name) === key);
  if (!found) return 'guest';

  return found.level === 'full' ? 'full' : 'guest';
}

/** 是否是已授权访客 */
export function isAuthorized(input: string, visitors: Visitor[]): boolean {
  return resolveLevel(input, visitors) === 'full';
}
