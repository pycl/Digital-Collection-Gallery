import { app } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'])
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov', '.m4v'])

const defaultConfig = {
  importPaths: [],
  featuredEntries: [],
  bannerIntervalSeconds: 8,
  bannerVideoMuted: true,
  collectionsSort: 'id_asc',
}

function normalizeFeaturedEntry(entry, index) {
  if (!entry || typeof entry !== 'object') {
    return null
  }

  const collectionId =
    typeof entry.collectionId === 'string' && entry.collectionId.trim().length > 0
      ? entry.collectionId.trim()
      : null

  if (!collectionId) {
    return null
  }

  return {
    id:
      typeof entry.id === 'string' && entry.id.trim().length > 0
        ? entry.id.trim()
        : `featured-${collectionId}-${index + 1}`,
    collectionId,
    assetPath: typeof entry.assetPath === 'string' && entry.assetPath.trim().length > 0 ? entry.assetPath : null,
    title: typeof entry.title === 'string' ? entry.title : '',
    subtitle: typeof entry.subtitle === 'string' ? entry.subtitle : '',
    enabled: typeof entry.enabled === 'boolean' ? entry.enabled : true,
  }
}

function getDataDir() {
  return path.join(app.getPath('userData'), 'gallery-data')
}

function getConfigPath() {
  return path.join(getDataDir(), 'app-config.json')
}

function getCollectionsPath() {
  return path.join(getDataDir(), 'collections.json')
}

async function ensureDataDir() {
  await fs.mkdir(getDataDir(), { recursive: true })
}

async function readJson(filePath, fallback) {
  try {
    const content = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(content)
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return fallback
    }
    throw error
  }
}

async function writeJson(filePath, data) {
  await ensureDataDir()
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8')
}

export async function readConfig() {
  await ensureDataDir()
  const saved = await readJson(getConfigPath(), defaultConfig)
  const featuredEntries = Array.isArray(saved.featuredEntries)
    ? saved.featuredEntries
        .map((entry, index) => normalizeFeaturedEntry(entry, index))
        .filter(Boolean)
    : Array.isArray(saved.featuredCollectionIds)
      ? saved.featuredCollectionIds
          .filter((value) => typeof value === 'string' && value.trim().length > 0)
          .map((collectionId, index) => ({
            id: `featured-${collectionId}-${index + 1}`,
            collectionId,
            assetPath: null,
            title: '',
            subtitle: '',
            enabled: true,
          }))
      : []

  return {
    ...defaultConfig,
    ...saved,
    importPaths: Array.isArray(saved.importPaths) ? saved.importPaths : [],
    featuredEntries,
  }
}

export async function writeConfig(config) {
  await writeJson(getConfigPath(), config)
}

export async function readCollectionsIndex() {
  await ensureDataDir()
  return readJson(getCollectionsPath(), {})
}

export async function writeCollectionsIndex(collections) {
  await writeJson(getCollectionsPath(), collections)
}

function sortByName(entries) {
  return [...entries].sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }))
}

function detectAssetType(extension) {
  if (IMAGE_EXTENSIONS.has(extension)) {
    return 'image'
  }
  if (VIDEO_EXTENSIONS.has(extension)) {
    return 'video'
  }
  return null
}

async function listAssets(folderPath) {
  const entries = sortByName(await fs.readdir(folderPath, { withFileTypes: true }))

  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const extension = path.extname(entry.name).toLowerCase()
      const type = detectAssetType(extension)
      if (!type) {
        return null
      }

      return {
        name: entry.name,
        path: path.join(folderPath, entry.name),
        type,
      }
    })
    .filter(Boolean)
}

async function registerCollectionFolder(folderPath, id, existingCollections, collectionMap) {
  if (collectionMap[id]) {
    return
  }

  const assets = await listAssets(folderPath)
  const images = assets.filter((asset) => asset.type === 'image')
  const videos = assets.filter((asset) => asset.type === 'video')
  const previous = existingCollections[id] ?? {}

  const manualCoverAsset =
    previous.manualCoverAsset && assets.some((asset) => asset.path === previous.manualCoverAsset)
      ? previous.manualCoverAsset
      : null

  const featuredAsset =
    previous.featuredAsset && assets.some((asset) => asset.path === previous.featuredAsset)
      ? previous.featuredAsset
      : null

  const defaultCover = images[0]?.path ?? videos[0]?.path ?? null

  collectionMap[id] = {
    id,
    displayName: previous.displayName ?? `Collection ${id}`,
    folderPath,
    assets,
    imageCount: images.length,
    videoCount: videos.length,
    assetCount: assets.length,
    manualCoverAsset,
    coverAsset: manualCoverAsset ?? defaultCover,
    featuredAsset,
    featuredAssetType:
      featuredAsset ? assets.find((asset) => asset.path === featuredAsset)?.type ?? null : null,
    updatedAt: new Date().toISOString(),
  }
}

async function scanImportPath(importPath, existingCollections, collectionMap) {
  const baseName = path.basename(importPath)

  if (/^\d+$/.test(baseName)) {
    await registerCollectionFolder(importPath, baseName, existingCollections, collectionMap)
    return
  }

  let entries = []

  try {
    entries = await fs.readdir(importPath, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of sortByName(entries)) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) {
      continue
    }

    const id = entry.name
    const folderPath = path.join(importPath, entry.name)
    await registerCollectionFolder(folderPath, id, existingCollections, collectionMap)
  }
}

export async function scanCollections(importPaths) {
  const existingCollections = await readCollectionsIndex()
  const collectionMap = {}

  for (const importPath of importPaths) {
    await scanImportPath(importPath, existingCollections, collectionMap)
  }

  await writeCollectionsIndex(collectionMap)
  return collectionMap
}

export function serializeCollections(collectionMap, sortMode = 'id_asc') {
  const collections = Object.values(collectionMap)

  collections.sort((left, right) => {
    const leftId = Number(left.id)
    const rightId = Number(right.id)
    return sortMode === 'id_desc' ? rightId - leftId : leftId - rightId
  })

  return collections
}

export async function getGalleryState() {
  const config = await readConfig()
  const collections = serializeCollections(await readCollectionsIndex(), config.collectionsSort)

  return {
    config,
    collections,
  }
}

export async function updateCollectionPreferences(collectionId, updates) {
  const collections = await readCollectionsIndex()
  const collection = collections[collectionId]

  if (!collection) {
    throw new Error(`Collection ${collectionId} was not found in the local index.`)
  }

  const normalizedDisplayName =
    typeof updates.displayName === 'string' && updates.displayName.trim().length > 0
      ? updates.displayName.trim()
      : collection.displayName

  const normalizedManualCoverAsset =
    typeof updates.manualCoverAsset === 'string' && updates.manualCoverAsset.length > 0
      ? updates.manualCoverAsset
      : null

  const validManualCoverAsset =
    normalizedManualCoverAsset &&
    collection.assets.some((asset) => asset.path === normalizedManualCoverAsset && asset.type === 'image')
      ? normalizedManualCoverAsset
      : null

  const normalizedFeaturedAsset =
    typeof updates.featuredAsset === 'string' && updates.featuredAsset.length > 0
      ? updates.featuredAsset
      : null

  const validFeaturedAsset =
    normalizedFeaturedAsset && collection.assets.some((asset) => asset.path === normalizedFeaturedAsset)
      ? normalizedFeaturedAsset
      : null

  const defaultCover =
    collection.assets.find((asset) => asset.type === 'image')?.path ??
    collection.assets.find((asset) => asset.type === 'video')?.path ??
    null

  collections[collectionId] = {
    ...collection,
    displayName: normalizedDisplayName,
    manualCoverAsset: validManualCoverAsset,
    coverAsset: validManualCoverAsset ?? defaultCover,
    featuredAsset: validFeaturedAsset,
    featuredAssetType: validFeaturedAsset
      ? collection.assets.find((asset) => asset.path === validFeaturedAsset)?.type ?? null
      : null,
  }

  await writeCollectionsIndex(collections)
  return collections
}

export async function updateAppConfig(updates) {
  const currentConfig = await readConfig()

  const nextConfig = {
    ...currentConfig,
  }

  if (Array.isArray(updates.featuredEntries)) {
    nextConfig.featuredEntries = updates.featuredEntries
      .map((entry, index) => normalizeFeaturedEntry(entry, index))
      .filter(Boolean)
  }

  if (typeof updates.bannerIntervalSeconds === 'number' && Number.isFinite(updates.bannerIntervalSeconds)) {
    nextConfig.bannerIntervalSeconds = Math.max(2, Math.round(updates.bannerIntervalSeconds))
  }

  if (typeof updates.bannerVideoMuted === 'boolean') {
    nextConfig.bannerVideoMuted = updates.bannerVideoMuted
  }

  await writeConfig(nextConfig)
  return nextConfig
}
