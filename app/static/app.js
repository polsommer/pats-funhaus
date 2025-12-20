const grid = document.querySelector('.grid');
const statusEl = document.querySelector('.status');
const modal = document.querySelector('.modal');
const modalContent = document.querySelector('.modal-content');
const closeBtn = document.querySelector('.close');
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
const toolbarStatus = document.querySelector('.toolbar-status');

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

filterSelect.addEventListener('change', () => applyFilters());

searchInput?.addEventListener('input', () => applyFilters());

sortSelect?.addEventListener('change', () => applyFilters());

shuffleButton?.addEventListener('click', () => applyFilters({ shuffle: true }));

selectAllButton?.addEventListener('click', selectVisibleItems);
clearSelectionButton?.addEventListener('click', clearSelection);
deleteSelectedButton?.addEventListener('click', handleDeleteSelected);

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

categoryForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const categoryName = categoryInput.value.trim();
  if (!categoryName) {
    setCategoryStatus('Enter a category name', 'error');
    return;
  }

  try {
    setCategoryStatus('Saving...');
    const res = await fetch('/api/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: categoryName }),
    });
    const createdCategory = await res.json().catch(() => null);
    if (!res.ok) {
      const error = createdCategory || {};
      throw new Error(error.detail || 'Unable to save category');
    }
    categoryInput.value = '';
    setCategoryStatus('Category added', 'success');
    await fetchCategories({
      preserveSelection: false,
      newSelection: createdCategory?.path || createdCategory?.name || categoryName,
    });
  } catch (err) {
    console.error(err);
    setCategoryStatus(err.message || 'Unable to save category', 'error');
  }
});

linkForm?.addEventListener('submit', async (event) => {
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
    const res = await fetch('/api/links', {
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
    linkUrlInput.focus({ preventScroll: true });
    await fetchMedia();
  } catch (err) {
    console.error(err);
    setLinkStatus(err.message || 'Unable to save link', 'error');
  }
});

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
    const url = new URL('/api/media', window.location.origin);
    const res = await fetch(url);
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
    const res = await fetch('/api/categories');
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
  const query = searchInput?.value.trim().toLowerCase() || '';
  const selectedCategory = filterSelect.value;
  const matchAllCategories = selectedCategory === '__all__';

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
    items = sortItems(items);
  }

  visibleItems = items;
  renderGrid(items);
  updateSelectionUI();
  statusEl.textContent = items.length ? '' : 'No items match your filters yet';
}

function sortItems(items) {
  const selection = sortSelect?.value || 'recent';
  const copy = [...items];

  if (selection === 'name') {
    return copy.sort((a, b) => a.name.localeCompare(b.name));
  }

  return copy.sort((a, b) => {
    const diff = new Date(a.modified).getTime() - new Date(b.modified).getTime();
    return selection === 'oldest' ? diff : -diff;
  });
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
    !preserveStatus && (!toolbarStatus?.textContent || toolbarStatus?.dataset.state === 'info');

  if (shouldUpdateStatus) {
    setToolbarStatus(
      count ? `${count} item${count === 1 ? '' : 's'} selected` : 'No items selected',
      'info'
    );
  }
}

async function handleDeleteSelected() {
  const paths = Array.from(selectedPaths);
  if (!paths.length || isDeleting) return;

  const token = uploadTokenInput.value.trim();
  if (!token) {
    setToolbarStatus('Upload token is required to delete media', 'error');
    uploadTokenInput?.focus({ preventScroll: true });
    return;
  }

  isDeleting = true;
  updateSelectionUI({ preserveStatus: true });
  setToolbarStatus(`Deleting ${paths.length} item${paths.length === 1 ? '' : 's'}...`);

  try {
    let res;
    let payload = {};

    if (paths.length === 1) {
      const url = new URL('/api/media', window.location.origin);
      url.searchParams.set('path', paths[0]);
      res = await fetch(url, {
        method: 'DELETE',
        headers: { 'X-Upload-Token': token },
      });
    } else {
      res = await fetch('/api/media/batch', {
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
    const res = await fetch(`/api/categories/${encodeURIComponent(category.name)}`, { method: 'DELETE' });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(payload.detail || 'Unable to delete category');
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
    setCategoryStatus(err.message || 'Unable to delete category', 'error');
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

  try {
    setCategoryStatus('Updating category...');
    const res = await fetch(`/api/categories/${encodeURIComponent(category.name)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const updatedCategory = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(updatedCategory.detail || 'Unable to rename category');
    }

    const newSelection = updatedCategory.path || payload.path || payload.name || category.path || '';
    setCategoryStatus('Category updated', 'success');
    await fetchCategories({ preserveSelection: false, newSelection });
    applyFilters();
  } catch (err) {
    console.error(err);
    setCategoryStatus(err.message || 'Unable to rename category', 'error');
  }
}

function renderGrid(items) {
  mediaObserver.disconnect();
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

    card.append(selectToggle, mediaEl, meta);
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
  const files = event.dataTransfer?.files;
  if (!files?.length) return;
  assignFiles(files);
}

function assignFiles(files) {
  if (!files?.length) return;
  const dataTransfer = new DataTransfer();
  Array.from(files).forEach((file) => dataTransfer.items.add(file));
  uploadFileInput.files = dataTransfer.files;
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
  if (!target?.scrollIntoView) return;
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

function openModal(item) {
  if (item.source === 'link') {
    const targetUrl = getResolvedMediaUrl(item.url);
    window.open(targetUrl, '_blank', 'noopener');
    modal.classList.remove('open');
    return;
  }
  modal.classList.add('open');
  modalContent.innerHTML = '';
  const isVideo = item.mime_type.startsWith('video');
  const mediaEl = document.createElement(isVideo ? 'video' : 'img');
  const previewUrl = getPreviewUrl(item);
  const fullUrl = getResolvedMediaUrl(item.url);

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
  }
  modalContent.append(mediaEl, closeBtn);
}

closeBtn.addEventListener('click', () => modal.classList.remove('open'));
modal.addEventListener('click', (e) => {
  if (e.target === modal) modal.classList.remove('open');
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') modal.classList.remove('open');
});

heroUploadButton?.addEventListener('click', (event) => {
  event.preventDefault();
  smoothScrollToSection(uploadSection);
  window.requestAnimationFrame(() => uploadTokenInput?.focus({ preventScroll: true }));
});

updateSelectionUI();
fetchCategories();
fetchMedia();

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
  const fullUrl = getResolvedMediaUrl(item.url);
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
    mediaEl.preload = 'none';
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
        if (isVideo) {
          el.preload = 'metadata';
        }
      }

      if (isVideo && el.dataset.shouldPlay === 'true') {
        el.play().catch(() => {});
      }
    } else if (isVideo) {
      stopVideoPlayback(el);
    }
  });
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

  mediaObserver.observe(mediaEl);
  attachVideoPlaybackHandlers(mediaEl, isVideo);
}

function eagerLoadMedia(mediaEl, isVideo) {
  const source = mediaEl.dataset.src || mediaEl.dataset.fullSrc;
  if (source && !mediaEl.dataset.loaded) {
    mediaEl.src = source;
    mediaEl.dataset.loaded = 'true';
  }
  if (isVideo) {
    mediaEl.preload = 'metadata';
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
  mediaEl.dataset.playHandlerAttached = 'true';
}

function requestVideoPlayback(videoEl) {
  videoEl.dataset.shouldPlay = 'true';
  if (videoEl.dataset.intersecting === 'true') {
    videoEl.play().catch(() => {});
  }
}

function stopVideoPlayback(videoEl) {
  videoEl.dataset.shouldPlay = 'false';
  videoEl.pause();
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

function getPreviewUrl(item) {
  const previewCandidate = item.thumbnail_url || item.preview_url || item.poster || item.url;
  return getResolvedMediaUrl(previewCandidate);
}

function getPosterUrl(item) {
  const posterCandidate = item.poster || item.thumbnail_url || item.preview_url;
  return posterCandidate ? getResolvedMediaUrl(posterCandidate) : null;
}
