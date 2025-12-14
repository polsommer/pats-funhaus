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
const progressContainer = document.querySelector('.progress');
const progressBar = document.querySelector('.progress-bar');
const progressText = document.querySelector('.progress-text');

let allCategories = [];

filterSelect.addEventListener('change', () => {
  fetchMedia(filterSelect.value);
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
    await fetchMedia(filterSelect.value);
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

async function fetchMedia(category = filterSelect.value) {
  try {
    statusEl.textContent = 'Loading media...';
    const url = new URL('/api/media', window.location.origin);
    if (category) {
      url.searchParams.set('category', category);
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to load media');
    const items = await res.json();
    updateCategoryOptions(items, Boolean(category));
    renderGrid(items);
    statusEl.textContent = items.length ? '' : 'No media uploaded yet';
  } catch (err) {
    console.error(err);
    statusEl.textContent = 'Unable to load media';
  }
}

function updateCategoryOptions(items, merge = false) {
  const categories = new Set(merge ? allCategories : []);
  items.forEach((item) => categories.add(item.category || 'Uncategorized'));

  allCategories = Array.from(categories).sort((a, b) => a.localeCompare(b));
  renderSelectOptions(filterSelect, allCategories, { includeAll: true });
  renderSelectOptions(uploadCategorySelect, allCategories, { includeAll: false, uncategorizedLabel: 'Uncategorized' });
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
