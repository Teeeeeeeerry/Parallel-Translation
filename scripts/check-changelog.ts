/**
 * 上架前校验：package.json 的版本号必须在 changelog 数据里有对应条目。
 *
 * ADR-0002 把「哪些版本值得弹更新提示」绑定到「你写没写更新说明」。
 * 代价是两者版本号字面不等时静默不弹，且没有任何报错 —— 等上架后才
 * 发现来不及了，所以这个校验是必需项而非可选项。
 *
 * 挂在 `pnpm zip`(打包上架)而非 `pnpm build`(日常开发构建):日常构建
 * 时当前版本本就是没有条目的内部版本，无条件失败会让 build 永远红灯。
 */

import { readFileSync } from 'node:fs';
import { CHANGELOG, findEntry } from '../src/changelog/data';

const pkgUrl = new URL('../package.json', import.meta.url);
const pkg = JSON.parse(readFileSync(pkgUrl, 'utf-8')) as { version: string };
const { version } = pkg;

if (!findEntry(version)) {
  const known = CHANGELOG.map((e) => e.version).join(', ') || '(空)';
  console.error(
    `\n[check-changelog] 上架校验失败\n\n` +
      `  package.json 版本：  ${version}\n` +
      `  changelog 已有条目： ${known}\n\n` +
      `  这个版本没有更新说明，装到用户机器上不会弹出更新提示。\n` +
      `  上架前请在 src/changelog/data.ts 的 CHANGELOG 顶部加一条\n` +
      `  version 为 "${version}" 的条目(三语文案齐备),或把 package.json\n` +
      `  的版本号改成你真正要上架的那个。\n`,
  );
  process.exit(1);
}

console.log(`[check-changelog] 通过 —— ${version} 有对应的更新说明`);
