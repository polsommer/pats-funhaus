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

let allCategories = [];
let categoryLookup = new Map();
let cachedItems = [];

filterSelect.addEventListener('change', () => applyFilters());

searchInput?.addEventListener('input', () => applyFilters());

sortSelect?.addEventListener('change', () => applyFilters());

shuffleButton?.addEventListener('click', () => applyFilters({ shuffle: true }));

uploadForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const tokenValue = uploadTokenInput.value.trim();
  const file = uploadFileInput.files[0];

  if (!tokenValue) {
    setUploadStatus('Upload token is required', 'error');
    return;
  }

  if (!file) {
    setUploadStatus('Choose a file to upload', 'error');
    return;
  }

  const formData = new FormData();
  formData.append('file', file);
  const selectedCategory = uploadCategorySelect.value.trim();
  if (selectedCategory) {
    formData.append('category', selectedCategory);
  }

  try {
    setUploadStatus('Uploading...');
    await uploadMedia(formData, tokenValue);

    uploadForm.reset();
    updateSelectedFile(null);
    uploadTokenInput.value = tokenValue;
    setUploadStatus('Upload complete', 'success');
    triggerCelebrate();
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
  const file = uploadFileInput.files[0];
  updateSelectedFile(file || null);
  if (file) setUploadStatus(`Ready to upload ${file.name}`);
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

function uploadMedia(formData, token) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/media');
    xhr.setRequestHeader('X-Upload-Token', token);

    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) {
        const percent = Math.round((event.loaded / event.total) * 100);
        updateProgress(percent);
      }
    });

    xhr.addEventListener('loadstart', () => updateProgress(0));
    xhr.addEventListener('loadend', () => updateProgress(100));

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText || '{}'));
        progressContainer.hidden = true;
      } else {
        const error = JSON.parse(xhr.responseText || '{}');
        reject(new Error(error.detail || 'Upload failed'));
      }
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
  renderCategoryList(allCategories);
}

function applyFilters({ shuffle = false } = {}) {
  const query = searchInput?.value.trim().toLowerCase() || '';
  const selectedCategory = filterSelect.value;
  const matchAllCategories = selectedCategory === '__all__';

  if (!cachedItems.length) {
    renderGrid([]);
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

  renderGrid(items);
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
    item.textContent = category.name;
    item.addEventListener('click', () => {
      filterSelect.value = category.path || '';
      uploadCategorySelect.value = category.path || '';
      applyFilters();
    });
    categoryList.appendChild(item);
  }
}

function renderGrid(items) {
  grid.innerHTML = '';
  for (const item of items) {
    const card = document.createElement('article');
    card.className = 'card';

    const isVideo = item.mime_type.startsWith('video');
    const mediaEl = document.createElement(isVideo ? 'video' : 'img');
    mediaEl.src = item.url;
    if (isVideo) {
      mediaEl.muted = true;
      mediaEl.playsInline = true;
      mediaEl.loop = true;
      mediaEl.autoplay = true;
    }

    const meta = document.createElement('div');
    meta.className = 'meta';
    const categoryLabel = getCategoryLabel(item.category_path, item.category);
    meta.innerHTML = `
      <div class="badge">${categoryLabel}</div>
      <strong>${item.name}</strong>
      <span>${new Date(item.modified).toLocaleString()}</span>
    `;

    card.append(mediaEl, meta);
    card.addEventListener('click', () => openModal(item));
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

function setCategoryStatus(message, state = 'info') {
  if (!categoryStatus) return;
  categoryStatus.textContent = message;
  categoryStatus.dataset.state = state;
  categoryStatus.classList.remove('pop');
  void categoryStatus.offsetWidth;
  categoryStatus.classList.add('pop');
}

function updateProgress(percent) {
  progressContainer.hidden = false;
  progressBar.style.width = `${percent}%`;
  progressText.textContent = `${percent}%`;
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
  const [file] = files;
  if (!file) return;
  const dataTransfer = new DataTransfer();
  dataTransfer.items.add(file);
  uploadFileInput.files = dataTransfer.files;
  updateSelectedFile(file);
  setUploadStatus(`Ready to upload ${file.name}`);
}

function updateSelectedFile(file) {
  if (file) {
    dropFilename.textContent = file.name;
    dropzone.classList.add('has-file');
  } else {
    dropFilename.textContent = 'Drop or choose a file';
    dropzone.classList.remove('has-file');
  }
}

function triggerCelebrate() {
  dropzone.classList.add('celebrate');
  setTimeout(() => dropzone.classList.remove('celebrate'), 1200);
}

function getCategoryLabel(categoryPath, fallbackName) {
  const normalizedPath = categoryPath || '';
  return categoryLookup.get(normalizedPath) || fallbackName || 'Uncategorized';
}

function openModal(item) {
  modal.classList.add('open');
  modalContent.innerHTML = '';
  const isVideo = item.mime_type.startsWith('video');
  const mediaEl = document.createElement(isVideo ? 'video' : 'img');
  mediaEl.src = item.url;
  if (isVideo) {
    mediaEl.controls = true;
    mediaEl.playsInline = true;
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
  uploadSection?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  window.requestAnimationFrame(() => uploadTokenInput?.focus({ preventScroll: true }));
});

fetchCategories();
fetchMedia();
