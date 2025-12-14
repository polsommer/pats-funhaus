const grid = document.querySelector('.grid');
const statusEl = document.querySelector('.status');
const modal = document.querySelector('.modal');
const modalContent = document.querySelector('.modal-content');
const closeBtn = document.querySelector('.close');
const filterSelect = document.querySelector('#categoryFilter');
const searchInput = document.querySelector('#searchInput');
const sortSelect = document.querySelector('#sortSelect');
const shuffleButton = document.querySelector('#shuffleButton');
const uploadForm = document.querySelector('#uploadForm');
const uploadTokenInput = document.querySelector('#uploadToken');
const uploadFileInput = document.querySelector('#uploadFile');
const uploadCategorySelect = document.querySelector('#uploadCategorySelect');
const uploadStatus = document.querySelector('.upload-status');
const progressContainer = document.querySelector('.progress');
const progressBar = document.querySelector('.progress-bar');
const progressText = document.querySelector('.progress-text');

let allCategories = [];
let mediaCache = [];
let currentItems = [];

filterSelect.addEventListener('change', applyFilters);
searchInput.addEventListener('input', applyFilters);
sortSelect.addEventListener('change', applyFilters);
shuffleButton.addEventListener('click', () => {
  currentItems = shuffleItems(currentItems);
  renderGrid(currentItems);
});

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
    uploadTokenInput.value = tokenValue;
    setUploadStatus('Upload complete', 'success');
    await fetchMedia();
  } catch (err) {
    console.error(err);
    setUploadStatus(err.message || 'Unable to upload', 'error');
  } finally {
    progressContainer.hidden = true;
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
    mediaCache = await res.json();
    updateCategoryOptions(mediaCache);
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
  renderSelectOptions(uploadCategorySelect, allCategories, {
    includeAll: false,
    uncategorizedLabel: 'Uncategorized',
    emptyUncategorizedValue: true,
  });
}

function applyFilters() {
  const selectedCategory = filterSelect.value.trim();
  const searchTerm = searchInput.value.trim().toLowerCase();

  const filtered = mediaCache.filter((item) => {
    const matchesCategory = selectedCategory
      ? (item.category || 'Uncategorized') === selectedCategory
      : true;

    const nameMatch = item.name.toLowerCase().includes(searchTerm);
    const categoryLabel = (item.category || 'Uncategorized').toLowerCase();
    const categoryMatch = categoryLabel.includes(searchTerm);

    return matchesCategory && (!searchTerm || nameMatch || categoryMatch);
  });

  currentItems = sortItems(filtered, sortSelect.value);
  renderGrid(currentItems);
  const hasMedia = mediaCache.length > 0;
  if (currentItems.length) {
    statusEl.textContent = '';
  } else if (hasMedia) {
    statusEl.textContent = 'No media matches your filters';
  } else {
    statusEl.textContent = 'No media uploaded yet';
  }
}

function sortItems(items, sortBy) {
  const sorted = [...items];

  switch (sortBy) {
    case 'oldest':
      sorted.sort((a, b) => new Date(a.modified) - new Date(b.modified));
      break;
    case 'name-asc':
      sorted.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case 'name-desc':
      sorted.sort((a, b) => b.name.localeCompare(a.name));
      break;
    default:
      sorted.sort((a, b) => new Date(b.modified) - new Date(a.modified));
      break;
  }

  return sorted;
}

function shuffleItems(items) {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function renderSelectOptions(
  select,
  categories,
  { includeAll = false, uncategorizedLabel = 'All', emptyUncategorizedValue = false } = {}
) {
  select.innerHTML = '';
  if (includeAll) {
    const allOption = document.createElement('option');
    allOption.value = '';
    allOption.textContent = uncategorizedLabel;
    select.appendChild(allOption);
  }

  for (const category of categories) {
    const option = document.createElement('option');
    const isUncategorized = category === 'Uncategorized';
    option.value = isUncategorized && emptyUncategorizedValue ? '' : category;
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
}

function updateProgress(percent) {
  progressContainer.hidden = false;
  progressBar.style.width = `${percent}%`;
  progressText.textContent = `${percent}%`;
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

fetchMedia();
