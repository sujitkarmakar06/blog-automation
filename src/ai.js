'use strict';

const { slugify } = require('./seo');
const cfg = require('./config');

/**
 * Content generation.
 *  - If ANTHROPIC_API_KEY is set → calls Claude (Messages API) and asks for a
 *    structured JSON draft.
 *  - Otherwise → falls back to an offline template so the app always works.
 *
 * Return shape (both paths):
 *   { title, meta_title, meta_description, focus_keyword, slug, content, source }
 */

async function generate({ topic, keyword, brandVoice, projectName, targetKeywords }) {
  if (cfg.anthropicApiKey) {
    try {
      return await generateWithClaude({ topic, keyword, brandVoice, projectName, targetKeywords });
    } catch (e) {
      // Never hard-fail generation — degrade to template and surface the reason.
      const draft = templateDraft({ topic, keyword, brandVoice, projectName });
      draft.source = `template (Claude error: ${e.message})`;
      return draft;
    }
  }
  const draft = templateDraft({ topic, keyword, brandVoice, projectName });
  draft.source = 'template (no ANTHROPIC_API_KEY)';
  return draft;
}

async function generateWithClaude({ topic, keyword, brandVoice, projectName, targetKeywords }) {
  const kw = (keyword || topic || '').trim();
  const system = [
    'You are an expert SEO content writer.',
    'Write an original, genuinely useful blog post in Markdown.',
    'Return ONLY a single valid JSON object, no prose, no code fences.',
  ].join(' ');

  const user = `Write a blog post.
Topic / working title: ${topic || kw}
Primary focus keyword: ${kw}
${targetKeywords ? `Related keywords to weave in naturally: ${targetKeywords}` : ''}
${brandVoice ? `Brand voice / tone: ${brandVoice}` : ''}
${projectName ? `Publisher / brand: ${projectName}` : ''}

Requirements:
- 700-1000 words, Markdown with an H1 title and several H2 sections.
- Use the focus keyword in the H1, first paragraph, and 2-3 H2s naturally (density ~0.5-2%).
- Include at least one bulleted list and one internal-link style markdown link.
- Provide an SEO meta title (<= 60 chars) and meta description (120-160 chars) containing the keyword.

Return JSON with exactly these keys:
{
  "title": "...",
  "meta_title": "...",
  "meta_description": "...",
  "focus_keyword": "...",
  "slug": "kebab-case-slug",
  "content": "full markdown body"
}`;

  const res = await fetch(`${cfg.anthropicBaseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': cfg.anthropicApiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: cfg.anthropicModel,
      max_tokens: 3000,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    const msg = data && data.error ? data.error.message : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  const text = (data.content || []).map((b) => b.text || '').join('').trim();
  const draft = parseJsonLoose(text);
  // Fill any gaps defensively.
  draft.focus_keyword = draft.focus_keyword || kw;
  draft.title = (draft.title || topic || kw || 'Untitled').trim();
  draft.meta_title = (draft.meta_title || draft.title).slice(0, 60);
  draft.slug = draft.slug || slugify(draft.focus_keyword || draft.title);
  draft.meta_description = (draft.meta_description || '').slice(0, 160);
  draft.content = draft.content || '';
  draft.source = `claude:${cfg.anthropicModel}`;
  return draft;
}

// Claude sometimes wraps JSON in prose/fences; extract the object robustly.
function parseJsonLoose(text) {
  try { return JSON.parse(text); } catch { /* continue */ }
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) { try { return JSON.parse(fence[1]); } catch { /* continue */ } }
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last > first) {
    try { return JSON.parse(text.slice(first, last + 1)); } catch { /* continue */ }
  }
  throw new Error('Could not parse model JSON output');
}

// ---------- offline fallback ----------
function templateDraft({ topic, keyword, brandVoice, projectName }) {
  const kw = (keyword || topic || '').trim();
  const title = topic ? topic.replace(/\b\w/g, (c) => c.toUpperCase()) : `A Practical Guide to ${kw}`;
  const voice = brandVoice ? ` Written in a ${brandVoice} tone.` : '';
  const content = `# ${title}

${kw ? `**${kw}**` : 'This guide'} is something teams ask about constantly, yet clear, actionable answers are hard to find. This post breaks it down end to end.${voice}

## Why ${kw || 'this'} matters

Getting ${kw || 'this'} right saves time and avoids costly rework. Below are the fundamentals, a step-by-step approach, and common pitfalls.

## Key things to know

- Start with a clear goal before touching any tools.
- Measure what matters — vanity metrics hide real progress.
- Iterate in small, reversible steps.

## Step-by-step approach

1. Define the outcome you want.
2. Map the shortest path to a first result.
3. Ship, measure, and refine.

## Common mistakes to avoid

Many teams over-engineer early and under-measure late. Keep the first version small, then expand once you have signal.

## Conclusion

${kw ? `Mastering ${kw}` : 'Getting this right'} is less about tools and more about disciplined iteration. Start small today${projectName ? `, and tailor it to ${projectName}` : ''}. See our [related guides](/) for more.`;

  const meta_description = (`${kw ? kw + ': ' : ''}a practical, step-by-step guide covering why it matters, how to do it, and the mistakes to avoid.`).slice(0, 157);
  return {
    title: title.slice(0, 60),
    meta_title: title.slice(0, 60),
    meta_description,
    focus_keyword: kw,
    slug: slugify(kw || title),
    content,
  };
}

module.exports = { generate, templateDraft };
