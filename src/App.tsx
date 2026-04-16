import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
} from 'react'
import { HashRouter, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import './App.css'
import type { CollectionRecord, FeaturedEntry, GalleryAsset, GalleryState } from './types'

const emptyState: GalleryState = {
  config: {
    importPaths: [],
    featuredEntries: [],
    bannerIntervalSeconds: 8,
    bannerVideoMuted: true,
    collectionsSort: 'id_asc',
  },
  collections: [],
}

type GalleryContextValue = {
  galleryState: GalleryState
  loading: boolean
  busy: boolean
  error: string | null
  bridgeReady: boolean
  refreshCollections: () => Promise<void>
  importFolder: () => Promise<void>
  removeImportPath: (importPath: string) => Promise<void>
  updateConfig: (updates: {
    featuredEntries?: FeaturedEntry[]
    bannerIntervalSeconds?: number
    bannerVideoMuted?: boolean
  }) => Promise<void>
  updateCollection: (
    collectionId: string,
    updates: {
      displayName?: string
      manualCoverAsset?: string | null
      featuredAsset?: string | null
    },
  ) => Promise<void>
}

const GalleryContext = createContext<GalleryContextValue | null>(null)

function toAssetUrl(assetPath: string) {
  return `gallery-file://${encodeURI(assetPath.replaceAll('\\', '/'))}`
}

function App() {
  return (
    <HashRouter>
      <GalleryProvider>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/hall" element={<HallPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/collections/:collectionId" element={<CollectionDetailPage />} />
          <Route path="*" element={<Navigate replace to="/" />} />
        </Routes>
      </GalleryProvider>
    </HashRouter>
  )
}

function GalleryProvider({ children }: { children: ReactNode }) {
  const [galleryState, setGalleryState] = useState<GalleryState>(emptyState)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bridgeReady = typeof window.galleryApp !== 'undefined'

  async function runUpdate(loader: () => Promise<GalleryState>, pending = false) {
    try {
      setBusy(pending)
      setError(null)
      const nextState = await loader()
      setGalleryState(nextState)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Unknown error'
      setError(message)
    } finally {
      setLoading(false)
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!bridgeReady) {
      setError('Electron preload bridge is unavailable. Restart the app after the latest code changes.')
      setLoading(false)
      return
    }

    void runUpdate(() => window.galleryApp.getState())
  }, [bridgeReady])

  const value: GalleryContextValue = {
    galleryState,
    loading,
    busy,
    error,
    bridgeReady,
    refreshCollections: () => runUpdate(() => window.galleryApp.scanCollections(), true),
    importFolder: () => runUpdate(() => window.galleryApp.addImportPath(), true),
    removeImportPath: (importPath) =>
      runUpdate(() => window.galleryApp.removeImportPath(importPath), true),
    updateConfig: (updates) => runUpdate(() => window.galleryApp.updateConfig(updates), true),
    updateCollection: (collectionId, updates) =>
      runUpdate(() => window.galleryApp.updateCollection(collectionId, updates), true),
  }

  return <GalleryContext.Provider value={value}>{children}</GalleryContext.Provider>
}

function useGallery() {
  const value = useContext(GalleryContext)
  if (!value) {
    throw new Error('Gallery context is unavailable.')
  }
  return value
}

type ResolvedFeaturedEntry = {
  entry: FeaturedEntry
  collection: CollectionRecord
  asset: GalleryAsset | null
}

function createFeaturedEntry(collectionId: string, index: number): FeaturedEntry {
  return {
    id: `featured-${collectionId}-${index + 1}`,
    collectionId,
    assetPath: null,
    title: '',
    subtitle: '',
    enabled: true,
  }
}

function getCollectionFeaturedAsset(collection: CollectionRecord, assetPath?: string | null) {
  const resolvedPath = assetPath ?? collection.featuredAsset ?? collection.coverAsset
  return resolvedPath ? collection.assets.find((asset) => asset.path === resolvedPath) ?? null : null
}

function getResolvedFeaturedEntries(galleryState: GalleryState) {
  const configuredEntries =
    galleryState.config.featuredEntries.length > 0
      ? galleryState.config.featuredEntries
      : galleryState.collections.slice(0, 6).map((collection, index) => createFeaturedEntry(collection.id, index))

  return configuredEntries
    .filter((entry) => entry.enabled)
    .map((entry) => {
      const collection = galleryState.collections.find((candidate) => candidate.id === entry.collectionId) ?? null
      if (!collection) {
        return null
      }

      return {
        entry,
        collection,
        asset: getCollectionFeaturedAsset(collection, entry.assetPath),
      }
    })
    .filter((entry): entry is ResolvedFeaturedEntry => entry !== null)
}

function getCircularOffset(index: number, activeIndex: number, length: number) {
  if (length <= 1) {
    return 0
  }

  const directOffset = index - activeIndex
  const wrapPositive = directOffset + length
  const wrapNegative = directOffset - length

  return [directOffset, wrapPositive, wrapNegative].reduce((bestOffset, candidateOffset) =>
    Math.abs(candidateOffset) < Math.abs(bestOffset) ? candidateOffset : bestOffset,
  )
}

function FeaturedBannerMedia({
  asset,
  assets,
  muted,
  paused,
  onVideoEnded,
}: {
  asset: GalleryAsset
  assets: GalleryAsset[]
  muted: boolean
  paused: boolean
  onVideoEnded: () => void
}) {
  const assetUrl = toAssetUrl(asset.path)
  const previewImageUrl = getPreviewImageUrl(asset, assets)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [videoReady, setVideoReady] = useState(asset.type === 'image')

  useEffect(() => {
    if (asset.type !== 'video' || !videoRef.current) {
      return
    }

    const videoElement = videoRef.current
    videoElement.load()

    const playPromise = videoElement.play()
    if (playPromise) {
      void playPromise.catch(() => {
        setVideoReady(false)
      })
    }
  }, [asset.path, asset.type, muted])

  useEffect(() => {
    if (asset.type !== 'video' || !videoRef.current) {
      return
    }

    const videoElement = videoRef.current

    if (paused) {
      videoElement.pause()
      return
    }

    const playPromise = videoElement.play()
    if (playPromise) {
      void playPromise.catch(() => {
        setVideoReady(false)
      })
    }
  }, [asset.path, asset.type, muted, paused])

  if (asset.type === 'image') {
    return <img alt={asset.name} src={assetUrl} />
  }

  return (
    <>
      {previewImageUrl ? (
        <img
          alt={asset.name}
          className={`featuredPoster ${videoReady ? 'featuredPosterHidden' : ''}`}
          src={previewImageUrl}
        />
      ) : null}
      <video
        autoPlay
        className={`featuredBannerVideo ${videoReady ? 'featuredBannerVideoReady' : ''}`}
        controls={false}
        muted={muted}
        onCanPlay={() => setVideoReady(true)}
        onEnded={onVideoEnded}
        onError={() => setVideoReady(false)}
        onLoadedData={() => setVideoReady(true)}
        onPlaying={() => setVideoReady(true)}
        playsInline
        poster={previewImageUrl ?? undefined}
        preload="metadata"
        ref={videoRef}
        src={assetUrl}
      />
    </>
  )
}

function HomePage() {
  const { galleryState, loading, busy, error, bridgeReady, refreshCollections, importFolder, removeImportPath } =
    useGallery()
  const navigate = useNavigate()
  const featuredEntries = getResolvedFeaturedEntries(galleryState)
  const [activeFeaturedIndex, setActiveFeaturedIndex] = useState(0)
  const [featuredFullscreen, setFeaturedFullscreen] = useState(false)

  useEffect(() => {
    if (featuredEntries.length <= 1 || featuredFullscreen) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setActiveFeaturedIndex((currentIndex) => (currentIndex + 1) % featuredEntries.length)
    }, galleryState.config.bannerIntervalSeconds * 1000)

    return () => window.clearTimeout(timeoutId)
  }, [
    activeFeaturedIndex,
    featuredEntries.length,
    featuredFullscreen,
    galleryState.config.bannerIntervalSeconds,
  ])

  const resolvedFeaturedIndex =
    featuredEntries.length === 0 ? 0 : Math.min(activeFeaturedIndex, featuredEntries.length - 1)
  const featuredEntry = featuredEntries[resolvedFeaturedIndex] ?? null
  const featuredCollection = featuredEntry?.collection ?? null
  const featuredAsset = featuredEntry?.asset ?? null
  const featuredAssetUrl = featuredAsset ? toAssetUrl(featuredAsset.path) : null
  const featuredMediaType = featuredAsset?.type ?? null
  const featuredTitle =
    featuredEntry?.entry.title.trim() || featuredCollection?.displayName || 'No Collection Imported'
  const featuredSubtitle =
    featuredEntry?.entry.subtitle.trim() ||
    (featuredCollection ? `Collection ${featuredCollection.id}` : 'Create featured entries in Settings.')

  function showPreviousFeatured() {
    setActiveFeaturedIndex((currentIndex) =>
      featuredEntries.length === 0
        ? 0
        : (currentIndex - 1 + featuredEntries.length) % featuredEntries.length,
    )
  }

  function showNextFeatured() {
    setActiveFeaturedIndex((currentIndex) =>
      featuredEntries.length === 0 ? 0 : (currentIndex + 1) % featuredEntries.length,
    )
  }

  function handleFeaturedVideoEnded() {
    if (featuredFullscreen || featuredEntries.length <= 1 || featuredMediaType !== 'video') {
      return
    }

    showNextFeatured()
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Dashboard</p>
          <h1>Digital Collection Gallery</h1>
          <p className="subtitle">
            Manage imported collections here, then open the dedicated hall page for immersive browsing.
          </p>
        </div>

        <div className="topbarActions">
          <button className="primaryButton" type="button" onClick={() => navigate('/hall')}>
            Open Hall
          </button>
          <button className="ghostButton" type="button" onClick={() => navigate('/settings')}>
            Settings
          </button>
          <button
            className="ghostButton"
            disabled={busy || !bridgeReady}
            type="button"
            onClick={() => void refreshCollections()}
          >
            Rescan
          </button>
          <button
            className="primaryButton"
            disabled={busy || !bridgeReady}
            type="button"
            onClick={() => void importFolder()}
          >
            Import Folder
          </button>
        </div>
      </header>

      {error ? <div className="statusBanner error">Error: {error}</div> : null}
      {busy ? <div className="statusBanner">Working...</div> : null}

      <main className="layout">
        <section className="heroPanel">
          <div className="heroCopy">
            <p className="sectionTag">Library Control</p>
            <h2>
              {featuredEntries.length > 0
                ? `${featuredEntries.length} featured card(s) are configured for the hall`
                : 'Import a collection root folder to populate the gallery'}
            </h2>
            <p>
              Imported numeric folders are already indexed into local collections. Use Settings to
              build a reusable featured card list, then open Hall to view the carousel layer on
              top of those entries.
            </p>

            <div className="importList">
              <strong>Imported roots</strong>
              {galleryState.config.importPaths.length === 0 ? (
                <p className="mutedText">No import folders yet.</p>
              ) : (
                galleryState.config.importPaths.map((importPath) => (
                  <div className="importPathRow" key={importPath}>
                    <span>{importPath}</span>
                    <button
                      className="inlineButton"
                      disabled={busy || !bridgeReady}
                      type="button"
                      onClick={() => void removeImportPath(importPath)}
                    >
                      Remove
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          <article className="featuredCard">
            <div className="featuredArtworkShell">
              <button
                aria-label="Previous featured item"
                className="viewerNav featuredNavButton featuredNavButtonLeft"
                disabled={featuredEntries.length <= 1}
                type="button"
                onClick={showPreviousFeatured}
              />

              <button
                className="featuredArtworkButton"
                disabled={!featuredAssetUrl}
                type="button"
                onClick={() => setFeaturedFullscreen(true)}
              >
                <div className="featuredArtwork">
                  {featuredAssetUrl ? (
                    featuredAsset ? (
                      <FeaturedBannerMedia
                        asset={featuredAsset}
                        assets={featuredCollection?.assets ?? []}
                        key={featuredAsset.path}
                        muted={galleryState.config.bannerVideoMuted}
                        onVideoEnded={handleFeaturedVideoEnded}
                        paused={featuredFullscreen}
                      />
                    ) : (
                      <img alt={featuredCollection?.displayName} src={featuredAssetUrl} />
                    )
                  ) : (
                    <div className="featuredPlaceholder">No cover yet</div>
                  )}
                </div>
              </button>

              <button
                aria-label="Next featured item"
                className="viewerNav featuredNavButton featuredNavButtonRight"
                disabled={featuredEntries.length <= 1}
                type="button"
                onClick={showNextFeatured}
              />
            </div>
            <div className="featuredMeta">
              <span className="collectionId">
                {featuredCollection ? `CD.${featuredCollection.id}` : 'CD.00000000'}
              </span>
              <h3>{featuredTitle}</h3>
              <p className="metaLine">{featuredSubtitle}</p>
              {featuredEntries.length > 1 ? (
                <p className="featuredCounter">
                  {resolvedFeaturedIndex + 1} / {featuredEntries.length}
                </p>
              ) : (
                <p className="featuredCounter">
                  {featuredEntries.length === 0 ? 'No featured cards yet' : 'Single featured item'}
                </p>
              )}
              {featuredCollection ? (
                <div className="featuredActions">
                  <button
                    className="ghostButton"
                    disabled={!featuredAssetUrl}
                    type="button"
                    onClick={() => setFeaturedFullscreen(true)}
                  >
                    Expand Media
                  </button>
                  <button className="primaryButton" type="button" onClick={() => navigate('/hall')}>
                    Open Hall
                  </button>
                </div>
              ) : null}
            </div>
          </article>
        </section>

        <section className="gridPanel">
          <div className="panelHeader">
            <div>
              <p className="sectionTag">All Collections</p>
              <h2>
                {loading
                  ? 'Loading local collection index...'
                  : `${galleryState.collections.length} collection folder(s) indexed`}
              </h2>
            </div>
            <span className="pill">
              Sort: {galleryState.config.collectionsSort === 'id_desc' ? 'ID Desc' : 'ID Asc'}
            </span>
          </div>

          {galleryState.collections.length === 0 ? (
            <div className="emptyState">
              <strong>No collections found yet.</strong>
              <p>
                Use <code>Import Folder</code> and choose a directory whose child folders are named
                with numeric collection IDs such as <code>105435</code>.
              </p>
            </div>
          ) : (
            <div className="collectionGrid">
              {galleryState.collections.map((collection) => (
                <CollectionCard
                  collection={collection}
                  key={collection.id}
                  onOpen={() => navigate(`/collections/${collection.id}`)}
                />
              ))}
            </div>
          )}
        </section>
      </main>

      {featuredFullscreen && featuredCollection && featuredAssetUrl ? (
        <FeaturedFullscreenOverlay
          collection={featuredCollection}
          mediaType={featuredMediaType}
          muted={galleryState.config.bannerVideoMuted}
          src={featuredAssetUrl}
          onClose={() => setFeaturedFullscreen(false)}
        />
      ) : null}
    </div>
  )
}

function HallPage() {
  const { galleryState, error } = useGallery()
  const navigate = useNavigate()
  const featuredEntries = getResolvedFeaturedEntries(galleryState)
  const [activeIndex, setActiveIndex] = useState(0)
  const [hallFullscreen, setHallFullscreen] = useState(false)
  const dragStartX = useRef<number | null>(null)
  const wheelLockRef = useRef(false)
  const [autoRotatePaused, setAutoRotatePaused] = useState(false)

  function showPrevious() {
    setActiveIndex((currentIndex) =>
      featuredEntries.length === 0
        ? 0
        : (currentIndex - 1 + featuredEntries.length) % featuredEntries.length,
    )
  }

  function showNext() {
    setActiveIndex((currentIndex) =>
      featuredEntries.length === 0 ? 0 : (currentIndex + 1) % featuredEntries.length,
    )
  }

  const resolvedActiveIndex =
    featuredEntries.length === 0 ? 0 : Math.min(activeIndex, featuredEntries.length - 1)
  const activeEntry = featuredEntries[resolvedActiveIndex] ?? null
  const activeTitle = activeEntry?.entry.title.trim() || activeEntry?.collection.displayName || 'No active entry'
  const activeSubtitle =
    activeEntry?.entry.subtitle.trim() || `Collection ${activeEntry?.collection.id ?? '000000'}`
  const activePreviewImageUrl =
    activeEntry?.asset ? getPreviewImageUrl(activeEntry.asset, activeEntry.collection.assets) : null
  const activeBackdropUrl = activePreviewImageUrl || (activeEntry?.asset ? toAssetUrl(activeEntry.asset.path) : null)
  const activeBackdropVideo =
    activeEntry?.asset?.type === 'video' && !activePreviewImageUrl ? toAssetUrl(activeEntry.asset.path) : null

  useEffect(() => {
    if (featuredEntries.length <= 1 || autoRotatePaused || hallFullscreen) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setActiveIndex((currentIndex) => (currentIndex + 1) % featuredEntries.length)
    }, galleryState.config.bannerIntervalSeconds * 1000)

    return () => window.clearTimeout(timeoutId)
  }, [
    activeIndex,
    autoRotatePaused,
    featuredEntries.length,
    galleryState.config.bannerIntervalSeconds,
    hallFullscreen,
  ])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        setActiveIndex((currentIndex) =>
          featuredEntries.length === 0
            ? 0
            : (currentIndex - 1 + featuredEntries.length) % featuredEntries.length,
        )
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        setActiveIndex((currentIndex) =>
          featuredEntries.length === 0 ? 0 : (currentIndex + 1) % featuredEntries.length,
        )
      } else if (event.key === 'Enter' && activeEntry) {
        setHallFullscreen(true)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeEntry, featuredEntries.length])

  function handlePointerDown(event: ReactPointerEvent<HTMLElement>) {
    dragStartX.current = event.clientX
    setAutoRotatePaused(true)
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLElement>) {
    if (dragStartX.current === null) {
      return
    }

    const deltaX = event.clientX - dragStartX.current
    dragStartX.current = null

    if (Math.abs(deltaX) < 56) {
      return
    }

    if (deltaX > 0) {
      showPrevious()
      return
    }

    showNext()
  }

  function handleWheel(event: ReactWheelEvent<HTMLElement>) {
    if (featuredEntries.length <= 1 || wheelLockRef.current) {
      return
    }

    const axisDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
    if (Math.abs(axisDelta) < 28) {
      return
    }

    wheelLockRef.current = true
    window.setTimeout(() => {
      wheelLockRef.current = false
    }, 180)

    setAutoRotatePaused(true)
    if (axisDelta > 0) {
      showNext()
      return
    }

    showPrevious()
  }

  return (
    <div className="shell hallShell">
      {activeBackdropUrl ? (
        <div className="hallBackdrop" aria-hidden="true">
          {activeBackdropVideo ? (
            <video autoPlay loop muted playsInline preload="metadata" src={activeBackdropVideo} />
          ) : (
            <img alt="" src={activeBackdropUrl} />
          )}
        </div>
      ) : null}

      <header className="topbar">
        <div>
          <p className="eyebrow">Featured Hall</p>
          <h1>Curated Display</h1>
          <p className="subtitle">
            This page is now the dedicated exhibition layer. Drag, scroll, or use the arrow keys to
            rotate the featured card ring.
          </p>
        </div>

        <div className="topbarActions">
          <button className="ghostButton" type="button" onClick={() => navigate('/')}>
            Dashboard
          </button>
          <button className="ghostButton" type="button" onClick={() => navigate('/settings')}>
            Edit Entries
          </button>
        </div>
      </header>

      {error ? <div className="statusBanner error">Error: {error}</div> : null}

      <main className="hallLayout">
        <section className="hallStagePanel">
          <div className="hallStageHeader">
            <p className="sectionTag">Featured Ring</p>
            <div className="hallStageMeta">
              <span className="pill">
                {featuredEntries.length > 0 ? `${resolvedActiveIndex + 1} / ${featuredEntries.length}` : '0 / 0'}
              </span>
            </div>
          </div>

          {featuredEntries.length === 0 ? (
            <div className="emptyState">
              <strong>No featured cards configured yet.</strong>
              <p>Open Settings and add at least one featured entry to populate the hall.</p>
            </div>
          ) : (
            <div
              className="hallViewport"
              onBlurCapture={() => setAutoRotatePaused(false)}
              onMouseEnter={() => setAutoRotatePaused(true)}
              onMouseLeave={() => setAutoRotatePaused(false)}
              onPointerCancel={() => {
                dragStartX.current = null
              }}
              onPointerDown={handlePointerDown}
              onPointerUp={handlePointerUp}
              onWheel={handleWheel}
            >
              <button
                aria-label="Previous featured card"
                className="viewerNav hallNavButton hallNavButtonLeft"
                disabled={featuredEntries.length <= 1}
                type="button"
                onClick={showPrevious}
              />

              <div className="hallRing">
                {featuredEntries.map((featured, index) => {
                  const offset = getCircularOffset(index, resolvedActiveIndex, featuredEntries.length)
                  const distance = Math.abs(offset)
                  const visible = distance <= 3
                  if (!visible) {
                    return null
                  }

                  const asset = featured.asset
                  const assetUrl = asset ? toAssetUrl(asset.path) : null
                  const previewImageUrl = asset ? getPreviewImageUrl(asset, featured.collection.assets) : null
                  const showVideo = asset?.type === 'video' && offset === 0
                  const canOpenFullscreen = Boolean(assetUrl)

                  return (
                    <button
                      className={`hallCard ${offset === 0 ? 'hallCardActive' : ''}`}
                      key={featured.entry.id}
                      style={
                        {
                          '--hall-offset': offset,
                          '--hall-depth': `${Math.max(0, 260 - distance * 86)}px`,
                          '--hall-opacity': `${Math.max(0.08, 1 - distance * 0.24)}`,
                          '--hall-scale': `${Math.max(0.7, 1 - distance * 0.09)}`,
                          '--hall-blur': `${Math.max(0, distance * 2.2)}px`,
                          '--hall-z': `${40 - distance}`,
                        } as CSSProperties
                      }
                      type="button"
                      onClick={() => {
                        if (offset === 0) {
                          if (canOpenFullscreen) {
                            setHallFullscreen(true)
                          }
                          return
                        }

                        setActiveIndex(index)
                      }}
                    >
                      <div className="hallCardArtwork">
                        {assetUrl ? (
                          showVideo ? (
                            <video autoPlay loop muted playsInline preload="metadata" src={assetUrl} />
                          ) : previewImageUrl ? (
                            <img alt={featured.entry.title || featured.collection.displayName} src={previewImageUrl} />
                          ) : asset?.type === 'image' ? (
                            <img alt={featured.entry.title || featured.collection.displayName} src={assetUrl} />
                          ) : (
                            <video autoPlay loop muted playsInline preload="metadata" src={assetUrl} />
                          )
                        ) : (
                          <div className="featuredPlaceholder">No art</div>
                        )}
                      </div>
                      <div className="hallCardMeta">
                        <span className="collectionId">CD.{featured.collection.id}</span>
                        <strong>{featured.entry.title || featured.collection.displayName}</strong>
                        <span>{featured.entry.subtitle || `Collection ${featured.collection.id}`}</span>
                      </div>
                    </button>
                  )
                })}
              </div>

              <button
                aria-label="Next featured card"
                className="viewerNav hallNavButton hallNavButtonRight"
                disabled={featuredEntries.length <= 1}
                type="button"
                onClick={showNext}
              />
            </div>
          )}
        </section>

        <section className="gridPanel hallInfoPanel">
          {activeEntry ? (
            <div className="hallInfoBody">
              <p className="sectionTag">Current Card</p>
              <button
                className="hallTitleButton"
                type="button"
                onClick={() => navigate(`/collections/${activeEntry.collection.id}`)}
              >
                {activeTitle}
              </button>
              <div className="hallInfoMeta">
                <span>CD.{activeEntry.collection.id}</span>
                <span>{activeEntry.asset?.type === 'video' ? 'Video' : 'Image'}</span>
              </div>
              <p className="subtitle">{activeSubtitle}</p>
              <div className="hallInfoActions">
                <button
                  className="primaryButton"
                  disabled={!activeEntry.asset}
                  type="button"
                  onClick={() => setHallFullscreen(true)}
                >
                  Expand Media
                </button>
                <button className="ghostButton" type="button" onClick={() => navigate('/settings')}>
                  Edit Entries
                </button>
              </div>
            </div>
          ) : (
            <div className="emptyState">
              <strong>No hall entries yet.</strong>
              <p>Go to Settings and start composing featured cards.</p>
            </div>
          )}
        </section>
      </main>

      {hallFullscreen && activeEntry?.asset ? (
        <HallFullscreenOverlay
          mediaType={activeEntry.asset?.type ?? null}
          muted={galleryState.config.bannerVideoMuted}
          src={toAssetUrl(activeEntry.asset.path)}
          title={activeTitle}
          onClose={() => setHallFullscreen(false)}
        />
      ) : null}
    </div>
  )
}

function SettingsPage() {
  const { galleryState, loading, busy, error, bridgeReady, updateConfig, updateCollection } = useGallery()
  const navigate = useNavigate()

  return (
    <div className="shell">
      <header className="detailTopbar">
        <div className="detailTitleBlock">
          <button className="ghostButton" type="button" onClick={() => navigate('/')}>
            Back
          </button>
          <div className="viewerInfoCard">
            <p className="eyebrow">Settings</p>
            <h1>Collection Settings</h1>
            <p className="subtitle">
              Edit display names, manual covers, and featured media for each imported collection.
            </p>
          </div>
        </div>
      </header>

      {error ? <div className="statusBanner error">Error: {error}</div> : null}

      <main className="detailLayout">
        <BannerSettingsSection
          bridgeReady={bridgeReady}
          busy={busy}
          collections={galleryState.collections}
          config={galleryState.config}
          onSave={updateConfig}
        />

        <section className="gridPanel settingsPanel">
          <div className="panelHeader">
            <div>
              <p className="sectionTag">Imported Collections</p>
              <h2>
                {loading
                  ? 'Loading settings...'
                  : `${galleryState.collections.length} collection setting row(s) available`}
              </h2>
            </div>
          </div>

          {galleryState.collections.length === 0 ? (
            <div className="emptyState">
              <strong>No collections imported yet.</strong>
              <p>Return to the home page and import at least one numeric collection folder first.</p>
            </div>
          ) : (
            <div className="settingsList">
              {galleryState.collections.map((collection) => (
                <CollectionSettingsRow
                  bridgeReady={bridgeReady}
                  busy={busy}
                  collection={collection}
                  key={collection.id}
                  onSave={(updates) => updateCollection(collection.id, updates)}
                />
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  )
}

function BannerSettingsSection({
  config,
  busy,
  bridgeReady,
  collections,
  onSave,
}: {
  config: GalleryState['config']
  busy: boolean
  bridgeReady: boolean
  collections: CollectionRecord[]
  onSave: (updates: {
    featuredEntries?: FeaturedEntry[]
    bannerIntervalSeconds?: number
    bannerVideoMuted?: boolean
  }) => Promise<void>
}) {
  const [featuredEntries, setFeaturedEntries] = useState(config.featuredEntries)
  const [bannerIntervalSeconds, setBannerIntervalSeconds] = useState(String(config.bannerIntervalSeconds))
  const [bannerVideoMuted, setBannerVideoMuted] = useState(config.bannerVideoMuted)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setFeaturedEntries(config.featuredEntries)
    setBannerIntervalSeconds(String(config.bannerIntervalSeconds))
    setBannerVideoMuted(config.bannerVideoMuted)
  }, [config.bannerIntervalSeconds, config.bannerVideoMuted, config.featuredEntries])

  const normalizedInterval = Number(bannerIntervalSeconds)
  const isDirty =
    JSON.stringify(featuredEntries) !== JSON.stringify(config.featuredEntries) ||
    normalizedInterval !== config.bannerIntervalSeconds ||
    bannerVideoMuted !== config.bannerVideoMuted

  function updateEntry(entryId: string, updater: (entry: FeaturedEntry) => FeaturedEntry) {
    setFeaturedEntries((currentEntries) =>
      currentEntries.map((entry) => (entry.id === entryId ? updater(entry) : entry)),
    )
  }

  function addEntry() {
    const collection = collections[0]
    setFeaturedEntries((currentEntries) => [
      ...currentEntries,
      createFeaturedEntry(collection?.id ?? '000000', currentEntries.length),
    ])
  }

  async function handleSave() {
    setSaving(true)
    try {
      await onSave({
        featuredEntries,
        bannerIntervalSeconds: Number.isFinite(normalizedInterval) ? normalizedInterval : config.bannerIntervalSeconds,
        bannerVideoMuted,
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="gridPanel settingsPanel">
      <div className="panelHeader">
        <div>
          <p className="sectionTag">Featured Hall</p>
          <h2>Featured Entry Builder</h2>
        </div>
        <button className="ghostButton" type="button" onClick={addEntry}>
          Add Entry
        </button>
      </div>

      <div className="settingsList">
        <article className="settingsCard settingsCardWide">
          <div className="settingsBody">
            {featuredEntries.length === 0 ? (
              <div className="emptyState">
                <strong>No featured entries configured.</strong>
                <p>Add one or more featured cards here. Each entry can point at any collection and any media asset.</p>
              </div>
            ) : (
              <div className="featuredEntryList">
                {featuredEntries.map((entry, index) => {
                  const collection = collections.find((candidate) => candidate.id === entry.collectionId) ?? null
                  const availableAssets = collection?.assets ?? []

                  return (
                    <article className="featuredEntryCard" key={entry.id}>
                      <div className="featuredEntryHeader">
                        <strong>Featured Card {index + 1}</strong>
                        <button
                          className="inlineButton"
                          type="button"
                          onClick={() =>
                            setFeaturedEntries((currentEntries) =>
                              currentEntries.filter((currentEntry) => currentEntry.id !== entry.id),
                            )
                          }
                        >
                          Remove
                        </button>
                      </div>

                      <div className="featuredEntryGrid">
                        <label className="settingsField">
                          <span>Collection</span>
                          <select
                            className="settingsSelect"
                            value={entry.collectionId}
                            onChange={(event) =>
                              updateEntry(entry.id, (currentEntry) => ({
                                ...currentEntry,
                                collectionId: event.target.value,
                                assetPath: null,
                              }))
                            }
                          >
                            {collections.map((candidate) => (
                              <option key={candidate.id} value={candidate.id}>
                                {candidate.displayName} ({candidate.id})
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="settingsField">
                          <span>Media</span>
                          <select
                            className="settingsSelect"
                            value={entry.assetPath ?? ''}
                            onChange={(event) =>
                              updateEntry(entry.id, (currentEntry) => ({
                                ...currentEntry,
                                assetPath: event.target.value || null,
                              }))
                            }
                          >
                            <option value="">Auto (collection featured / cover)</option>
                            {availableAssets.map((asset) => (
                              <option key={asset.path} value={asset.path}>
                                [{asset.type === 'image' ? 'Image' : 'Video'}] {asset.name}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="settingsField">
                          <span>Title</span>
                          <input
                            className="settingsInput"
                            type="text"
                            value={entry.title}
                            onChange={(event) =>
                              updateEntry(entry.id, (currentEntry) => ({
                                ...currentEntry,
                                title: event.target.value,
                              }))
                            }
                          />
                        </label>

                        <label className="settingsField">
                          <span>Subtitle</span>
                          <input
                            className="settingsInput"
                            type="text"
                            value={entry.subtitle}
                            onChange={(event) =>
                              updateEntry(entry.id, (currentEntry) => ({
                                ...currentEntry,
                                subtitle: event.target.value,
                              }))
                            }
                          />
                        </label>
                      </div>

                      <label className="settingsToggle">
                        <input
                          checked={entry.enabled}
                          type="checkbox"
                          onChange={(event) =>
                            updateEntry(entry.id, (currentEntry) => ({
                              ...currentEntry,
                              enabled: event.target.checked,
                            }))
                          }
                        />
                        <span>Enable this featured card</span>
                      </label>
                    </article>
                  )
                })}
              </div>
            )}

            <label className="settingsField">
              <span>Rotation Interval Seconds</span>
              <input
                className="settingsInput"
                min="2"
                step="1"
                type="number"
                value={bannerIntervalSeconds}
                onChange={(event) => setBannerIntervalSeconds(event.target.value)}
              />
            </label>

            <label className="settingsToggle">
              <input
                checked={bannerVideoMuted}
                type="checkbox"
                onChange={(event) => setBannerVideoMuted(event.target.checked)}
              />
              <span>Mute featured banner videos</span>
            </label>

            <p className="settingsHint">
              Featured cards are independent entries now. You can reuse the same collection multiple times with different media, titles, and subtitles.
            </p>

            <div className="settingsActions">
              <button
                className="primaryButton"
                disabled={!bridgeReady || busy || saving || !isDirty}
                type="button"
                onClick={() => void handleSave()}
              >
                {saving ? 'Saving...' : 'Save Banner Settings'}
              </button>
              <button
                className="ghostButton"
                disabled={saving || !isDirty}
                type="button"
                onClick={() => {
                  setFeaturedEntries(config.featuredEntries)
                  setBannerIntervalSeconds(String(config.bannerIntervalSeconds))
                  setBannerVideoMuted(config.bannerVideoMuted)
                }}
              >
                Reset
              </button>
            </div>
          </div>
        </article>
      </div>
    </section>
  )
}

function CollectionSettingsRow({
  collection,
  busy,
  bridgeReady,
  onSave,
}: {
  collection: CollectionRecord
  busy: boolean
  bridgeReady: boolean
  onSave: (updates: {
    displayName?: string
    manualCoverAsset?: string | null
    featuredAsset?: string | null
  }) => Promise<void>
}) {
  const imageAssets = collection.assets.filter((asset) => asset.type === 'image')
  const mediaAssets = collection.assets
  const [displayName, setDisplayName] = useState(collection.displayName)
  const [manualCoverAsset, setManualCoverAsset] = useState(collection.manualCoverAsset ?? '')
  const [featuredAsset, setFeaturedAsset] = useState(collection.featuredAsset ?? '')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setDisplayName(collection.displayName)
    setManualCoverAsset(collection.manualCoverAsset ?? '')
    setFeaturedAsset(collection.featuredAsset ?? '')
  }, [collection.displayName, collection.manualCoverAsset, collection.featuredAsset])

  const trimmedDisplayName = displayName.trim()
  const normalizedManualCoverAsset = manualCoverAsset || null
  const normalizedFeaturedAsset = featuredAsset || null
  const isDirty =
    trimmedDisplayName !== collection.displayName ||
    normalizedManualCoverAsset !== (collection.manualCoverAsset ?? null) ||
    normalizedFeaturedAsset !== (collection.featuredAsset ?? null)

  const effectivePreviewAsset =
    collection.assets.find((asset) => asset.path === normalizedFeaturedAsset) ??
    collection.assets.find((asset) => asset.path === (normalizedManualCoverAsset ?? '')) ??
    collection.assets.find((asset) => asset.path === (collection.coverAsset ?? '')) ??
    null
  const previewImageUrl = effectivePreviewAsset ? getPreviewImageUrl(effectivePreviewAsset, collection.assets) : null
  const previewAssetUrl = effectivePreviewAsset ? toAssetUrl(effectivePreviewAsset.path) : null

  async function handleSave() {
    setSaving(true)
    try {
      await onSave({
        displayName: trimmedDisplayName || collection.displayName,
        manualCoverAsset: normalizedManualCoverAsset,
        featuredAsset: normalizedFeaturedAsset,
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <article className="settingsCard">
      <div className="settingsPreview">
        {effectivePreviewAsset && previewAssetUrl ? (
          effectivePreviewAsset.type === 'video' && !previewImageUrl ? (
            <video autoPlay loop muted playsInline src={previewAssetUrl} />
          ) : (
            <img alt={collection.displayName} src={previewImageUrl ?? previewAssetUrl} />
          )
        ) : (
          <div className="collectionPlaceholder">No cover</div>
        )}
      </div>

      <div className="settingsBody">
        <div className="settingsHeading">
          <div className="viewerInfoCard">
            <p className="sectionTag">Collection {collection.id}</p>
            <h3>{collection.displayName}</h3>
          </div>
          <span className="pill">
            {collection.assetCount} assets · {collection.imageCount} images · {collection.videoCount} videos
          </span>
        </div>

        <label className="settingsField">
          <span>Display Name</span>
          <input
            className="settingsInput"
            type="text"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </label>

        <label className="settingsField">
          <span>Manual Cover</span>
          <select
            className="settingsSelect"
            disabled={imageAssets.length === 0}
            value={manualCoverAsset}
            onChange={(event) => setManualCoverAsset(event.target.value)}
          >
            <option value="">Auto (first available image)</option>
            {imageAssets.map((asset) => (
              <option key={asset.path} value={asset.path}>
                {asset.name}
              </option>
            ))}
          </select>
        </label>

        <label className="settingsField">
          <span>Featured Media</span>
          <select
            className="settingsSelect"
            disabled={mediaAssets.length === 0}
            value={featuredAsset}
            onChange={(event) => setFeaturedAsset(event.target.value)}
          >
            <option value="">Auto (use collection cover)</option>
            {mediaAssets.map((asset) => (
              <option key={asset.path} value={asset.path}>
                [{asset.type === 'image' ? 'Image' : 'Video'}] {asset.name}
              </option>
            ))}
          </select>
        </label>

        <p className="settingsHint">
          {imageAssets.length > 0
            ? `Current folder: ${collection.folderPath}`
            : `No image asset found in ${collection.folderPath}, so manual cover selection is unavailable. Featured Media can still use videos.`}
        </p>

        <div className="settingsActions">
          <button
            className="primaryButton"
            disabled={!bridgeReady || busy || saving || !isDirty}
            type="button"
            onClick={() => void handleSave()}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button
            className="ghostButton"
            disabled={saving || !isDirty}
            type="button"
            onClick={() => {
              setDisplayName(collection.displayName)
              setManualCoverAsset(collection.manualCoverAsset ?? '')
              setFeaturedAsset(collection.featuredAsset ?? '')
            }}
          >
            Reset
          </button>
        </div>

      </div>
    </article>
  )
}

function FeaturedFullscreenOverlay({
  collection,
  src,
  mediaType,
  muted,
  onClose,
}: {
  collection: CollectionRecord
  src: string
  mediaType: 'image' | 'video' | null
  muted: boolean
  onClose: () => void
}) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div className="viewerOverlay" role="dialog" aria-modal="true">
      <div className="featuredFullscreenBackdrop" onClick={onClose} />

      <div className="featuredFullscreenShell">
        <button
          aria-label={`Close featured view for ${collection.displayName}`}
          className="featuredFullscreenClose"
          type="button"
          onClick={onClose}
        >
          脳
        </button>

        <div className="featuredFullscreenStage">
          {mediaType === 'video' ? (
            <video
              autoPlay
              className="viewerVideo"
              controls={false}
              key={src}
              loop
              muted={muted}
              playsInline
              src={src}
            />
          ) : (
            <img alt={collection.displayName} className="viewerImage" src={src} />
          )}
        </div>

      </div>
    </div>
  )
}

function HallFullscreenOverlay({
  title,
  src,
  mediaType,
  muted,
  onClose,
}: {
  title: string
  src: string
  mediaType: 'image' | 'video' | null
  muted: boolean
  onClose: () => void
}) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div className="viewerOverlay hallFullscreenOverlay" role="dialog" aria-modal="true">
      <div className="hallFullscreenBackdrop" onClick={onClose} />
      <div className="hallFullscreenShell">
        <button
          aria-label={`Close fullscreen view for ${title}`}
          className="featuredFullscreenClose"
          type="button"
          onClick={onClose}
        />

        <div className="hallFullscreenStage">
          {mediaType === 'video' ? (
            <video autoPlay className="hallFullscreenMedia" controls={false} loop muted={muted} playsInline src={src} />
          ) : (
            <img alt={title} className="hallFullscreenMedia" src={src} />
          )}
        </div>
      </div>
    </div>
  )
}

function CollectionCard({
  collection,
  onOpen,
}: {
  collection: CollectionRecord
  onOpen: () => void
}) {
  const coverUrl = collection.coverAsset ? toAssetUrl(collection.coverAsset) : null

  return (
    <button className="collectionCard" type="button" onClick={onOpen}>
      <div className="collectionCover">
        {coverUrl ? (
          <img alt={collection.displayName} src={coverUrl} />
        ) : (
          <div className="collectionPlaceholder">No preview</div>
        )}
      </div>
      <div className="collectionMeta">
        <strong>{collection.displayName}</strong>
        <span>ID {collection.id}</span>
        <span>
          {collection.imageCount} images · {collection.videoCount} videos
        </span>
      </div>
    </button>
  )
}

function CollectionDetailPage() {
  const { collectionId } = useParams()
  const { galleryState, loading } = useGallery()
  const navigate = useNavigate()
  const collection = galleryState.collections.find((entry) => entry.id === collectionId)
  const [activeAssetIndex, setActiveAssetIndex] = useState<number | null>(null)

  useEffect(() => {
    if (activeAssetIndex === null || !collection) {
      return
    }

    const assetCount = collection.assets.length

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setActiveAssetIndex(null)
      } else if (event.key === 'ArrowRight') {
        setActiveAssetIndex((currentIndex) => {
          if (currentIndex === null) {
            return currentIndex
          }
          return (currentIndex + 1) % assetCount
        })
      } else if (event.key === 'ArrowLeft') {
        setActiveAssetIndex((currentIndex) => {
          if (currentIndex === null) {
            return currentIndex
          }
          return (currentIndex - 1 + assetCount) % assetCount
        })
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeAssetIndex, collection])

  if (loading && !collection) {
    return (
      <div className="shell">
        <div className="statusBanner">Loading collection...</div>
      </div>
    )
  }

  if (!collection) {
    return (
      <div className="shell">
        <header className="detailTopbar">
          <button className="ghostButton" type="button" onClick={() => navigate('/')}>
            Back
          </button>
        </header>
        <div className="emptyState">
          <strong>Collection not found.</strong>
          <p>The selected collection is unavailable in the current local index.</p>
        </div>

      </div>
    )
  }

  const resolvedCollection = collection
  const activeAsset = activeAssetIndex === null ? null : resolvedCollection.assets[activeAssetIndex]

  return (
    <div className="shell">
      <header className="detailTopbar">
        <div className="detailTitleBlock">
          <button className="ghostButton" type="button" onClick={() => navigate('/')}>
            Back
          </button>
          <div className="viewerInfoCard">
            <p className="eyebrow">Collection Detail</p>
            <h1>{collection.displayName}</h1>
            <p className="subtitle">
              ID {collection.id} · {collection.assetCount} assets · {collection.imageCount} images · {' '}
              {collection.videoCount} videos
            </p>
          </div>
        </div>
      </header>

      <main className="detailLayout">
        <section className="detailHero">
          <div className="detailCover">
              {resolvedCollection.coverAsset ? (
                <img alt={resolvedCollection.displayName} src={toAssetUrl(resolvedCollection.coverAsset)} />
              ) : (
                <div className="featuredPlaceholder">No cover yet</div>
              )}
            </div>
          <div className="detailMeta">
            <p className="sectionTag">Collection Overview</p>
            <h2>{resolvedCollection.displayName}</h2>
            <p className="subtitle detailCopy">
              This page shows every indexed asset in the current collection folder. Open any item
              to enter the fullscreen viewer and browse left or right.
            </p>
            <div className="detailStats">
              <span className="pill">Folder: {resolvedCollection.folderPath}</span>
              <span className="pill">Updated: {new Date(resolvedCollection.updatedAt).toLocaleString()}</span>
            </div>
          </div>
        </section>

        <section className="gridPanel">
          <div className="panelHeader">
            <div>
              <p className="sectionTag">Assets</p>
              <h2>{resolvedCollection.assets.length} media item(s)</h2>
            </div>
          </div>

          {resolvedCollection.assets.length === 0 ? (
            <div className="emptyState">
              <strong>No media files found.</strong>
              <p>This collection folder is indexed but does not contain supported image or video assets.</p>
            </div>
          ) : (
            <div className="assetGrid">
              {resolvedCollection.assets.map((asset, index) => (
                <AssetCard
                  asset={asset}
                  key={asset.path}
                  onOpen={() => setActiveAssetIndex(index)}
                  previewImageUrl={getPreviewImageUrl(asset, resolvedCollection.assets)}
                />
              ))}
            </div>
          )}
        </section>
      </main>

      {activeAsset ? (
        <FullscreenViewer
          asset={activeAsset}
          assetIndex={activeAssetIndex ?? 0}
          collection={resolvedCollection}
          onClose={() => setActiveAssetIndex(null)}
          onNext={() =>
            setActiveAssetIndex((currentIndex) =>
              currentIndex === null ? 0 : (currentIndex + 1) % resolvedCollection.assets.length,
            )
          }
          onPrevious={() =>
            setActiveAssetIndex((currentIndex) =>
              currentIndex === null
                ? 0
                : (currentIndex - 1 + resolvedCollection.assets.length) % resolvedCollection.assets.length,
            )
          }
          onSelect={(index) => setActiveAssetIndex(index)}
        />
      ) : null}
    </div>
  )
}

function getAssetStem(name: string) {
  const dotIndex = name.lastIndexOf('.')
  return dotIndex >= 0 ? name.slice(0, dotIndex) : name
}

function getPreviewImageUrl(asset: GalleryAsset, assets: GalleryAsset[]) {
  if (asset.type === 'image') {
    return toAssetUrl(asset.path)
  }

  const imageMatch = assets.find(
    (candidate) => candidate.type === 'image' && getAssetStem(candidate.name) === getAssetStem(asset.name),
  )

  return imageMatch ? toAssetUrl(imageMatch.path) : null
}

function AssetCard({
  asset,
  onOpen,
  previewImageUrl,
}: {
  asset: GalleryAsset
  onOpen: () => void
  previewImageUrl: string | null
}) {
  const assetUrl = toAssetUrl(asset.path)

  return (
    <button className="assetCard" type="button" onClick={onOpen}>
      <div className="assetPreview">
        {previewImageUrl ? (
          <img alt={asset.name} src={previewImageUrl} />
        ) : (
          <video autoPlay loop muted playsInline preload="metadata" src={assetUrl} />
        )}
        {asset.type === 'video' ? <span className="assetBadge">Video</span> : null}
      </div>
      <div className="assetMeta">
        <strong title={asset.name}>{asset.name}</strong>
        <span>{asset.type === 'image' ? 'Image' : 'Video'}</span>
      </div>
    </button>
  )
}

function ViewerThumbnailRail({
  assets,
  activeIndex,
  onSelect,
}: {
  assets: GalleryAsset[]
  activeIndex: number
  onSelect: (index: number) => void
}) {
  const thumbnailRefs = useRef<Array<HTMLButtonElement | null>>([])

  useEffect(() => {
    const activeThumbnail = thumbnailRefs.current[activeIndex]
    if (!activeThumbnail) {
      return
    }

    activeThumbnail.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'center',
    })
  }, [activeIndex, assets.length])

  return (
    <div className="viewerThumbDock">
      <div aria-hidden="true" className="viewerThumbHotspot" />

      <div className="viewerThumbPanel">
        <div className="viewerThumbRail">
          {assets.map((entry, index) => {
            const thumbPreviewImageUrl = getPreviewImageUrl(entry, assets)
            const thumbUrl = toAssetUrl(entry.path)

            return (
              <button
                aria-current={index === activeIndex ? 'true' : undefined}
                className={`viewerThumbButton ${index === activeIndex ? 'viewerThumbButtonActive' : ''}`}
                key={entry.path}
                ref={(node) => {
                  thumbnailRefs.current[index] = node
                }}
                type="button"
                onClick={() => onSelect(index)}
              >
                <div className="viewerThumbMedia">
                  {thumbPreviewImageUrl ? (
                    <img alt={entry.name} src={thumbPreviewImageUrl} />
                  ) : (
                    <video muted playsInline preload="metadata" src={thumbUrl} />
                  )}
                  {entry.type === 'video' ? <span className="assetBadge">Video</span> : null}
                </div>
                <span className="viewerThumbLabel" title={entry.name}>
                  {entry.name}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function FullscreenViewer({
  asset,
  assetIndex,
  collection,
  onClose,
  onNext,
  onPrevious,
  onSelect,
}: {
  asset: GalleryAsset
  assetIndex: number
  collection: CollectionRecord
  onClose: () => void
  onNext: () => void
  onPrevious: () => void
  onSelect: (index: number) => void
}) {
  const assetUrl = toAssetUrl(asset.path)
  const previewImageUrl = getPreviewImageUrl(asset, collection.assets)

  return (
    <div className="viewerOverlay" role="dialog" aria-modal="true">
      <div className="viewerBackdrop" onClick={onClose} />

      <div className="viewerShell">
        <div className="viewerTopLayer">
          <div className="viewerInfoCard">
            <p className="sectionTag">Collection Viewer</p>
            <strong className="viewerTitle">{collection.displayName}</strong>
            <p className="viewerMeta">
              {assetIndex + 1} / {collection.assets.length} · {asset.name}
            </p>
          </div>
          <button aria-label="Close viewer" className="featuredFullscreenClose" type="button" onClick={onClose} />
        </div>

        <div className="viewerStage">
          <button aria-label="Previous asset" className="viewerNav viewerNavLeft" type="button" onClick={onPrevious} />

          <div className="viewerMediaFrame">
            {previewImageUrl ? <img alt="" className="viewerBackdropArt" src={previewImageUrl} /> : null}
            {asset.type === 'image' ? (
              <img alt={asset.name} className="viewerImage" src={assetUrl} />
            ) : (
              <video
                autoPlay
                className="viewerVideo"
                controls
                loop
                playsInline
                poster={previewImageUrl ?? undefined}
                src={assetUrl}
              />
            )}
          </div>

          <button aria-label="Next asset" className="viewerNav viewerNavRight" type="button" onClick={onNext} />
        </div>

        <ViewerThumbnailRail
          activeIndex={assetIndex}
          assets={collection.assets}
          onSelect={onSelect}
        />
      </div>
    </div>
  )
}

export default App
