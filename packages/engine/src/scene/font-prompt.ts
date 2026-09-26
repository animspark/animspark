/**
 * Search text for the font library. Hard filtering is by locale + role; the prompt is plain English.
 *
 * A Chinese family name is replaced by its English alias, tags are reduced to English words, and
 * only the Latin words of the vibe are kept.
 */

/** Letters from non-Latin scripts (Cyrillic, Arabic, kana, CJK, Hangul). */
const NON_ENGLISH_SCRIPT = /[\u0400-\u04ff\u0600-\u06ff\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af]/;

/** True when the text contains no non-Latin script. An empty string counts as ignorable, not dirty. */
function isPureEnglish(text: string): boolean {
  return !NON_ENGLISH_SCRIPT.test(text);
}

type FontRole = 'display' | 'body' | 'mono' | 'accent';
type FontLocale = 'latin' | 'zh-CN' | 'ja-JP' | 'ko-KR';

export interface FontPromptSource {
  family: string;
  aliases?: string[];
  role: FontRole;
  locale: FontLocale;
  tags: string[];
  vibe: string;
  prompt?: string;
}

/** Chinese tag → English word, so a tag written in Chinese still reaches the English prompt. */
const TAG_EN: Record<string, string> = {
  衬线: 'serif', 无衬线: 'sans-serif', 展示: 'display', 标题: 'headline',
  杂志: 'magazine', 优雅: 'elegant', 时尚: 'fashion', 海报: 'poster',
  复古: 'vintage', 冲击: 'punchy', 古典: 'classical', 文艺: 'literary',
  新锐: 'contemporary', 温暖: 'warm', 正文: 'body', 书卷: 'bookish',
  学术: 'academic', 历史: 'historical', 现代: 'modern', 品牌: 'brand',
  圆润: 'rounded', 科技: 'tech', 几何: 'geometric', 界面: 'interface',
  通用: 'general', 新闻: 'news', 个性: 'distinctive', 艺术: 'art',
  前卫: 'avant-garde', 未来: 'futuristic', 易读: 'readable', 教育: 'education',
  条幅: 'banner', 街头: 'street', 招牌: 'signage', 霓虹: 'neon',
  科幻: 'sci-fi', 赛博: 'cyber', 电竞: 'esports', 太空: 'space',
  工业: 'industrial', 机甲: 'mecha', 运动: 'sport', HUD: 'HUD',
  像素: 'pixel', 游戏: 'game', 终端: 'terminal', 等宽: 'monospace',
  打字机: 'typewriter', 档案: 'archival', 剧本: 'screenplay', 手写: 'handwritten',
  批注: 'annotation', 轻松: 'casual', 休闲: 'leisure', 花体: 'script',
  浪漫: 'romantic', 白板: 'whiteboard', 讲解: 'explainer', 涂鸦: 'graffiti',
  标语: 'slogan', 便签: 'note', 细腻: 'delicate', 钢笔: 'fountain-pen',
  信件: 'letter', 粉笔: 'chalk', 代码: 'code', 工程: 'engineering',
  数据: 'data', 连字: 'ligature', 简洁: 'clean', 速度: 'speed',
  书籍: 'book', 文学: 'literature', 阅读: 'reading', 电子书: 'ebook',
  报道: 'reportage', 编辑: 'editorial', 人文: 'humanist', 教科书: 'textbook',
  网页: 'web', 政务: 'government', 中性: 'neutral', 亲和: 'friendly',
  文档: 'documentation', 技术: 'technical', 圆角: 'rounded', 怪诞: 'grotesque',
  独立: 'indie', 极简: 'minimal', 多语: 'multilingual', 图表: 'chart',
  时装: 'fashion', 碑刻: 'inscription', 史诗: 'epic', 典雅: 'refined',
  纤细: 'thin', 高定: 'haute-couture', 高对比: 'high-contrast', 西部: 'western',
  奇幻: 'fantasy', 装饰: 'decorative', 促销: 'promo', 卡通: 'cartoon',
  儿童: 'children', 娱乐: 'entertainment', 搞笑: 'comic', 潮玩: 'designer-toy',
  热闹: 'festive', 胖体: 'chubby', 童趣: 'playful', 赛事: 'sports',
  斜体: 'italic', 航天: 'aerospace', 仪表: 'dashboard', 军事: 'military',
  战术: 'tactical', 概念: 'concept', 宽字距: 'wide-tracking', 标注: 'label',
  编号: 'numbering', 极客: 'geek', 手绘: 'hand-drawn', 菜单: 'menu',
  图注: 'caption', 报表: 'report', 清爽: 'crisp', 温和: 'gentle',
  装饰艺术: 'art-deco', 图纸: 'blueprint', 笔记: 'notes', 清秀: 'neat',
  细高: 'tall', 随性: 'casual', 细长: 'slender', 毛刷: 'brush',
  强调: 'emphasis', 请柬: 'invitation', 法式: 'french', 签名: 'signature',
  笔刷: 'brush', 手作: 'handmade', 日记: 'diary', 点阵: 'bitmap',
  立体: 'dimensional', 恐怖: 'horror', 万圣: 'halloween', 哥特: 'gothic',
  中世纪: 'medieval', 古籍: 'antique', 黑体: 'gothic', 楷体: 'kai',
  毛笔: 'brush', 国风: 'chinese-traditional', 题字: 'inscription',
  活泼: 'lively', 细瘦: 'thin', 行书: 'running-script', 草书: 'cursive',
  狂放: 'wild', 硬笔: 'pen', 综艺: 'variety-show', 潮流: 'trendy',
  明朝体: 'mincho', 印刷: 'print', 老报刊: 'old-newspaper', 民国: 'republican-era',
  治愈: 'healing', 圆体: 'rounded', 萌系: 'cute', 中英混排: 'cjk-latin',
  表格: 'table', 仿宋: 'fangsong', 公文: 'official-document', 引文: 'quotation',
  清隽: 'refined', POP: 'pop', 马克笔: 'marker', 花字: 'display-lettering',
  繁体: 'traditional-chinese', 屏显: 'screen', 明体: 'mincho', 和风: 'japanese',
  无障碍: 'accessible', 教材: 'textbook', 招贴: 'poster', 食品: 'food',
  亲子: 'family', 少女: 'girly', 手账: 'journal', 黑板: 'chalkboard',
  明朝: 'mincho', 宋体: 'song',
};

const LOCALE_EN: Record<FontLocale, string> = {
  latin: 'latin',
  'zh-CN': 'chinese',
  'ja-JP': 'japanese',
  'ko-KR': 'korean',
};

const ROLE_EN: Record<FontRole, string> = {
  display: 'display headline',
  body: 'body text',
  mono: 'monospace',
  accent: 'accent lettering',
};

function englishName(spec: Pick<FontPromptSource, 'family' | 'aliases'>): string {
  if (isPureEnglish(spec.family) && /[A-Za-z]/.test(spec.family)) return spec.family;
  const alias = (spec.aliases ?? []).find((name) => isPureEnglish(name) && /[A-Za-z]/.test(name));
  return alias ?? spec.family;
}

function latinTokens(text: string): string[] {
  return text.match(/[A-Za-z][A-Za-z0-9+-]*/g) ?? [];
}

export function composeFontPrompt(spec: FontPromptSource): string {
  if (spec.prompt && isPureEnglish(spec.prompt)) return spec.prompt.replace(/\s+/g, ' ').trim();
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (token: string | undefined): void => {
    const text = token?.replace(/\s+/g, ' ').trim();
    if (!text || !isPureEnglish(text)) return;
    const key = text.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(text);
  };
  push(englishName(spec));
  push(ROLE_EN[spec.role]);
  push(LOCALE_EN[spec.locale]);
  for (const tag of spec.tags) push(TAG_EN[tag] ?? (isPureEnglish(tag) ? tag : undefined));
  for (const token of latinTokens(spec.vibe)) push(token);
  return out.join(', ');
}
