'use strict';

const store = require('./store');
const adapters = require('./adapters');

/**
 * Publish a single post through its project's CMS adapter.
 * System-level (used by both "Publish now" and the scheduler); credentials
 * are decrypted by the store when the project is loaded.
 */
async function publishPost(postId) {
  const post = await store.posts.getById(postId);
  if (!post) throw new Error('Post not found');
  const project = await store.projects.getById(post.project_id);
  if (!project) throw new Error('Project not found');

  const adapter = adapters.get(project.cms_type);
  await store.posts.markPublishing(postId);

  try {
    const result = await adapter.publish(post, project.cms_config || {});
    await store.posts.markPublished(postId, result);
    return { ok: true, ...result };
  } catch (e) {
    await store.posts.markFailed(postId, e.message || e);
    return { ok: false, message: String(e.message || e) };
  }
}

module.exports = { publishPost };
