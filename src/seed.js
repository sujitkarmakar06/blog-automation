'use strict';

// Demo data + a demo account so you can log in immediately.
const store = require('./store');
const seo = require('./seo');
const ai = require('./ai');
const { hashPassword } = require('./auth');

(async () => {
  const email = 'demo@local';
  let user = await store.users.findByEmail(email);
  if (user) { console.log(`Seed skipped — user ${email} already exists.`); process.exit(0); }

  user = await store.users.create({ email, password_hash: await hashPassword('demo1234') });

  const projects = [
    { name: 'Acme SaaS Blog', website: 'https://acme.example', brand_voice: 'friendly, expert',
      target_keywords: 'reduce saas churn, product onboarding, activation metrics', cms_type: 'mock' },
    { name: 'FinTechly', website: 'https://fintechly.example', brand_voice: 'authoritative, concise',
      target_keywords: 'open banking, payment orchestration', cms_type: 'mock' },
  ];

  for (const p of projects) {
    const project = await store.projects.create(user.id, p);
    for (const kw of p.target_keywords.split(',').slice(0, 2)) {
      const draft = ai.templateDraft({ keyword: kw.trim(), brandVoice: p.brand_voice, projectName: p.name });
      draft.categories = 'Guides';
      draft.tags = kw.trim();
      const post = await store.posts.create(user.id, project.id, draft);
      await store.posts.setSeoScore(post.id, seo.analyze(await store.posts.getById(post.id)).score);
    }
  }

  console.log(`Seeded account ${email} (password: demo1234) with 2 projects.`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
