/**
 * verify-deployment 的报错文案构造器。
 *
 * 抽成独立模块的唯一理由：这里出过一次真事故。原实现把「缺失清单」与
 * 「不合规清单」共用 `listed()`，而 `listed()` 对多元素只打「N: 列表」，
 * 不说明这份列表到底是什么。2026-11-09 生产迁移 job 就因此把「17 张表
 * 全都不合规」渲染成 `FAIL RLS enabled: 17: organization, ...`，读起来
 * 像「17 张表全都不存在」，排查时先怀疑数据库坏了，实际库完好。
 *
 * 三类结论各说各的意思：
 * - `describeMissing`：什么都没找到 → 缺 N 个，逐个列出。
 * - `describeWrong`：找到了但全都不合规 → 全部 N 个都不合规；部分不合规
 *   则说清 N / M，别让读者以为「剩下的也没了」。
 *
 * `noun` 传完整名词短语（含复数形式），调用方负责数词后的语法：
 * 传 `'table'` / `'tables'` 由其自行决定，本模块不猜 `-s` 后缀。
 */

export function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

/** 缺失类：调用方保证 `missing` 非空。 */
export function describeMissing(missing, noun, render = String) {
  return `missing ${plural(missing.length, noun[0], noun[1])}: ${missing
    .map(render)
    .join(', ')}`;
}

/**
 * 不合规类。`total` 是应检查的总量，`wrong` 是不合规清单（调用方保证非空）。
 * 全都不合规时必须明说「all」，否则与「缺失」无法区分。
 */
export function describeWrong(wrong, total, noun, render = String) {
  const detail = wrong.map(render).join(', ');
  const [one, many] = noun;
  if (wrong.length === total) {
    return `all ${plural(total, one, many)}: ${detail}`;
  }
  return `${wrong.length} of ${plural(total, one, many)}: ${detail}`;
}
