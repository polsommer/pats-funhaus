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

let allCategories = [];
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
    await fetchMedia();
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
    updateCategoryOptions(cachedItems);
    applyFilters();
  } catch (err) {
    console.error(err);
    statusEl.textContent = 'Unable to load media';
  }
}

function updateCategoryOptions(items) {
  const categories = new Set();
  items.forEach((item) => categories.add(item.category || 'Uncategorized'));

  allCategories = Array.from(categories).sort((a, b) => a.localeCompare(b));
  renderSelectOptions(filterSelect, allCategories, { includeAll: true });
  renderSelectOptions(uploadCategorySelect, allCategories, { includeAll: false, uncategorizedLabel: 'Uncategorized' });
}

function applyFilters({ shuffle = false } = {}) {
  const query = searchInput?.value.trim().toLowerCase() || '';
  const selectedCategory = filterSelect.value;

  if (!cachedItems.length) {
    renderGrid([]);
    statusEl.textContent = 'No media uploaded yet';
    return;
  }

  let items = cachedItems.filter((item) => {
    const categoryLabel = item.category || 'Uncategorized';
    const matchesCategory = !selectedCategory || categoryLabel === selectedCategory;
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

function renderSelectOptions(select, categories, { includeAll = false, uncategorizedLabel = 'All' } = {}) {
  select.innerHTML = '';
  if (includeAll) {
    const allOption = document.createElement('option');
    allOption.value = '';
    allOption.textContent = uncategorizedLabel;
    select.appendChild(allOption);
  }

  for (const category of categories) {
    const option = document.createElement('option');
    option.value = category === 'Uncategorized' ? '' : category;
    option.textContent = category;
    select.appendChild(option);
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
    const categoryLabel = item.category || 'Uncategorized';
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

fetchMedia();
