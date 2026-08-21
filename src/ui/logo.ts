// 品牌标识「A / 文」的字形定义 —— 唯一真相。
//
// 拉丁字母 A 在上、汉字「文」在下，对应产品的「原文在上、译文在下」。
// A 用纸感米白、文用黄铜金，两种颜色都取自 src/styles/tokens.css：
// 颜色本身就区分了原文与译文，因此不需要额外的分隔线。
//
// 字形是几何笔画路径而非 <text> —— 图标一旦依赖系统字体，
// 换台机器渲染出来的 PNG 就会走形，而这四个 PNG 是要上架的。
//
// 消费方：
//   - popup 头部标识与悬浮球（本文件的 logoMark）
//   - design/icon/generate.ts（套上底色后渲染成 public/icon/*.png）

/** 一套字形的几何参数。大图与小图各一套：小尺寸要更粗、更满才不糊。 */
interface Metrics {
  a: { sw: number; top: number; bot: number; half: number };
  wen: {
    sw: number;
    dotY: number;
    barY: number;
    footY: number;
    halfBar: number;
    halfFoot: number;
  };
}

/** 48px 以上用。笔画细，结构舒展。 */
const REGULAR: Metrics = {
  a: { sw: 9, top: 20, bot: 52, half: 15 },
  wen: { sw: 8, dotY: 66, barY: 80, footY: 111, halfBar: 17, halfFoot: 19 },
};

/**
 * 32px 用。字形放大、笔画只略加粗 —— 加粗过头时「文」的撇捺会在交叉处
 * 粘成一个实心块，反而认不出字，所以这里靠张开角度而不是笔画重量取清晰度。
 */
const COMPACT: Metrics = {
  a: { sw: 12, top: 16, bot: 50, half: 17 },
  wen: { sw: 10, dotY: 62, barY: 78, footY: 116, halfBar: 21, halfFoot: 25 },
};

/**
 * 16px 用的简化形态：只画「A」加一条黄铜金横条。
 *
 * 16 像素的画布画不下四笔的「文」—— 撇捺无论怎么调都会糊成一团。
 * 这里退到「上原文、下译文」的双层结构本身：字母仍在，下面那条横条
 * 就是被翻译出来的那一行。不同尺寸给不同细节层级是图标设计的常规做法。
 */
const MICRO = {
  // 画得瘦高一点：A 的内部空间越大，中间那道横笔在 16px 下越不会和斜边糊在一起
  a: { sw: 14, top: 15, bot: 63, half: 20 },
  bar: { y: 93, half: 29, sw: 14 },
};

/** 所有坐标都基于这个 viewBox，缩放交给 width/height。 */
export const LOGO_VIEWBOX = 128;

const CX = LOGO_VIEWBOX / 2;

/** 「A」：两条斜笔一笔画完（转角处 linejoin 收圆），横笔单独一笔。 */
function pathsA({ sw, top, bot, half }: Metrics['a'], color: string): string {
  // 横笔落在 A 高度的 66% 处，宽度随之收窄，贴合两条斜笔的开口
  const k = 0.66;
  const barY = top + (bot - top) * k;
  const barHalf = half * k * 0.9;
  return (
    `<path d="M${CX - half} ${bot} L${CX} ${top} L${CX + half} ${bot}" fill="none" ` +
    `stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="M${CX - barHalf} ${barY} H${CX + barHalf}" fill="none" ` +
    `stroke="${color}" stroke-width="${sw}" stroke-linecap="round"/>`
  );
}

/** 「文」：点、横、撇、捺四笔。撇捺自横下方分开起笔，中部交叉，末端外张。 */
function pathsWen(
  { sw, dotY, barY, footY, halfBar, halfFoot }: Metrics['wen'],
  color: string,
): string {
  const startY = barY + 7;
  const stroke = `stroke="${color}" stroke-width="${sw}" stroke-linecap="round"`;
  return (
    `<path d="M${CX + 3} ${dotY} L${CX - 1} ${dotY + 8}" fill="none" ${stroke}/>` +
    `<path d="M${CX - halfBar} ${barY} H${CX + halfBar}" fill="none" ${stroke}/>` +
    `<path d="M${CX + halfFoot * 0.62} ${startY} L${CX - halfFoot} ${footY}" fill="none" ${stroke}/>` +
    `<path d="M${CX - halfFoot * 0.5} ${startY} L${CX + halfFoot} ${footY}" fill="none" ${stroke}/>`
  );
}

/** 16px 简化形态的笔画。 */
function pathsMicro(origin: string, translation: string): string {
  const { a, bar } = MICRO;
  return (
    `<path d="M${CX - a.half} ${a.bot} L${CX} ${a.top} L${CX + a.half} ${a.bot}" fill="none" ` +
    `stroke="${origin}" stroke-width="${a.sw}" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="M${CX - a.half * 0.6} ${a.top + (a.bot - a.top) * 0.66} H${CX + a.half * 0.6}" ` +
    `fill="none" stroke="${origin}" stroke-width="${a.sw}" stroke-linecap="round"/>` +
    `<path d="M${CX - bar.half} ${bar.y} H${CX + bar.half}" fill="none" ` +
    `stroke="${translation}" stroke-width="${bar.sw}" stroke-linecap="round"/>`
  );
}

export interface LogoMarkOptions {
  /** 「A」的颜色。默认取纸感米白。 */
  origin?: string;
  /** 「文」的颜色。默认取黄铜金。 */
  translation?: string;
  /** 32px 的场合传 true，换用更粗的字形。 */
  compact?: boolean;
  /** 16px 的场合传 true，换用只有 A 与横条的简化形态。 */
  micro?: boolean;
}

/**
 * 纯字形，不含底色 —— 调用方自己提供背景（popup 的圆角方块、悬浮球的圆）。
 * 返回的是 viewBox 内的 path 集合，需要自己包 <svg>；用 logoMarkSvg 拿完整元素。
 */
export function logoMarkPaths(opts: LogoMarkOptions = {}): string {
  const {
    origin = '#f5f0e6',
    translation = '#b89968',
    compact = false,
    micro = false,
  } = opts;
  if (micro) return pathsMicro(origin, translation);
  const m = compact ? COMPACT : REGULAR;
  return pathsA(m.a, origin) + pathsWen(m.wen, translation);
}

/** 完整的 <svg> 元素，宽高由调用方给定。 */
export function logoMarkSvg(size: number, opts: LogoMarkOptions = {}): string {
  return (
    `<svg width="${size}" height="${size}" viewBox="0 0 ${LOGO_VIEWBOX} ${LOGO_VIEWBOX}" ` +
    `xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">` +
    logoMarkPaths(opts) +
    `</svg>`
  );
}

/** 扩展图标用的完整图形：森林绿圆角底 + 字形。圆角比例随尺寸微调。 */
export function logoIconSvg(size: number, opts: LogoMarkOptions = {}): string {
  // 细节层级随尺寸下降：128/48 完整字形，32 加粗版，16 简化形态
  const micro = opts.micro ?? size <= 16;
  const compact = opts.compact ?? (size <= 32 && !micro);
  // 小尺寸的圆角按比例缩得更保守，否则 16px 下方块看起来接近圆形
  const radius = micro || compact ? 26 : 29;
  return (
    `<svg width="${size}" height="${size}" viewBox="0 0 ${LOGO_VIEWBOX} ${LOGO_VIEWBOX}" ` +
    `xmlns="http://www.w3.org/2000/svg">` +
    `<rect width="${LOGO_VIEWBOX}" height="${LOGO_VIEWBOX}" rx="${radius}" fill="#1f3a2e"/>` +
    logoMarkPaths({ ...opts, compact, micro }) +
    `</svg>`
  );
}
