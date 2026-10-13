// Loads the SEO guide library: topics from content/topics.mjs and one Markdown file per article.
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOPICS } from '../content/topics.mjs';
import { HUB } from '../content/hub.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const ARTICLE_DIR = resolve(ROOT, 'content/guides');

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RESERVED = new Set(['page', 'feed', 'assets', 'index']);
export const dateIsValid = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(value).toISOString().startsWith(value);
export const esc = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

// Front matter: `key: value`, `key: [a, b]`, or `key:` followed by `  - item` lines.
export function parseFrontMatter(text, file = 'article') {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) throw new Error(`${file}: missing front matter`);
  const data = {};
  let listKey = null;
  for (const raw of match[1].split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const item = raw.match(/^\s+-\s+(.*)$/);
    if (item) {
      if (!listKey) throw new Error(`${file}: list item without a key`);
      data[listKey].push(unquote(item[1]));
      continue;
    }
    const pair = raw.match(/^([A-Za-z][\w-]*):(?:\s+(.*))?$/);
    if (!pair) throw new Error(`${file}: cannot read front matter line "${raw}"`);
    const [, key, value = ''] = pair;
    listKey = null;
    if (!value.trim()) { data[key] = []; listKey = key; }
    else if (/^\[.*\]$/.test(value.trim())) data[key] = value.trim().slice(1, -1).split(',').map(v => unquote(v)).filter(Boolean);
    else data[key] = value.trim() === 'true' ? true : value.trim() === 'false' ? false : unquote(value);
  }
  return { data, body: text.slice(match[0].length) };
}
const unquote = value => value.trim().replace(/^(["'])(.*)\1$/, '$2');

// Inline Markdown: code, bold, links. `link` maps a URL to its final href and attributes.
export function inline(text, link) {
  const codes = [];
  let out = esc(text).replace(/`([^`]+)`/g, (_, code) => `\u0000${codes.push(code) - 1}\u0000`);
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, address) => link(label, address.replace(/&amp;/g, '&')));
  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
}

// Block Markdown: ## / ### headings, paragraphs, lists, pipe tables and > callouts.
export function parseBlocks(markdown) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let i = 0;
  const isTableRow = line => /^\s*\|.*\|\s*$/.test(line);
  const cells = line => line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    let m;
    if ((m = line.match(/^(#{2,3})\s+(.+)$/))) { blocks.push({ type: m[1].length === 2 ? 'h2' : 'h3', text: m[2].trim() }); i++; continue; }
    if (isTableRow(line) && isTableRow(lines[i + 1] || '') && /^[\s|:-]+$/.test(lines[i + 1])) {
      const head = cells(line); const rows = [];
      i += 2;
      while (i < lines.length && isTableRow(lines[i])) rows.push(cells(lines[i++]));
      blocks.push({ type: 'table', head, rows });
      continue;
    }
    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items = [];
      const marker = ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*]\s+/;
      while (i < lines.length && marker.test(lines[i])) items.push(lines[i++].replace(marker, '').trim());
      blocks.push({ type: ordered ? 'ol' : 'ul', items });
      continue;
    }
    if (/^>\s?/.test(line)) {
      const parts = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) parts.push(lines[i++].replace(/^>\s?/, ''));
      blocks.push({ type: 'note', text: parts.join(' ').trim() });
      continue;
    }
    const parts = [];
    while (i < lines.length && lines[i].trim() && !/^(#{2,3}\s|>|\s*[-*]\s|\s*\d+[.)]\s|\s*\|)/.test(lines[i])) parts.push(lines[i++].trim());
    if (!parts.length) throw new Error(`Unreadable Markdown line: ${line}`);
    // Chinese lines join directly; a space is kept only between two Latin words.
    blocks.push({ type: 'p', text: parts.reduce((all, part) => all + (/[A-Za-z0-9,.;:!?)]$/.test(all) && /^[A-Za-z0-9(]/.test(part) ? ' ' : '') + part, '') });
  }
  return blocks;
}

export const FAQ_HEADING = '常见问题';
export const SOURCES_HEADING = '资料来源';

// Splits an article body into numbered sections, a FAQ list and source links.
export function splitArticle(blocks, file) {
  const sections = [];
  const faqs = [];
  const sources = [];
  let mode = null;
  for (const block of blocks) {
    if (block.type === 'h2') {
      mode = block.text === FAQ_HEADING ? 'faq' : block.text === SOURCES_HEADING ? 'sources' : 'body';
      if (mode === 'body') sections.push({ title: block.text, blocks: [] });
      continue;
    }
    if (!mode) throw new Error(`${file}: content must start with a ## heading`);
    if (mode === 'body') sections.at(-1).blocks.push(block);
    else if (mode === 'faq') {
      if (block.type === 'h3') faqs.push({ q: block.text, a: [] });
      else if (faqs.length && block.type === 'p') faqs.at(-1).a.push(block.text);
      else throw new Error(`${file}: FAQ entries are ### questions followed by paragraphs`);
    } else {
      if (block.type !== 'ul') throw new Error(`${file}: sources must be a list of links`);
      for (const item of block.items) {
        const link = item.match(/^\[([^\]]+)\]\((https:\/\/[^)\s]+)\)$/);
        if (!link) throw new Error(`${file}: source "${item}" must be [label](https://…)`);
        sources.push([link[1], link[2]]);
      }
    }
  }
  if (faqs.some(f => !f.a.length)) throw new Error(`${file}: every FAQ question needs an answer`);
  return { sections, faqs, sources };
}

// Chinese reading speed is roughly 400 characters per minute.
const readingMinutes = text => Math.max(1, Math.round(text.replace(/\s+/g, '').length / 400));

export function loadArticles(dir = ARTICLE_DIR) {
  const topicSlugs = new Set(TOPICS.map(t => t.slug));
  const articles = readdirSync(dir).filter(name => name.endsWith('.md')).sort().map(name => {
    const file = `content/guides/${name}`;
    const slug = name.slice(0, -3);
    const { data, body } = parseFrontMatter(readFileSync(resolve(dir, name), 'utf8'), file);
    for (const key of ['title', 'description', 'summary', 'topic', 'updated']) if (!data[key] || typeof data[key] !== 'string') throw new Error(`${file}: "${key}" is required`);
    if (!SLUG.test(slug) || RESERVED.has(slug) || topicSlugs.has(slug)) throw new Error(`${file}: file name must be a unique lowercase slug that is not a topic or reserved word`);
    if (!topicSlugs.has(data.topic)) throw new Error(`${file}: unknown topic "${data.topic}"`);
    const topics = [data.topic, ...(data.topics || [])];
    if (topics.some(t => !topicSlugs.has(t)) || new Set(topics).size !== topics.length) throw new Error(`${file}: invalid extra topics`);
    if (!dateIsValid(data.updated) || (data.published && !dateIsValid(data.published))) throw new Error(`${file}: dates must be YYYY-MM-DD`);
    if (data.published && data.published > data.updated) throw new Error(`${file}: published must not be after updated`);
    const { sections, faqs, sources } = splitArticle(parseBlocks(body), file);
    if (sections.length < 2) throw new Error(`${file}: an article needs at least two ## sections`);
    return Object.freeze({
      slug, file, title: data.title, description: data.description, summary: data.summary,
      topic: data.topic, topics, updated: data.updated, published: data.published || null,
      featured: data.featured === true, related: data.related || [],
      sections, faqs, sources, minutes: readingMinutes(body),
    });
  });
  const slugs = new Set(articles.map(a => a.slug));
  for (const a of articles) {
    if (a.related.some(s => !slugs.has(s) || s === a.slug) || new Set(a.related).size !== a.related.length) throw new Error(`${a.file}: related lists unknown or repeated guides`);
  }
  // Newest first; the title breaks ties so output never depends on file-system order.
  return articles.sort((a, b) => b.updated.localeCompare(a.updated) || a.title.localeCompare(b.title, 'zh-CN'));
}

export function validateLibrary(articles) {
  const slugs = new Set(articles.map(a => a.slug));
  if (new Set(TOPICS.map(t => t.slug)).size !== TOPICS.length) throw new Error('Topic slugs must be unique.');
  for (const t of TOPICS) {
    if (!SLUG.test(t.slug) || RESERVED.has(t.slug)) throw new Error(`Invalid topic slug: ${t.slug}`);
    for (const key of ['name', 'title', 'description', 'intro', 'mark']) if (!t[key]) throw new Error(`Topic ${t.slug} needs ${key}`);
    if (t.source && !/^https:\/\//.test(t.source[1])) throw new Error(`Topic ${t.slug} source must use HTTPS`);
  }
  if (!dateIsValid(HUB.updated)) throw new Error('HUB.updated must be YYYY-MM-DD');
  if (HUB.startHere.some(s => !slugs.has(s))) throw new Error('HUB.startHere lists an unknown guide');
}
