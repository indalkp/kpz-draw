// src/storage/persistent-refs.js
//
// v3.6.1 — per-project reference buckets.
//
// What changed from v3.6.0:
//   Old behaviour: refs were stored under a single global IndexedDB key
//   "kpz_refs", so refs leaked between every project you opened.
//
//   New behaviour: refs are scoped per-project. Each project's refs live
//   under "kpz_refs::<projectKey>" where projectKey is:
//     - App.currentProjectId if the project is saved to Wix
//     - "local"               if the project is unsaved (new / open-file)
//
//   A parallel index at "kpz_ref_index" maps projectKey -> {title, updatedAt,
//   count} so the Library modal can list all past ref sets on this device.
//
// Migration: if the old global "kpz_refs" key exists, move it into
// "kpz_refs::legacy-library" with title "Previous References" so users
// don't lose their existing reference library on first upgrade. Then delete
// the old key so migration only runs once.

import { App } from '../core/state.js';
import { idbGet, idbSet, idbDelete } from '../utils/idb.js';

// ---------- keys ----------

const IDX_KEY = 'kpz_ref_index';
const REFS_PREFIX = 'kpz_refs::';
export const LEGACY_BUCKET = 'legacy-library';

/**
 * Returns the IndexedDB key where the CURRENT project's refs should be stored.
 * Uses the cloud project id if available, otherwise "local".
 */
export function currentRefsKey() {
  const projectKey = App.currentProjectId || 'local';
  return REFS_PREFIX + projectKey;
}

/**
 * Returns the identifier (not the full IDB key) of the current project's ref bucket.
 * Used by the ref index to track which project a set belongs to.
 */
export function currentProjectKey() {
  return App.currentProjectId || 'local';
}

// ---------- index ----------

/**
 * Returns the full ref index { [projectKey]: { title, updatedAt, count } }.
 * Returns {} if the index doesn't exist yet.
 */
export async function getRefIndex() {
  try {
    const idx = await idbGet(IDX_KEY);
    return (idx && typeof idx === 'object') ? idx : {};
  } catch (err) {
    console.warn('getRefIndex failed:', err);
    return {};
  }
}

/**
 * Update one entry in the ref index.
 * projectKey: "local" | "legacy-library" | cloud project _id
 * meta:       { title?, count? } — updatedAt is set automatically
 */
export async function updateRefIndexEntry(projectKey, meta) {
  try {
    const idx = await getRefIndex();
    const prev = idx[projectKey] || {};
    idx[projectKey] = {
      title:     meta.title     ?? prev.title     ?? 'Untitled',
      count:     meta.count     ?? prev.count     ?? 0,
      updatedAt: Date.now(),
    };
    await idbSet(IDX_KEY, idx);
  } catch (err) {
    console.warn('updateRefIndexEntry failed:', err);
  }
}

/**
 * Remove an entry from the ref index and delete its IndexedDB bucket.
 */
export async function deleteRefBucket(projectKey) {
  try {
    const idx = await getRefIndex();
    delete idx[projectKey];
    await idbSet(IDX_KEY, idx);
    await idbDelete(REFS_PREFIX + projectKey);
  } catch (err) {
    console.warn('deleteRefBucket failed:', err);
  }
}

/**
 * Read the refs array from a specific bucket.
 * Used by the library modal to preview a past project's refs.
 */
export async function readRefsBucket(projectKey) {
  try {
    const refs = await idbGet(REFS_PREFIX + projectKey);
    return Array.isArray(refs) ? refs : [];
  } catch (err) {
    console.warn('readRefsBucket failed:', err);
    return [];
  }
}

// ---------- startup hooks ----------

/**
 * Called once at app init. Handles two things:
 *   1. One-time migration of the old global "kpz_refs" key into the legacy
 *      library bucket so users don't lose their v3.6.0 ref collection.
 *   2. If the current project (restored from autosave) has no refs in memory
 *      but DOES have saved refs for this project key in IndexedDB, restore
 *      those into App.project.refs.
 */
export async function restorePersistentRefs() {
  // --- 1. Migration ---
  try {
    const legacy = await idbGet('kpz_refs');
    if (Array.isArray(legacy) && legacy.length > 0) {
      // Only migrate if the legacy bucket doesn't already exist (don't clobber)
      const existing = await idbGet(REFS_PREFIX + LEGACY_BUCKET);
      if (!Array.isArray(existing) || existing.length === 0) {
        await idbSet(REFS_PREFIX + LEGACY_BUCKET, legacy);
        await updateRefIndexEntry(LEGACY_BUCKET, {
          title: 'Previous References (v3.6.0)',
          count: legacy.length,
        });
        console.log(`[KPZ] Migrated ${legacy.length} legacy refs into library`);
      }
      // Delete the old global key so migration only runs once
      await idbDelete('kpz_refs');
    }
  } catch (err) {
    console.warn('Ref migration failed:', err);
  }

  // --- 2. Restore for current project ---
  // If autosave already populated App.project.refs, don't overwrite.
  // Only fill in refs if the project's in-memory refs are empty.
  if (!App.project) return;
  if (App.project.refs && App.project.refs.length > 0) return;

  try {
    const saved = await idbGet(currentRefsKey());
    if (Array.isArray(saved) && saved.length > 0) {
      App.project.refs = saved;
    }
  } catch (err) {
    console.warn('restorePersistentRefs (current bucket) failed:', err);
  }
}
