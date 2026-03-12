const supportsFetch = typeof window.fetch === 'function';

function legacyFetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const method = (options.method || 'GET').toUpperCase();
    const targetUrl = typeof url === 'string' ? url : url.toString();

    xhr.open(method, targetUrl, true);

    const headers = options.headers || {};
    if (headers instanceof Headers) {
      headers.forEach((value, key) => xhr.setRequestHeader(key, value));
    } else if (typeof headers === 'object') {
      Object.keys(headers).forEach((key) => xhr.setRequestHeader(key, headers[key]));
    }

    xhr.onload = () => {
      const text = xhr.responseText || '';
      const response = {
        ok: xhr.status >= 200 && xhr.status < 300,
        status: xhr.status,
        json: () => {
          if (!text) return Promise.resolve({});
          try {
            return Promise.resolve(JSON.parse(text));
          } catch (error) {
            return Promise.reject(error);
          }
        },
        text: () => Promise.resolve(text),
      };
      resolve(response);
    };

    xhr.onerror = () => reject(new Error('Network request failed'));
    xhr.send(options.body || null);
  });
}

const httpFetch = supportsFetch ? window.fetch.bind(window) : legacyFetch;

const ENGAGEMENT_STORAGE_KEY = 'familyMediaEngagementV1';
const VIDEO_COMPLETION_THRESHOLD = 0.92;
const VIDEO_BUFFER_MODE_STORAGE_KEY = 'familyVideoBufferModeV1';
const VIDEO_BUFFER_MODES = {
  METADATA: 'metadata',
  AGGRESSIVE: 'aggressive',
};
const DEFAULT_VIDEO_BUFFER_MODE = VIDEO_BUFFER_MODES.AGGRESSIVE;
const DEFAULT_UPSCALE_PROFILES = [
  { key: '2x', label: '2x (fast)' },
  { key: '2x_hq', label: '2x HQ (balanced)' },
  { key: '4x', label: '4x (slow)' },
  { key: '4x_hq', label: '4x HQ (slowest)' },
  { key: 'video_hq', label: 'Video HQ' },
  { key: 'anime', label: 'Anime' },
  { key: 'photo_detail', label: 'Photo detail' },
  { key: 'denoise', label: 'Denoise' },
];
const VIDEO_BUFFER_LIMITS = {
  [VIDEO_BUFFER_MODES.METADATA]: 3,
  [VIDEO_BUFFER_MODES.AGGRESSIVE]: 8,
};

const grid = document.querySelector('.grid');
const statusEl = document.querySelector('.status');
const modal = document.querySelector('.modal');
const modalContent = document.querySelector('.modal-content');
const modalMedia = document.querySelector('.modal-media');
const closeBtn = document.querySelector('.close');
const modalPrevBtn = document.querySelector('.modal-prev');
const modalNextBtn = document.querySelector('.modal-next');
const modalPlayToggleBtn = document.querySelector('.modal-toggle-play');
const modalFullscreenBtn = document.querySelector('.modal-fullscreen');
const filterSelect = document.querySelector('#categoryFilter');
const uploadForm = document.querySelector('#uploadForm');
const uploadTokenInput = document.querySelector('#uploadToken');
const uploadFileInput = document.querySelector('#uploadFile');
const uploadCategorySelect = document.querySelector('#uploadCategorySelect');
const uploadStatus = document.querySelector('.upload-status');
const dropzone = document.querySelector('#uploadDropzone');
const dropFilename = document.querySelector('#dropFilename');
const progressContainer = document.querySelector('.progress');
const progressBar = document.querySelector('.progress-bar');
const progressText = document.querySelector('.progress-text');
const heroUploadButton = document.querySelector('#startUpload');
const uploadSection = document.querySelector('#upload');
const searchInput = document.querySelector('#searchInput');
const sortSelect = document.querySelector('#sortSelect');
const shuffleButton = document.querySelector('#shuffleButton');
const categoryForm = document.querySelector('#categoryForm');
const categoryInput = document.querySelector('#categoryInput');
const categoryStatus = document.querySelector('.category-status');
const categoryList = document.querySelector('#categoryList');
const linkForm = document.querySelector('#linkForm');
const linkUrlInput = document.querySelector('#linkUrl');
const linkNameInput = document.querySelector('#linkName');
const linkCategorySelect = document.querySelector('#linkCategorySelect');
const linkStatus = document.querySelector('.link-status');
const selectAllButton = document.querySelector('#selectAllButton');
const clearSelectionButton = document.querySelector('#clearSelectionButton');
const deleteSelectedButton = document.querySelector('#deleteSelectedButton');
const slideshowButton = document.querySelector('#slideshowButton');
const slideshowDelaySlider = document.querySelector('#slideshowDelay');
const slideshowDelayValue = document.querySelector('#slideshowDelayValue');
const videoBufferToggle = document.querySelector('#videoBufferToggle');
const toolbarStatus = document.querySelector('.toolbar-status');
const upscaleProfileSelect = document.querySelector('#upscaleProfileSelect');

const supportsIntersectionObserver = typeof IntersectionObserver !== 'undefined';
const mediaObserver = supportsIntersectionObserver
  ? new IntersectionObserver(handleMediaVisibility, {
      rootMargin: '200px 0px',
      threshold: 0.25,
    })
  : null;

let allCategories = [];
let categoryLookup = new Map();
let cachedItems = [];
let visibleItems = [];
let selectedPaths = new Set();
let isDeleting = false;
let slideshowTimer = null;
let slideshowItems = [];
let slideshowIndex = 0;
let slideshowDelayMs = 4500;
let isFullscreenActive = false;
const fullscreenApis = [
  {
    request: 'requestFullscreen',
    exit: 'exitFullscreen',
    element: 'fullscreenElement',
    change: 'fullscreenchange',
  },
  {
    request: 'webkitRequestFullscreen',
    exit: 'webkitExitFullscreen',
    element: 'webkitFullscreenElement',
    change: 'webkitfullscreenchange',
  },
  {
    request: 'mozRequestFullScreen',
    exit: 'mozCancelFullScreen',
    element: 'mozFullScreenElement',
    change: 'mozfullscreenchange',
  },
  {
    request: 'msRequestFullscreen',
    exit: 'msExitFullscreen',
    element: 'msFullscreenElement',
    change: 'MSFullscreenChange',
  },
];
let fullscreenApi = null;
let activeModalItem = null;
let lastFocusedElement = null;
let activeModalVideo = null;
let engagementStats = loadEngagementStats();
let videoBufferMode = loadVideoBufferMode();
let upscaleJobs = new Map();
let upscalePollTimer = null;
const activeVideoBuffer = new Map();

filterSelect.addEventListener('change', () => applyFilters());

if (searchInput) searchInput.addEventListener('input', () => applyFilters());

if (sortSelect) sortSelect.addEventListener('change', () => applyFilters());

if (shuffleButton) shuffleButton.addEventListener('click', () => applyFilters({ shuffle: true }));

if (selectAllButton) selectAllButton.addEventListener('click', selectVisibleItems);
if (clearSelectionButton) clearSelectionButton.addEventListener('click', clearSelection);
if (deleteSelectedButton) deleteSelectedButton.addEventListener('click', handleDeleteSelected);
if (slideshowButton) slideshowButton.addEventListener('click', toggleSlideshow);
initializeSlideshowDelay();
initializeVideoBufferToggle();

uploadForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const tokenValue = uploadTokenInput.value.trim();
  const files = Array.from(uploadFileInput.files || []);

  if (!tokenValue) {
    setUploadStatus('Upload token is required', 'error');
    return;
  }

  if (!files.length) {
    setUploadStatus('Choose at least one file to upload', 'error');
    return;
  }

  try {
    const formData = new FormData();
    files.forEach((file) => formData.append('files', file));

    const selectedCategory = uploadCategorySelect.value.trim();
    if (selectedCategory) {
      formData.append('category', selectedCategory);
    }

    setUploadStatus(`Uploading ${files.length} file${files.length > 1 ? 's' : ''}...`);
    const payload = await uploadMedia(formData, tokenValue, {
      onProgress: (percent) => updateProgress(percent, `${files.length} file${files.length > 1 ? 's' : ''}`),
    });

    const results = Array.isArray(payload.results) ? payload.results : [];
    const successes = results.filter((result) => result.status === 'success');
    const failures = results.filter((result) => result.status === 'error');

    uploadForm.reset();
    updateSelectedFiles([]);
    
    uploadTokenInput.value = tokenValue;

    if (results.length) {
      const summary = results
        .map((result) => {
          const icon = result.status === 'success' ? '✅' : '⚠️';
          return `${icon} ${result.name || 'Untitled'}: ${result.message || ''}`.trim();
        })
        .join('\n');
      setUploadStatus(summary, failures.length ? 'error' : 'success');
    } else {
      setUploadStatus('No files were processed', 'error');
    }

    if (successes.length) {
      triggerCelebrate();
    }

    await Promise.all([fetchMedia(), fetchCategories({ preserveSelection: true })]);
  } catch (err) {
    console.error(err);
    setUploadStatus(err.message || 'Unable to upload', 'error');
  } finally {
    progressContainer.hidden = true;
  }
});

if (dropzone) {
  dropzone.addEventListener('dragenter', handleDragEnter);
  dropzone.addEventListener('dragover', handleDragEnter);
  dropzone.addEventListener('dragleave', handleDragLeave);
  dropzone.addEventListener('drop', handleDrop);
}

uploadFileInput.addEventListener('change', () => {
  const files = Array.from(uploadFileInput.files || []);
  updateSelectedFiles(files);
  if (files.length) setUploadStatus(`Ready to upload ${formatFileSummary(files)}`);
});

if (categoryForm) {
  categoryForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const categoryName = categoryInput.value.trim();
    if (!categoryName) {
      setCategoryStatus('Enter a category name', 'error');
      return;
    }

    const tokenValue = uploadTokenInput.value.trim();
    if (!tokenValue) {
      setCategoryStatus('Upload token is required to create categories', 'error');
      return;
    }

    try {
      setCategoryStatus('Saving...');
      const res = await httpFetch('/api/categories', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Upload-Token': tokenValue,
        },
        body: JSON.stringify({ name: categoryName }),
      });
      const createdCategory = await res.json().catch(() => null);
      if (!res.ok) {
        const error = createdCategory || {};
        throw new Error(error.detail || 'Unable to save category. Check your upload token.');
      }
      categoryInput.value = '';
      setCategoryStatus('Category added', 'success');
      const newSelection =
        (createdCategory && (createdCategory.path || createdCategory.name)) || categoryName;
      await fetchCategories({
        preserveSelection: false,
        newSelection,
      });
    } catch (err) {
      console.error(err);
      setCategoryStatus(err.message || 'Unable to save category. Check your upload token.', 'error');
    }
  });
}

if (linkForm) {
  linkForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const tokenValue = uploadTokenInput.value.trim();
    const url = linkUrlInput.value.trim();
    const name = linkNameInput.value.trim();
    const category = linkCategorySelect.value.trim();

    if (!tokenValue) {
      setLinkStatus('Upload token is required', 'error');
      return;
    }

    if (!url) {
      setLinkStatus('Enter an https link to save', 'error');
      return;
    }

    if (!url.toLowerCase().startsWith('https://')) {
      setLinkStatus('Only https links are supported', 'error');
      return;
    }

    try {
      setLinkStatus('Saving link...');
      const res = await httpFetch('/api/links', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Upload-Token': tokenValue,
        },
        body: JSON.stringify({ url, name, category }),
      });

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = payload.detail || payload.message || 'Unable to save link';
        throw new Error(detail);
      }

      setLinkStatus('Link saved', 'success');
      linkForm.reset();
      try {
        linkUrlInput.focus({ preventScroll: true });
      } catch (focusError) {
        linkUrlInput.focus();
      }
      await fetchMedia();
    } catch (err) {
      console.error(err);
      setLinkStatus(err.message || 'Unable to save link', 'error');
    }
  });
}

function uploadMedia(formData, token, { onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/media');
    xhr.setRequestHeader('X-Upload-Token', token);

    const handleProgress = (percent) => {
      if (typeof onProgress === 'function') {
        onProgress(percent);
      } else {
        updateProgress(percent);
      }
    };

    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) {
        const percent = Math.round((event.loaded / event.total) * 100);
        handleProgress(percent);
      }
    });

    xhr.addEventListener('loadstart', () => handleProgress(0));
    xhr.addEventListener('loadend', () => handleProgress(100));

    xhr.onload = () => {
      let parsedResponse = {};
      try {
        parsedResponse = JSON.parse(xhr.responseText || '{}');
      } catch (error) {
        parsedResponse = {};
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(parsedResponse);
        progressContainer.hidden = true;
        return;
      }

      const detail = parsedResponse.detail || parsedResponse.message || 'Upload failed';
      reject(new Error(detail));
    };

    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.send(formData);
  });
}

async function fetchMedia() {
  try {
    statusEl.textContent = 'Loading media...';
    const res = await httpFetch('/api/media');
    if (!res.ok) throw new Error('Failed to load media');
    cachedItems = await res.json();
    reconcileSelection();
    applyFilters();
  } catch (err) {
    console.error(err);
    statusEl.textContent = 'Unable to load media';
  }
}

async function fetchCategories({ preserveSelection = false, newSelection } = {}) {
  const previousFilter = filterSelect.value;
  const previousUpload = uploadCategorySelect.value;

  try {
    const res = await httpFetch('/api/categories');
    if (!res.ok) throw new Error('Failed to load categories');

    const payload = await res.json();
    const categories = Array.isArray(payload) ? payload : payload.categories || [];
    setCategories(categories);

    if (newSelection) {
      uploadCategorySelect.value = newSelection;
      filterSelect.value = newSelection;
    } else if (preserveSelection) {
      filterSelect.value = previousFilter;
      uploadCategorySelect.value = previousUpload;
    }
  } catch (err) {
    console.error(err);
    setCategoryStatus('Unable to load categories', 'error');
  }
}

function normalizeCategories(categories) {
  const normalized = [];
  const seen = new Set();

  for (const category of categories) {
    if (!category) continue;
    const name = (category.name || category.label || '').trim();
    const path = (category.path || category.value || '').trim();
    if (!name) continue;
    const key = `${name}::${path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({ name, path });
  }

  if (![...seen].some((key) => key.endsWith('::'))) {
    normalized.push({ name: 'Uncategorized', path: '' });
  }

  return normalized.sort((a, b) => a.name.localeCompare(b.name));
}

function setCategories(categories) {
  const normalizedCategories = normalizeCategories(categories);
  allCategories = normalizedCategories;
  categoryLookup = new Map(normalizedCategories.map(({ path, name }) => [path || '', name]));

  renderSelectOptions(filterSelect, allCategories, { includeAll: true });
  renderSelectOptions(uploadCategorySelect, allCategories, { includeAll: false });
  renderSelectOptions(linkCategorySelect, allCategories, { includeAll: false });
  renderCategoryList(allCategories);
}

function applyFilters({ shuffle = false } = {}) {
  const query = searchInput ? searchInput.value.trim().toLowerCase() : '';
  const selectedCategory = filterSelect.value;
  const matchAllCategories = selectedCategory === '__all__';
  const context = {
    query,
    selectedCategory: matchAllCategories ? '' : selectedCategory,
    matchAllCategories,
  };

  if (!cachedItems.length) {
    visibleItems = [];
    renderGrid([]);
    updateSelectionUI();
    statusEl.textContent = 'No media uploaded yet';
    return;
  }

  let items = cachedItems.filter((item) => {
    const itemCategoryPath = item.category_path || '';
    const categoryLabel = getCategoryLabel(itemCategoryPath, item.category);
    const matchesCategory =
      matchAllCategories ||
      (selectedCategory === '' && !itemCategoryPath) ||
      selectedCategory === itemCategoryPath;
    const matchesQuery = !query
      ? true
      : item.name.toLowerCase().includes(query) || categoryLabel.toLowerCase().includes(query);
    return matchesCategory && matchesQuery;
  });

  if (shuffle) {
    items = shuffleItems(items);
  } else {
    items = sortItems(items, context);
  }

  visibleItems = items;
  renderGrid(items);
  updateSelectionUI();
  syncSlideshowWithVisibleItems();
  statusEl.textContent = items.length ? '' : 'No items match your filters yet';
}

function sortItems(items, context = {}) {
  const selection = sortSelect ? sortSelect.value : 'recent';
  const copy = [...items];

  if (selection === 'name') {
    return copy.sort((a, b) => a.name.localeCompare(b.name));
  }

  if (selection === 'smart') {
    return copy.sort((a, b) => {
      const scoreDiff = getSmartScore(b, context) - getSmartScore(a, context);
      if (scoreDiff !== 0) return scoreDiff;
      return new Date(b.modified).getTime() - new Date(a.modified).getTime();
    });
  }

  return copy.sort((a, b) => {
    const diff = new Date(a.modified).getTime() - new Date(b.modified).getTime();
    return selection === 'oldest' ? diff : -diff;
  });
}

function getSmartScore(item, context = {}) {
  const now = Date.now();
  const modifiedMs = new Date(item.modified).getTime();
  const ageDays = Number.isFinite(modifiedMs) ? (now - modifiedMs) / (1000 * 60 * 60 * 24) : 180;
  const freshnessScore = Math.max(0, 1 - ageDays / 180);

  const stats = getEngagementEntry(item);
  const openScore = Math.min(1, Math.log1p(stats.opens || 0) / Math.log(10));
  const completionScore = Math.min(1, Math.log1p(stats.completions || 0) / Math.log(6));
  const recencyHours = stats.lastOpenedAt ? (now - stats.lastOpenedAt) / (1000 * 60 * 60) : Number.POSITIVE_INFINITY;
  const recentOpenBonus = Number.isFinite(recencyHours) ? Math.max(0, 1 - recencyHours / 72) : 0;
  const engagementScore = Math.min(1, openScore * 0.55 + completionScore * 0.3 + recentOpenBonus * 0.15);

  const categoryLabel = getCategoryLabel(item.category_path || '', item.category).toLowerCase();
  const name = (item.name || '').toLowerCase();
  const query = (context.query || '').trim().toLowerCase();
  const selectedCategory = context.selectedCategory || '';

  const queryBoost = query && (name.includes(query) || categoryLabel.includes(query)) ? 1 : 0;
  const categoryBoost = selectedCategory && item.category_path === selectedCategory ? 1 : 0;
  const contextBoost = Math.max(queryBoost * 0.08, categoryBoost * 0.12);

  return freshnessScore * 0.58 + engagementScore * 0.34 + contextBoost;
}

function loadEngagementStats() {
  if (typeof window === 'undefined' || !window.localStorage) return {};
  try {
    const raw = window.localStorage.getItem(ENGAGEMENT_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    console.warn('Unable to load engagement stats', error);
    return {};
  }
}

function persistEngagementStats() {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(ENGAGEMENT_STORAGE_KEY, JSON.stringify(engagementStats));
  } catch (error) {
    console.warn('Unable to save engagement stats', error);
  }
}

function getEngagementKey(item) {
  if (!item) return '';
  return item.path || item.url || item.name || '';
}

function getEngagementEntry(item) {
  const key = getEngagementKey(item);
  if (!key) return { opens: 0, completions: 0, lastOpenedAt: 0 };
  const entry = engagementStats[key];
  if (!entry || typeof entry !== 'object') {
    return { opens: 0, completions: 0, lastOpenedAt: 0 };
  }
  return {
    opens: Number(entry.opens) || 0,
    completions: Number(entry.completions) || 0,
    lastOpenedAt: Number(entry.lastOpenedAt) || 0,
  };
}

function updateEngagement(item, changes = {}) {
  const key = getEngagementKey(item);
  if (!key) return;
  const current = getEngagementEntry(item);
  engagementStats[key] = {
    opens: Math.max(0, current.opens + (changes.opens || 0)),
    completions: Math.max(0, current.completions + (changes.completions || 0)),
    lastOpenedAt: changes.lastOpenedAt || current.lastOpenedAt || 0,
  };
  persistEngagementStats();
}

function handleModalVideoTimeUpdate(event) {
  if (!activeModalItem) return;
  const video = event.currentTarget;
  const duration = Number(video.duration);
  const currentTime = Number(video.currentTime);
  if (!duration || !Number.isFinite(duration) || !Number.isFinite(currentTime)) return;

  const completionRatio = currentTime / duration;
  if (completionRatio >= VIDEO_COMPLETION_THRESHOLD && video.dataset.completionCaptured !== 'true') {
    video.dataset.completionCaptured = 'true';
    updateEngagement(activeModalItem, { completions: 1 });
    if (sortSelect && sortSelect.value === 'smart') {
      applyFilters();
    }
  }
}

function bindModalVideoTracking(item, mediaEl) {
  activeModalVideo = mediaEl;
  mediaEl.dataset.completionCaptured = 'false';
  mediaEl.addEventListener('timeupdate', handleModalVideoTimeUpdate);
}

function clearModalVideoTracking() {
  if (!activeModalVideo) return;
  activeModalVideo.removeEventListener('timeupdate', handleModalVideoTimeUpdate);
  activeModalVideo = null;
}

function shuffleItems(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function reconcileSelection() {
  const validPaths = new Set(cachedItems.map((item) => item.path));
  for (const path of Array.from(selectedPaths)) {
    if (!validPaths.has(path)) {
      selectedPaths.delete(path);
    }
  }
  updateSelectionUI();
}

function selectVisibleItems() {
  if (!visibleItems.length) return;
  if (toolbarStatus) toolbarStatus.dataset.state = 'info';
  visibleItems.forEach((item) => selectedPaths.add(item.path));
  updateSelectionUI();
  renderGrid(visibleItems);
}

function clearSelection() {
  if (toolbarStatus) toolbarStatus.dataset.state = 'info';
  selectedPaths = new Set();
  updateSelectionUI();
  renderGrid(visibleItems);
}

function toggleSelection(path, isSelected) {
  if (toolbarStatus) toolbarStatus.dataset.state = 'info';
  if (isSelected) {
    selectedPaths.add(path);
  } else {
    selectedPaths.delete(path);
  }
  updateSelectionUI();
}

function updateSelectionUI({ preserveStatus = false } = {}) {
  const count = selectedPaths.size;
  if (deleteSelectedButton) {
    deleteSelectedButton.disabled = !count || isDeleting;
  }
  if (clearSelectionButton) {
    clearSelectionButton.disabled = !count || isDeleting;
  }
  if (selectAllButton) {
    selectAllButton.disabled = !cachedItems.length;
  }

  const shouldUpdateStatus =
    !preserveStatus && (!toolbarStatus || !toolbarStatus.textContent || toolbarStatus.dataset.state === 'info');

  if (shouldUpdateStatus) {
    setToolbarStatus(
      count ? `${count} item${count === 1 ? '' : 's'} selected` : 'No items selected',
      'info'
    );
  }
}

function syncSlideshowWithVisibleItems() {
  if (!slideshowButton) return;
  const pictureItems = getPictureItems(visibleItems);
  slideshowButton.disabled = !pictureItems.length;

  if (slideshowTimer) {
    if (!pictureItems.length) {
      stopSlideshow({ silent: true });
      setToolbarStatus('Auto display stopped — nothing to show', 'info');
      return;
    }
    slideshowItems = pictureItems;
    slideshowIndex = slideshowIndex % slideshowItems.length;
    setSlideshowButtonState(true, slideshowItems.length);
  }
}


function loadVideoBufferMode() {
  const storedMode = localStorage.getItem(VIDEO_BUFFER_MODE_STORAGE_KEY);
  if (storedMode === VIDEO_BUFFER_MODES.METADATA || storedMode === VIDEO_BUFFER_MODES.AGGRESSIVE) {
    return storedMode;
  }
  return DEFAULT_VIDEO_BUFFER_MODE;
}

function isAggressiveVideoBufferEnabled() {
  return videoBufferMode === VIDEO_BUFFER_MODES.AGGRESSIVE;
}

function initializeVideoBufferToggle() {
  if (!videoBufferToggle) return;

  videoBufferToggle.checked = isAggressiveVideoBufferEnabled();
  videoBufferToggle.addEventListener('change', () => {
    videoBufferMode = videoBufferToggle.checked ? VIDEO_BUFFER_MODES.AGGRESSIVE : VIDEO_BUFFER_MODES.METADATA;
    localStorage.setItem(VIDEO_BUFFER_MODE_STORAGE_KEY, videoBufferMode);
    refreshVisibleVideoBuffering();
  });
}

function refreshVisibleVideoBuffering() {
  const videos = grid ? grid.querySelectorAll('video') : [];
  const intersectingVideos = [];
  const nonIntersectingVideos = [];

  videos.forEach((videoEl) => {
    videoEl.preload = isAggressiveVideoBufferEnabled() ? 'auto' : 'none';
    if (videoEl.dataset.intersecting === 'true' && videoEl.dataset.src && !videoEl.dataset.loaded) {
      videoEl.src = videoEl.dataset.src;
      videoEl.dataset.loaded = 'true';
      trackVideoBuffer(videoEl, { forceTouch: true });
    }
    if (videoEl.dataset.intersecting === 'true') {
      intersectingVideos.push(videoEl);
    } else {
      nonIntersectingVideos.push(videoEl);
    }
    if (videoEl.dataset.loaded === 'true') {
      videoEl.load();
    }
  });

  intersectingVideos.forEach((videoEl) => trackVideoBuffer(videoEl, { forceTouch: true }));
  nonIntersectingVideos.forEach((videoEl) => trackVideoBuffer(videoEl));
  enforceVideoBufferBudget();
}

function releaseVideoMemory(videoEl) {
  if (!videoEl || videoEl.tagName !== 'VIDEO') return;
  untrackVideoBuffer(videoEl);
  videoEl.pause();
  videoEl.removeAttribute('src');
  videoEl.src = '';
  videoEl.dataset.loaded = 'false';
  videoEl.load();
}

function getVideoBufferLimit() {
  return VIDEO_BUFFER_LIMITS[videoBufferMode] || VIDEO_BUFFER_LIMITS[VIDEO_BUFFER_MODES.METADATA];
}

function getVideoPriority(videoEl, preferredVideo) {
  if (!videoEl) return -1;
  if (videoEl === preferredVideo) return 100;

  let priority = 0;
  if (videoEl === activeModalVideo) priority += 60;
  if (videoEl.dataset.intersecting === 'true') priority += 20;
  if (videoEl.dataset.shouldPlay === 'true') priority += 15;
  if (document.activeElement === videoEl) priority += 10;
  return priority;
}

function trackVideoBuffer(videoEl, { forceTouch = false } = {}) {
  if (!videoEl || videoEl.tagName !== 'VIDEO' || videoEl.dataset.loaded !== 'true') return;

  if (!activeVideoBuffer.has(videoEl) || forceTouch) {
    activeVideoBuffer.delete(videoEl);
    activeVideoBuffer.set(videoEl, Date.now());
  }
}

function untrackVideoBuffer(videoEl) {
  if (!videoEl || videoEl.tagName !== 'VIDEO') return;
  activeVideoBuffer.delete(videoEl);
}

function enforceVideoBufferBudget(preferredVideo) {
  const maxResidentVideos = getVideoBufferLimit();
  while (activeVideoBuffer.size > maxResidentVideos) {
    let candidate = null;
    let candidatePriority = Number.POSITIVE_INFINITY;
    let candidateTouchedAt = Number.POSITIVE_INFINITY;

    activeVideoBuffer.forEach((touchedAt, videoEl) => {
      if (!videoEl || videoEl === preferredVideo || videoEl === activeModalVideo) return;
      const priority = getVideoPriority(videoEl, preferredVideo);
      if (priority < candidatePriority || (priority === candidatePriority && touchedAt < candidateTouchedAt)) {
        candidate = videoEl;
        candidatePriority = priority;
        candidateTouchedAt = touchedAt;
      }
    });

    if (!candidate) break;
    releaseVideoMemory(candidate);
  }
}

function initializeSlideshowDelay() {
  if (!slideshowDelaySlider) return;
  const storedSeconds = Number(localStorage.getItem('slideshowDelaySeconds'));
  const sliderSeconds = Number(slideshowDelaySlider.value) || 4.5;
  const seconds = Number.isFinite(storedSeconds) && storedSeconds > 0 ? storedSeconds : sliderSeconds;
  slideshowDelayMs = seconds * 1000;
  slideshowDelaySlider.value = seconds.toString();
  updateSlideshowDelayLabel(seconds);

  slideshowDelaySlider.addEventListener('input', () => {
    const secondsValue = Number(slideshowDelaySlider.value) || 4.5;
    slideshowDelayMs = secondsValue * 1000;
    localStorage.setItem('slideshowDelaySeconds', secondsValue.toString());
    updateSlideshowDelayLabel(secondsValue);
    if (slideshowTimer) {
      restartSlideshowTimer();
      setToolbarStatus(`Auto display pacing set to ${formatSeconds(secondsValue)} per slide`, 'info');
    }
  });
}

function toggleSlideshow() {
  if (slideshowTimer) {
    stopSlideshow();
  } else {
    startSlideshow();
  }
}

function startSlideshow() {
  const pictureItems = getPictureItems(visibleItems);
  if (!pictureItems.length) {
    setToolbarStatus('No pictures to auto display yet', 'error');
    return;
  }

  slideshowItems = pictureItems;
  slideshowIndex = 0;
  setSlideshowButtonState(true, slideshowItems.length);
  setToolbarStatus(
    `Auto display cycling through ${slideshowItems.length} item${slideshowItems.length === 1 ? '' : 's'}`,
    'info'
  );

  enterFullscreenForSlideshow();
  openModal(slideshowItems[slideshowIndex], { fromSlideshow: true });
  restartSlideshowTimer();
  updateModalControls();
}

function stopSlideshow({ silent = false } = {}) {
  if (slideshowTimer) {
    window.clearInterval(slideshowTimer);
    slideshowTimer = null;
  }
  slideshowItems = [];
  setSlideshowButtonState(false);
  exitSlideshowFullscreen();
  if (!silent) {
    setToolbarStatus('Auto display stopped', 'info');
  }
  updateModalControls();
}

function setSlideshowButtonState(isActive, total = slideshowItems.length || 0) {
  if (!slideshowButton) return;
  slideshowButton.dataset.active = isActive ? 'true' : 'false';
  slideshowButton.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  slideshowButton.textContent = isActive ? 'Stop auto display' : 'Auto display';
  slideshowButton.title = isActive
    ? `Cycling through ${total} picture${total === 1 ? '' : 's'}`
    : 'Automatically open each picture in view';
}

function getPictureItems(items) {
  return (items || []).filter((item) => item && item.source !== 'link');
}

function restartSlideshowTimer() {
  if (slideshowTimer) {
    window.clearInterval(slideshowTimer);
  }
  slideshowTimer = window.setInterval(nextSlide, slideshowDelayMs);
}

function nextSlide() {
  if (!slideshowItems.length) {
    stopSlideshow({ silent: true });
    return;
  }

  slideshowIndex = (slideshowIndex + 1) % slideshowItems.length;
  openModal(slideshowItems[slideshowIndex], { fromSlideshow: true });
  updateModalControls();
}

function updateSlideshowDelayLabel(seconds) {
  if (!slideshowDelayValue) return;
  slideshowDelayValue.textContent = formatSeconds(seconds);
}

function formatSeconds(seconds) {
  return seconds % 1 === 0 ? `${seconds.toFixed(0)}s` : `${seconds.toFixed(1)}s`;
}

function resolveFullscreenApi() {
  if (fullscreenApi) return fullscreenApi;
  const target = document.documentElement;
  fullscreenApi = fullscreenApis.find(({ request }) => target && typeof target[request] === 'function') || null;
  return fullscreenApi;
}

function getActiveFullscreenElement() {
  const api = resolveFullscreenApi();
  if (!api) return document.fullscreenElement || null;
  return document[api.element] || document.fullscreenElement || null;
}

function watchFullscreenChanges() {
  fullscreenApis.forEach(({ change }) => {
    if (!change) return;
    document.addEventListener(change, () => {
      isFullscreenActive = Boolean(getActiveFullscreenElement());
    });
  });
}

async function handleDeleteSelected() {
  const paths = Array.from(selectedPaths);
  if (!paths.length || isDeleting) return;

  const token = uploadTokenInput.value.trim();
  if (!token) {
    setToolbarStatus('Upload token is required to delete media', 'error');
    try {
      uploadTokenInput.focus({ preventScroll: true });
    } catch (error) {
      uploadTokenInput.focus();
    }
    return;
  }

  isDeleting = true;
  updateSelectionUI({ preserveStatus: true });
  setToolbarStatus(`Deleting ${paths.length} item${paths.length === 1 ? '' : 's'}...`);

  try {
    let res;
    let payload = {};

    if (paths.length === 1) {
      const url = `/api/media?path=${encodeURIComponent(paths[0])}`;
      res = await httpFetch(url, {
        method: 'DELETE',
        headers: { 'X-Upload-Token': token },
      });
    } else {
      res = await httpFetch('/api/media/batch', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'X-Upload-Token': token,
        },
        body: JSON.stringify(paths),
      });
    }

    payload = await res.json().catch(() => ({}));

    if (!res.ok) {
      const detail = payload.detail || payload.message || 'Unable to delete selection';
      throw new Error(detail);
    }

    if (paths.length === 1) {
      setToolbarStatus(`Deleted ${payload.path || paths[0]}`, 'success');
      selectedPaths = new Set();
    } else {
      const results = Array.isArray(payload.results) ? payload.results : [];
      const summary = formatDeletionResults(results, paths.length);
      const state = res.status === 207 ? 'error' : 'success';
      setToolbarStatus(summary, state);
      retainFailedSelections(results);
    }

    await fetchMedia();
  } catch (err) {
    console.error(err);
    setToolbarStatus(err.message || 'Unable to delete selection', 'error');
  } finally {
    isDeleting = false;
    updateSelectionUI({ preserveStatus: true });
  }
}

function retainFailedSelections(results) {
  if (!Array.isArray(results)) {
    selectedPaths = new Set();
    return;
  }
  const failed = results
    .filter((result) => result.status === 'error')
    .map((result) => result.path)
    .filter(Boolean);
  selectedPaths = new Set(failed);
}

function formatDeletionResults(results, requestedCount) {
  if (!Array.isArray(results) || !results.length) {
    return `Deleted ${requestedCount} item${requestedCount === 1 ? '' : 's'}`;
  }

  const successes = results.filter((result) => result.status === 'success').length;
  const errors = results.length - successes;
  const errorDetails = results
    .filter((result) => result.status === 'error')
    .map((result) => `${result.path}: ${result.message}`)
    .slice(0, 3)
    .join('; ');

  if (!errors) return `Deleted ${successes} item${successes === 1 ? '' : 's'}`;

  return `${successes} deleted, ${errors} failed${errorDetails ? ` (${errorDetails})` : ''}`;
}

function renderSelectOptions(select, categories, { includeAll = false } = {}) {
  select.innerHTML = '';
  if (includeAll) {
    const allOption = document.createElement('option');
    allOption.value = '__all__';
    allOption.textContent = 'All categories';
    select.appendChild(allOption);
  }

  for (const category of categories) {
    const option = document.createElement('option');
    option.value = category.path || '';
    option.textContent = category.name;
    select.appendChild(option);
  }
}

function renderCategoryList(categories) {
  if (!categoryList) return;
  categoryList.innerHTML = '';

  if (!categories.length) {
    const empty = document.createElement('li');
    empty.textContent = 'No categories yet';
    categoryList.appendChild(empty);
    return;
  }

  for (const category of categories) {
    const item = document.createElement('li');
    item.className = 'category-chip';

    const labelButton = document.createElement('button');
    labelButton.type = 'button';
    labelButton.className = 'label';
    labelButton.textContent = category.name;
    labelButton.setAttribute('aria-label', `Filter by ${category.name}`);
    labelButton.addEventListener('click', () => {
      filterSelect.value = category.path || '';
      uploadCategorySelect.value = category.path || '';
      applyFilters();
    });

    if (category.path) {
      const actions = document.createElement('div');
      actions.className = 'category-actions';

      const renameButton = document.createElement('button');
      renameButton.type = 'button';
      renameButton.textContent = 'Rename';
      renameButton.setAttribute('aria-label', `Rename ${category.name}`);
      renameButton.addEventListener('click', (event) => {
        event.stopPropagation();
        promptRenameCategory(category);
      });

      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.textContent = 'Delete';
      deleteButton.setAttribute('aria-label', `Delete ${category.name}`);
      deleteButton.addEventListener('click', (event) => {
        event.stopPropagation();
        removeCategory(category);
      });

      actions.append(renameButton, deleteButton);
      item.append(labelButton, actions);
    } else {
      item.append(labelButton);
    }
    categoryList.appendChild(item);
  }
}

async function removeCategory(category) {
  try {
    setCategoryStatus(`Deleting ${category.name}...`);
    const tokenValue = uploadTokenInput.value.trim();
    if (!tokenValue) {
      setCategoryStatus('Upload token is required to delete categories', 'error');
      return;
    }

    const res = await httpFetch(`/api/categories/${encodeURIComponent(category.name)}`, {
      method: 'DELETE',
      headers: { 'X-Upload-Token': tokenValue },
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(payload.detail || 'Unable to delete category. Check your upload token.');
    }

    const wasSelected = filterSelect.value === (category.path || '');
    if (wasSelected) {
      filterSelect.value = '__all__';
      uploadCategorySelect.value = '';
      applyFilters();
    }

    setCategoryStatus('Category deleted', 'success');
    await fetchCategories({ preserveSelection: true });
  } catch (err) {
    console.error(err);
    setCategoryStatus(err.message || 'Unable to delete category. Check your upload token.', 'error');
  }
}

async function promptRenameCategory(category) {
  const newName = window.prompt('Rename category', category.name);
  if (newName === null) return;

  const trimmedName = newName.trim();
  const payload = {};
  if (trimmedName && trimmedName !== category.name) {
    payload.name = trimmedName;
  }

  const newPath = window.prompt('Update folder name (leave blank to keep current)', category.path || category.name);
  if (newPath !== null) {
    const trimmedPath = newPath.trim();
    if (trimmedPath && trimmedPath !== category.path) {
      payload.path = trimmedPath;
    }
  }

  if (!payload.name && !payload.path) {
    setCategoryStatus('No changes to apply', 'info');
    return;
  }

  const tokenValue = uploadTokenInput.value.trim();
  if (!tokenValue) {
    setCategoryStatus('Upload token is required to update categories', 'error');
    return;
  }

  try {
    setCategoryStatus('Updating category...');
    const res = await httpFetch(`/api/categories/${encodeURIComponent(category.name)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Upload-Token': tokenValue,
      },
      body: JSON.stringify(payload),
    });

    const updatedCategory = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(updatedCategory.detail || 'Unable to rename category. Check your upload token.');
    }

    const newSelection = updatedCategory.path || payload.path || payload.name || category.path || '';
    setCategoryStatus('Category updated', 'success');
    await fetchCategories({ preserveSelection: false, newSelection });
    applyFilters();
  } catch (err) {
    console.error(err);
    setCategoryStatus(err.message || 'Unable to rename category. Check your upload token.', 'error');
  }
}




function populateUpscaleProfiles(profiles) {
  if (!upscaleProfileSelect) return;
  const current = upscaleProfileSelect.value || '2x';
  upscaleProfileSelect.innerHTML = '';

  profiles.forEach((profile) => {
    if (!profile || !profile.key) return;
    const option = document.createElement('option');
    option.value = profile.key;
    option.textContent = profile.label || profile.key;
    upscaleProfileSelect.appendChild(option);
  });

  upscaleProfileSelect.value = profiles.some((p) => p.key === current) ? current : (profiles[0] && profiles[0].key) || '2x';
}

async function fetchUpscaleProfiles() {
  if (!upscaleProfileSelect) return;
  try {
    const res = await httpFetch('/api/upscale/profiles');
    const payload = await res.json().catch(() => ({}));
    if (!res.ok || !Array.isArray(payload.profiles) || !payload.profiles.length) {
      throw new Error('Invalid upscale profile payload');
    }
    populateUpscaleProfiles(payload.profiles);
  } catch (error) {
    populateUpscaleProfiles(DEFAULT_UPSCALE_PROFILES);
  }
}

function isUpscaleSupportedItem(item) {
  if (!item || item.source === 'link') return false;
  return item.mime_type.startsWith('image/') || item.mime_type.startsWith('video/');
}

function getUpscaleStatus(item) {
  const job = upscaleJobs.get(item.path);
  if (!job) return null;
  if (job.state === 'completed' && job.output_path) return `Done (${job.profile})`;
  if (job.state === 'failed') return `Failed (${job.error || 'error'})`;
  return `${job.state} (${job.profile})`;
}

async function submitUpscale(item) {
  const tokenValue = uploadTokenInput.value.trim();
  if (!tokenValue) {
    setToolbarStatus('Upload token is required to run upscale jobs', 'error');
    return;
  }

  const profile = upscaleProfileSelect ? upscaleProfileSelect.value : '2x';
  try {
    setToolbarStatus(`Queueing upscale (${profile}) for ${item.name}...`, 'info');
    const res = await httpFetch('/api/upscale', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Upload-Token': tokenValue,
      },
      body: JSON.stringify({ path: item.path, profile, overwrite: false }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(payload.detail || 'Unable to queue upscale job');
    }

    upscaleJobs.set(item.path, { id: payload.job_id, state: payload.state, profile });
    startUpscalePolling();
    renderGrid(visibleItems);
    setToolbarStatus(`Upscale job queued for ${item.name}`, 'success');
  } catch (err) {
    console.error(err);
    setToolbarStatus(err.message || 'Unable to queue upscale job', 'error');
  }
}

async function cancelUpscale(itemPath) {
  const tokenValue = uploadTokenInput.value.trim();
  const job = upscaleJobs.get(itemPath);
  if (!tokenValue || !job || !job.id) return;

  try {
    const res = await httpFetch(`/api/upscale/${encodeURIComponent(job.id)}`, {
      method: 'DELETE',
      headers: { 'X-Upload-Token': tokenValue },
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      throw new Error(payload.detail || 'Unable to cancel upscale job');
    }
    setToolbarStatus('Upscale job cancelled', 'info');
    await pollUpscaleJobs();
  } catch (err) {
    console.error(err);
    setToolbarStatus(err.message || 'Unable to cancel upscale job', 'error');
  }
}

function startUpscalePolling() {
  if (upscalePollTimer) return;
  upscalePollTimer = window.setInterval(pollUpscaleJobs, 2000);
}

function stopUpscalePolling() {
  if (!upscalePollTimer) return;
  window.clearInterval(upscalePollTimer);
  upscalePollTimer = null;
}

async function pollUpscaleJobs() {
  if (!upscaleJobs.size) {
    stopUpscalePolling();
    return;
  }

  const tracked = Array.from(upscaleJobs.entries());
  let hasActive = false;
  for (const [itemPath, meta] of tracked) {
    if (!meta.id) continue;
    try {
      const res = await httpFetch(`/api/upscale/${encodeURIComponent(meta.id)}`);
      if (!res.ok) continue;
      const payload = await res.json();
      const job = payload.job || {};
      upscaleJobs.set(itemPath, {
        id: job.id,
        state: job.state,
        profile: job.profile,
        output_path: job.output_path,
        output_url: job.output_url,
        error: job.error,
      });
      if (job.state === 'queued' || job.state === 'running') {
        hasActive = true;
      }
    } catch (error) {
      console.warn('Unable to poll upscale job', error);
      hasActive = true;
    }
  }

  renderGrid(visibleItems);
  const completed = Array.from(upscaleJobs.values()).find((job) => job.state === 'completed');
  if (completed) {
    setToolbarStatus('Upscale complete — open result from card action', 'success');
  }

  if (!hasActive) {
    stopUpscalePolling();
    fetchMedia();
  }
}

async function promptChangeItemCategory(item) {
  if (!item || !item.path) return;

  const tokenValue = uploadTokenInput.value.trim();
  if (!tokenValue) {
    setToolbarStatus('Upload token is required to edit categories', 'error');
    return;
  }

  const currentLabel = getCategoryLabel(item.category_path, item.category);
  const response = window.prompt(
    `Set category for ${item.name}.\nUse category name or folder path. Leave blank for Uncategorized.`,
    item.category_path || item.category || ''
  );

  if (response === null) return;

  const requestedCategory = response.trim();
  if (!requestedCategory && !item.category_path && !item.category) {
    setToolbarStatus(`${item.name} is already Uncategorized`, 'info');
    return;
  }

  try {
    setToolbarStatus(`Updating category for ${item.name}...`, 'info');
    const res = await httpFetch('/api/media/category', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Upload-Token': tokenValue,
      },
      body: JSON.stringify({
        path: item.path,
        category: requestedCategory || null,
      }),
    });

    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(payload.detail || 'Unable to update item category');
    }

    const updatedLabel = payload.category || getCategoryLabel(payload.category_path || '', payload.category);
    setToolbarStatus(
      `${item.name}: ${currentLabel} → ${updatedLabel || 'Uncategorized'}`,
      'success'
    );
    await Promise.all([fetchMedia(), fetchCategories({ preserveSelection: true })]);
  } catch (error) {
    console.error(error);
    setToolbarStatus(error.message || 'Unable to update item category', 'error');
  }
}


function renderGrid(items) {
  if (mediaObserver && mediaObserver.disconnect) {
    mediaObserver.disconnect();
  }
  grid.innerHTML = '';
  for (const item of items) {
    const card = document.createElement('article');
    card.className = 'card';
    card.dataset.selected = selectedPaths.has(item.path);
    card.tabIndex = 0;

    const { mediaEl, isVideo } = createMediaElement(item);

    const selectToggle = document.createElement('label');
    selectToggle.className = 'select-toggle';
    selectToggle.setAttribute('aria-label', `Select ${item.name}`);

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = selectedPaths.has(item.path);
    checkbox.addEventListener('click', (event) => event.stopPropagation());
    checkbox.addEventListener('change', (event) => {
      const checked = event.target.checked;
      toggleSelection(item.path, checked);
      card.dataset.selected = checked;
    });

    const checkboxLabel = document.createElement('span');
    checkboxLabel.textContent = 'Select';
    selectToggle.append(checkbox, checkboxLabel);

    const meta = document.createElement('div');
    meta.className = 'meta';
    const categoryLabel = getCategoryLabel(item.category_path, item.category);
    meta.innerHTML = `
      <div class="badge">${categoryLabel}</div>
      <strong>${item.name}</strong>
      <span>${new Date(item.modified).toLocaleString()}</span>
    `;

    const cardActions = document.createElement('div');
    cardActions.className = 'card-actions';

    const categoryButton = document.createElement('button');
    categoryButton.type = 'button';
    categoryButton.className = 'card-action';
    categoryButton.textContent = 'Category';
    categoryButton.addEventListener('click', (event) => {
      event.stopPropagation();
      promptChangeItemCategory(item);
    });
    cardActions.appendChild(categoryButton);

    if (isUpscaleSupportedItem(item)) {
      const upscaleButton = document.createElement('button');
      upscaleButton.type = 'button';
      upscaleButton.className = 'card-action';
      upscaleButton.textContent = 'Upscale';
      upscaleButton.addEventListener('click', (event) => {
        event.stopPropagation();
        submitUpscale(item);
      });
      cardActions.appendChild(upscaleButton);

      const jobStatus = getUpscaleStatus(item);
      const job = upscaleJobs.get(item.path);
      if (jobStatus) {
        const statusBadge = document.createElement('span');
        statusBadge.className = 'badge upscale-status';
        statusBadge.textContent = jobStatus;
        cardActions.appendChild(statusBadge);
      }

      if (job && job.state === 'completed' && job.output_url) {
        const openResult = document.createElement('a');
        openResult.className = 'card-action';
        openResult.href = getResolvedMediaUrl(job.output_url);
        openResult.target = '_blank';
        openResult.rel = 'noopener';
        openResult.textContent = 'Open result';
        openResult.addEventListener('click', (event) => event.stopPropagation());
        cardActions.appendChild(openResult);
      }

      if (job && (job.state === 'queued' || job.state === 'running')) {
        const cancelButton = document.createElement('button');
        cancelButton.type = 'button';
        cancelButton.className = 'card-action';
        cancelButton.textContent = 'Cancel';
        cancelButton.addEventListener('click', (event) => {
          event.stopPropagation();
          cancelUpscale(item.path);
        });
        cardActions.appendChild(cancelButton);
      }
    }

    card.append(selectToggle, mediaEl, meta, cardActions);
    card.addEventListener('click', (event) => {
      if (event.target.closest('.select-toggle')) return;
      openModal(item);
    });
    card.addEventListener('keydown', (event) => {
      if (event.target !== card) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openModal(item);
      }
    });
    grid.appendChild(card);
  }
}

function setUploadStatus(message, state = 'info') {
  uploadStatus.textContent = message;
  uploadStatus.dataset.state = state;
  uploadStatus.classList.remove('pop');
  void uploadStatus.offsetWidth;
  uploadStatus.classList.add('pop');
}

function setLinkStatus(message, state = 'info') {
  if (!linkStatus) return;
  linkStatus.textContent = message;
  linkStatus.dataset.state = state;
  linkStatus.classList.remove('pop');
  void linkStatus.offsetWidth;
  linkStatus.classList.add('pop');
}

function setCategoryStatus(message, state = 'info') {
  if (!categoryStatus) return;
  categoryStatus.textContent = message;
  categoryStatus.dataset.state = state;
  categoryStatus.classList.remove('pop');
  void categoryStatus.offsetWidth;
  categoryStatus.classList.add('pop');
}

function setToolbarStatus(message, state = 'info') {
  if (!toolbarStatus) return;
  toolbarStatus.textContent = message;
  toolbarStatus.dataset.state = state;
}

function updateProgress(percent, label) {
  progressContainer.hidden = false;
  progressBar.style.width = `${percent}%`;
  progressText.textContent = label ? `${percent}% • ${label}` : `${percent}%`;
}

function handleDragEnter(event) {
  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy';
  }
  dropzone.classList.add('is-dragover');
  setUploadStatus('Drop to upload your media');
}

function handleDragLeave(event) {
  event.preventDefault();
  if (!dropzone.contains(event.relatedTarget)) {
    dropzone.classList.remove('is-dragover');
  }
}

function handleDrop(event) {
  event.preventDefault();
  dropzone.classList.remove('is-dragover');
  const files = event.dataTransfer ? event.dataTransfer.files : null;
  if (!files || !files.length) return;
  assignFiles(files);
}

function assignFiles(files) {
  if (!files || !files.length) return;
  let assignedFiles = files;

  if (typeof DataTransfer !== 'undefined') {
    const dataTransfer = new DataTransfer();
    Array.from(files).forEach((file) => dataTransfer.items.add(file));
    assignedFiles = dataTransfer.files;
    uploadFileInput.files = assignedFiles;
  } else {
    uploadFileInput.files = files;
  }

  const selected = Array.from(uploadFileInput.files || []);
  updateSelectedFiles(selected);
  setUploadStatus(`Ready to upload ${formatFileSummary(selected)}`);
}

function updateSelectedFiles(files) {
  if (files.length) {
    dropFilename.textContent = formatFileSummary(files);
    dropzone.classList.add('has-file');
  } else {
    dropFilename.textContent = 'Drop or choose files';
    dropzone.classList.remove('has-file');
  }
}

function formatFileSummary(files) {
  if (!files.length) return 'no files';
  if (files.length === 1) return files[0].name;
  return `${files[0].name} (+${files.length - 1} more)`;
}

function triggerCelebrate() {
  dropzone.classList.add('celebrate');
  setTimeout(() => dropzone.classList.remove('celebrate'), 1200);
}

function smoothScrollToSection(target) {
  if (!target || !target.scrollIntoView) return;
  try {
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    target.scrollIntoView();
  }
}

function getCategoryLabel(categoryPath, fallbackName) {
  const normalizedPath = categoryPath || '';
  return categoryLookup.get(normalizedPath) || fallbackName || 'Uncategorized';
}

function syncModalSequence(item) {
  const pictureItems = getPictureItems(visibleItems);
  slideshowItems = pictureItems;
  if (!slideshowItems.length) {
    slideshowIndex = 0;
    return;
  }
  const foundIndex = slideshowItems.findIndex((entry) => entry.path === item.path);
  slideshowIndex = foundIndex >= 0 ? foundIndex : slideshowIndex % slideshowItems.length;
}

function openModal(item, { fromSlideshow = false } = {}) {
  if (!item) return;

  const previousVideo = activeModalVideo;
  clearModalVideoTracking();
  releaseVideoMemory(previousVideo);
  updateEngagement(item, { opens: 1, lastOpenedAt: Date.now() });
  if (sortSelect && sortSelect.value === 'smart') {
    applyFilters();
  }

  if (item.source === 'link') {
    const targetUrl = getResolvedMediaUrl(item.url);
    window.open(targetUrl, '_blank', 'noopener');
    modal.classList.remove('open');
    return;
  }

  if (!modal.classList.contains('open')) {
    lastFocusedElement = document.activeElement;
  }

  syncModalSequence(item);
  activeModalItem = item;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  modal.dataset.slideshow = fromSlideshow ? 'true' : 'false';

  const isVideo = item.mime_type.startsWith('video');
  const mediaEl = document.createElement(isVideo ? 'video' : 'img');
  const previewUrl = getPreviewUrl(item);
  const fullUrl = isVideo ? getPlaybackUrl(item) : getResolvedMediaUrl(item.url);

  mediaEl.src = fullUrl;
  if (!isVideo) {
    mediaEl.loading = 'lazy';
    mediaEl.decoding = 'async';
  } else if (previewUrl) {
    mediaEl.poster = previewUrl;
  }
  if (isVideo) {
    mediaEl.controls = true;
    mediaEl.playsInline = true;
    mediaEl.autoplay = true;
    mediaEl.dataset.loaded = 'true';
    trackVideoBuffer(mediaEl, { forceTouch: true });
    if (!mediaEl.loop) {
      mediaEl.addEventListener(
        'ended',
        () => {
          releaseVideoMemory(mediaEl);
        },
        { once: true }
      );
    }
    enforceVideoBufferBudget(mediaEl);
    bindModalVideoTracking(item, mediaEl);
  }

  modalMedia.innerHTML = '';
  modalMedia.append(mediaEl);
  updateModalControls();
  try {
    modalContent.focus({ preventScroll: true });
  } catch (error) {
    modalContent.focus();
  }
}

function closeModal({ stopAutoDisplay = true } = {}) {
  const previousVideo = activeModalVideo;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  activeModalItem = null;
  clearModalVideoTracking();
  releaseVideoMemory(previousVideo);
  exitSlideshowFullscreen();
  if (stopAutoDisplay && slideshowTimer) {
    stopSlideshow({ silent: true });
  }

  const focusTarget = lastFocusedElement;
  lastFocusedElement = null;
  if (focusTarget && typeof focusTarget.focus === 'function' && document.contains(focusTarget)) {
    try {
      focusTarget.focus({ preventScroll: true });
    } catch (error) {
      focusTarget.focus();
    }
  }
}

function updateModalControls() {
  const hasSequence = slideshowItems.length > 1;
  if (modalPrevBtn) modalPrevBtn.disabled = !hasSequence;
  if (modalNextBtn) modalNextBtn.disabled = !hasSequence;
  if (modalPlayToggleBtn) {
    const playing = Boolean(slideshowTimer);
    modalPlayToggleBtn.textContent = playing ? 'Pause' : 'Play';
    modalPlayToggleBtn.setAttribute('aria-label', playing ? 'Pause slideshow' : 'Play slideshow');
  }
}

function showPreviousSlide() {
  if (!slideshowItems.length) return;

  slideshowIndex = (slideshowIndex - 1 + slideshowItems.length) % slideshowItems.length;
  openModal(slideshowItems[slideshowIndex], { fromSlideshow: true });
  if (slideshowTimer) restartSlideshowTimer();
}

function toggleModalPlayPause() {
  const mediaEl = modalMedia ? modalMedia.querySelector('video, img') : null;
  if (mediaEl && mediaEl.tagName === 'VIDEO') {
    if (mediaEl.paused) {
      mediaEl.play().catch(() => {});
    } else {
      mediaEl.pause();
    }
  }

  if (slideshowItems.length) {
    if (slideshowTimer) {
      stopSlideshow({ silent: true });
      if (modal.classList.contains('open') && activeModalItem) {
        syncModalSequence(activeModalItem);
      }
    } else {
      if (activeModalItem) {
        syncModalSequence(activeModalItem);
      }
      setSlideshowButtonState(true, slideshowItems.length);
      restartSlideshowTimer();
    }
  }

  updateModalControls();
}

async function toggleFullscreen() {
  if (isFullscreenActive) {
    exitSlideshowFullscreen();
  } else {
    await enterFullscreenForSlideshow();
  }
}

function trapModalFocus(event) {
  if (!modal.classList.contains('open') || event.key !== 'Tab') return;
  const focusable = modal.querySelectorAll(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  );
  if (!focusable.length) {
    event.preventDefault();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

if (modalPrevBtn) modalPrevBtn.addEventListener('click', showPreviousSlide);
if (modalNextBtn) modalNextBtn.addEventListener('click', nextSlide);
if (modalPlayToggleBtn) modalPlayToggleBtn.addEventListener('click', toggleModalPlayPause);
if (modalFullscreenBtn) modalFullscreenBtn.addEventListener('click', () => {
  toggleFullscreen();
});
closeBtn.addEventListener('click', () => closeModal());
modal.addEventListener('click', (e) => {
  if (e.target === modal) closeModal();
});

document.addEventListener('keydown', (e) => {
  if (!modal.classList.contains('open')) {
    if (e.key === 'Escape') closeModal();
    return;
  }

  if (e.key === 'Escape') {
    closeModal();
    return;
  }

  if (e.key === 'ArrowRight') {
    e.preventDefault();
    nextSlide();
    return;
  }

  if (e.key === 'ArrowLeft') {
    e.preventDefault();
    showPreviousSlide();
    return;
  }

  if (e.key === ' ' || e.code === 'Space') {
    e.preventDefault();
    toggleModalPlayPause();
    return;
  }

  if (e.key.toLowerCase() === 'f') {
    e.preventDefault();
    toggleFullscreen();
    return;
  }

  trapModalFocus(e);
});

async function enterFullscreenForSlideshow() {
  if (isFullscreenActive) return;
  const api = resolveFullscreenApi();
  const target = document.documentElement;
  if (!api || !target) return;
  try {
    const requestFn = target[api.request];
    const request = typeof requestFn === 'function' ? requestFn.call(target) : null;
    if (request && typeof request.then === 'function') {
      await request;
    }
    isFullscreenActive = Boolean(getActiveFullscreenElement());
  } catch (error) {
    isFullscreenActive = false;
  }
}

function exitSlideshowFullscreen() {
  if (!isFullscreenActive) return;
  const api = resolveFullscreenApi();
  const exitMethod = api ? document[api.exit] : null;
  if (typeof exitMethod === 'function') {
    exitMethod.call(document);
  }
  isFullscreenActive = false;
}

if (heroUploadButton) {
  heroUploadButton.addEventListener('click', (event) => {
    event.preventDefault();
    smoothScrollToSection(uploadSection);
    window.requestAnimationFrame(() => {
      try {
        uploadTokenInput.focus({ preventScroll: true });
      } catch (error) {
        uploadTokenInput.focus();
      }
    });
  });
}

watchFullscreenChanges();
updateSelectionUI();
fetchUpscaleProfiles();
fetchCategories();
fetchMedia();
pollUpscaleJobs();

function createMediaElement(item) {
  if (item.source === 'link') {
    const preview = document.createElement('div');
    preview.className = 'link-preview';

    const host = document.createElement('div');
    host.className = 'link-host';
    host.textContent = item.name || 'Link';

    const domain = document.createElement('div');
    domain.className = 'link-domain';
    domain.textContent = item.domain || item.url;

    const hint = document.createElement('span');
    hint.className = 'open-hint';
    hint.textContent = 'Open link';

    preview.append(host, domain, hint);
    return { mediaEl: preview, isVideo: false };
  }

  const isVideo = item.mime_type.startsWith('video');
  const mediaEl = document.createElement(isVideo ? 'video' : 'img');
  const previewUrl = getPreviewUrl(item);
  const fullUrl = isVideo ? getPlaybackUrl(item) : getResolvedMediaUrl(item.url);
  const posterUrl = getPosterUrl(item);

  if (previewUrl) {
    mediaEl.dataset.src = previewUrl;
  }
  mediaEl.dataset.fullSrc = fullUrl;
  if (posterUrl) {
    mediaEl.dataset.poster = posterUrl;
    mediaEl.poster = posterUrl;
  }

  if (isVideo) {
    mediaEl.muted = true;
    mediaEl.playsInline = true;
    mediaEl.loop = true;
    mediaEl.preload = isAggressiveVideoBufferEnabled() ? 'auto' : 'none';
  } else {
    mediaEl.alt = item.name;
    mediaEl.loading = 'lazy';
    mediaEl.decoding = 'async';
  }

  registerMediaElement(mediaEl, isVideo);

  return { mediaEl, isVideo };
}

function handleMediaVisibility(entries) {
  entries.forEach((entry) => {
    const el = entry.target;
    const isVideo = el.tagName === 'VIDEO';
    el.dataset.intersecting = entry.isIntersecting ? 'true' : 'false';

    if (entry.isIntersecting) {
      if (!el.dataset.loaded && el.dataset.src) {
        el.src = el.dataset.src;
        el.dataset.loaded = 'true';
        trackVideoBuffer(el, { forceTouch: true });
        if (isVideo) {
          el.preload = isAggressiveVideoBufferEnabled() ? 'auto' : 'metadata';
          el.load();
        }
      }

      if (isVideo) {
        trackVideoBuffer(el, { forceTouch: true });
      }

      if (isVideo && el.dataset.shouldPlay === 'true') {
        el.play().catch(() => {});
        enforceVideoBufferBudget(el);
      }
    } else if (isVideo) {
      stopVideoPlayback(el);
      releaseVideoMemory(el);
    }
  });

  enforceVideoBufferBudget(activeModalVideo);
}

function registerMediaElement(mediaEl, isVideo) {
  mediaEl.dataset.intersecting = mediaObserver ? 'false' : 'true';
  if (isVideo) {
    mediaEl.dataset.shouldPlay = 'false';
  }

  if (!mediaObserver) {
    eagerLoadMedia(mediaEl, isVideo);
    attachVideoPlaybackHandlers(mediaEl, isVideo);
    return;
  }

  if (mediaObserver && mediaObserver.observe) {
    mediaObserver.observe(mediaEl);
  }
  attachVideoPlaybackHandlers(mediaEl, isVideo);
}

function eagerLoadMedia(mediaEl, isVideo) {
  const source = mediaEl.dataset.src || mediaEl.dataset.fullSrc;
  if (source && !mediaEl.dataset.loaded) {
    mediaEl.src = source;
    mediaEl.dataset.loaded = 'true';
    if (isVideo) {
      trackVideoBuffer(mediaEl, { forceTouch: true });
    }
  }
  if (isVideo) {
    mediaEl.preload = isAggressiveVideoBufferEnabled() ? 'auto' : 'metadata';
    enforceVideoBufferBudget();
  }
}

function attachVideoPlaybackHandlers(mediaEl, isVideo) {
  if (!isVideo || mediaEl.dataset.playHandlerAttached) return;

  mediaEl.addEventListener('loadeddata', () => {
    if (mediaEl.dataset.intersecting === 'true' && mediaEl.dataset.shouldPlay === 'true') {
      mediaEl.play().catch(() => {});
    }
  });
  mediaEl.addEventListener('pointerenter', () => requestVideoPlayback(mediaEl));
  mediaEl.addEventListener('pointerleave', () => stopVideoPlayback(mediaEl));
  mediaEl.addEventListener('focus', () => requestVideoPlayback(mediaEl));
  mediaEl.addEventListener('blur', () => stopVideoPlayback(mediaEl));
  if (!mediaEl.loop) {
    mediaEl.addEventListener('ended', () => {
      stopVideoPlayback(mediaEl);
      releaseVideoMemory(mediaEl);
    });
  }
  mediaEl.dataset.playHandlerAttached = 'true';
}

function requestVideoPlayback(videoEl) {
  videoEl.dataset.shouldPlay = 'true';
  trackVideoBuffer(videoEl, { forceTouch: true });
  if (videoEl.dataset.intersecting === 'true') {
    videoEl.play().catch(() => {});
  }
  enforceVideoBufferBudget(videoEl);
}

function stopVideoPlayback(videoEl) {
  videoEl.dataset.shouldPlay = 'false';
  videoEl.pause();
  if (videoEl.dataset.intersecting !== 'true' && videoEl !== activeModalVideo) {
    releaseVideoMemory(videoEl);
  }
}

function getResolvedMediaUrl(url) {
  try {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }
    return new URL(url, window.location.origin).toString();
  } catch (error) {
    console.error('Failed to resolve media URL', error);
    return url;
  }
}

function getPlaybackUrl(item) {
  const playbackCandidate = item.stream_url || item.url;
  return getResolvedMediaUrl(playbackCandidate);
}

function getPreviewUrl(item) {
  const previewCandidate = item.thumbnail_url || item.preview_url || item.poster || item.url;
  return getResolvedMediaUrl(previewCandidate);
}

function getPosterUrl(item) {
  const posterCandidate = item.poster || item.thumbnail_url || item.preview_url;
  return posterCandidate ? getResolvedMediaUrl(posterCandidate) : null;
}
