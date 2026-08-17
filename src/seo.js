'use strict';

/**
 * Lightweight, dependency-free SEO analysis + auto-fill helpers.
 * Produces a 0-100 score, a checklist, and suggested meta fields.
 * This is the "SEO optimization" engine that runs before a post is
 * scheduled or published.
 */

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 75);
}

// Strip markdown/html to plain words for counting.
function toPlainText(content) {
  return String(content || '')
    .replace(/```[\s\S]*?```/g, ' ')      // code fences
    .replace(/<[^>]+>/g, ' ')             // html tags
    .replace(/[#>*_`~\-]+/g, ' ')         // md markup
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links -> text
    .replace(/\s+/g, ' ')
    .trim();
}

function wordCount(content) {
  const t = toPlainText(content);
  return t ? t.split(' ').length : 0;
}

function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  const re = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  const m = String(haystack || '').match(re);
  return m ? m.length : 0;
}

/**
 * Analyze a post object -> { score, checks[], density }
 * checks: [{ id, label, ok, weight, hint }]
 */
function analyze(post) {
  const kw = (post.focus_keyword || '').trim();
  const title = post.title || '';
  const metaDesc = post.meta_description || '';
  const body = post.content || '';
  const words = wordCount(body);
  const kwInBody = countOccurrences(toPlainText(body), kw);
  const density = words > 0 && kw ? (kwInBody / words) * 100 : 0;

  const headingMatches = (body.match(/^#{1,6}\s+/gm) || []).length +
    (body.match(/<h[1-6][^>]*>/gi) || []).length;
  const linkMatches = (body.match(/\[[^\]]+\]\([^)]+\)/g) || []).length +
    (body.match(/<a\s+[^>]*href/gi) || []).length;
  const imgMatches = (body.match(/!\[[^\]]*\]\([^)]+\)/g) || []).length +
    (body.match(/<img\s/gi) || []).length +
    (post.featured_image_url ? 1 : 0);

  const checks = [
    {
      id: 'focus_keyword',
      label: 'Focus keyword is set',
      ok: kw.length > 0,
      weight: 10,
      hint: 'Add a focus keyword so the page targets a search query.',
    },
    {
      id: 'title_length',
      label: 'Title length 30–60 chars',
      ok: title.length >= 30 && title.length <= 60,
      weight: 12,
      hint: `Title is ${title.length} chars. Aim for 30–60 so it does not truncate in SERPs.`,
    },
    {
      id: 'kw_in_title',
      label: 'Focus keyword in title',
      ok: kw ? countOccurrences(title, kw) > 0 : false,
      weight: 12,
      hint: 'Include the focus keyword in the title, ideally near the start.',
    },
    {
      id: 'meta_desc',
      label: 'Meta description 120–160 chars',
      ok: metaDesc.length >= 120 && metaDesc.length <= 160,
      weight: 12,
      hint: `Meta description is ${metaDesc.length} chars. Aim for 120–160.`,
    },
    {
      id: 'kw_in_meta',
      label: 'Focus keyword in meta description',
      ok: kw ? countOccurrences(metaDesc, kw) > 0 : false,
      weight: 8,
      hint: 'Mention the focus keyword in the meta description.',
    },
    {
      id: 'slug',
      label: 'Clean, keyword-rich slug',
      ok: !!post.slug && (kw ? post.slug.includes(slugify(kw).split('-')[0]) : post.slug.length > 0),
      weight: 8,
      hint: 'Use a short slug that contains the focus keyword.',
    },
    {
      id: 'word_count',
      label: 'Body has ≥ 300 words',
      ok: words >= 300,
      weight: 12,
      hint: `Body has ${words} words. Long-form (600+) usually ranks better; 300 is the minimum.`,
    },
    {
      id: 'kw_density',
      label: 'Keyword density 0.5–2.5%',
      ok: density >= 0.5 && density <= 2.5,
      weight: 8,
      hint: `Density is ${density.toFixed(2)}%. Keep it natural (0.5–2.5%).`,
    },
    {
      id: 'headings',
      label: 'Uses subheadings (H2/H3)',
      ok: headingMatches >= 1,
      weight: 6,
      hint: 'Break content into sections with subheadings.',
    },
    {
      id: 'internal_links',
      label: 'Has at least one link',
      ok: linkMatches >= 1,
      weight: 6,
      hint: 'Add internal/external links for context and crawlability.',
    },
    {
      id: 'image',
      label: 'Has at least one image',
      ok: imgMatches >= 1,
      weight: 6,
      hint: 'Add an image (with alt text) to improve engagement.',
    },
  ];

  const totalWeight = checks.reduce((s, c) => s + c.weight, 0);
  const gained = checks.filter((c) => c.ok).reduce((s, c) => s + c.weight, 0);
  const score = Math.round((gained / totalWeight) * 100);

  return {
    score,
    density: Number(density.toFixed(2)),
    words,
    checks,
  };
}

/**
 * Auto-fill missing SEO fields (non-destructive: only fills blanks).
 * Returns a patch object of suggested fields.
 */
function autofill(post) {
  const patch = {};
  const kw = (post.focus_keyword || '').trim();

  if (!post.slug) patch.slug = slugify(kw || post.title);

  if (!post.meta_title) {
    let mt = post.title || (kw ? kw : 'Untitled');
    patch.meta_title = mt.slice(0, 60);
  }

  if (!post.meta_description) {
    const plain = toPlainText(post.content);
    let desc = plain.slice(0, 157);
    if (kw && !desc.toLowerCase().includes(kw.toLowerCase())) {
      desc = `${kw}: ${desc}`.slice(0, 157);
    }
    if (plain.length > 157) desc = desc.replace(/\s+\S*$/, '') + '…';
    patch.meta_description = desc;
  }

  return patch;
}

/**
 * Build JSON-LD Article schema for the published page.
 */
function articleSchema(post, project) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.meta_title || post.title,
    description: post.meta_description,
    keywords: post.focus_keyword,
    author: { '@type': 'Organization', name: project ? project.name : 'Author' },
    datePublished: post.published_at || new Date().toISOString(),
  };
}

module.exports = { slugify, wordCount, analyze, autofill, articleSchema, toPlainText };
