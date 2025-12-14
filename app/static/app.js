const grid = document.querySelector('.grid');
const statusEl = document.querySelector('.status');
const modal = document.querySelector('.modal');
const modalContent = document.querySelector('.modal-content');
const closeBtn = document.querySelector('.close');
const filterSelect = document.querySelector('#categoryFilter');
const uploadForm = document.querySelector('#uploadForm');
const uploadTokenInput = document.querySelector('#uploadToken');
const uploadCategoryInput = document.querySelector('#uploadCategory');
const uploadFileInput = document.querySelector('#uploadFile');

let allCategories = [];

filterSelect.addEventListener('change', () => {
  fetchMedia(filterSelect.value);
});

uploadForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!uploadFileInput.files.length) return;

  const formData = new FormData();
  formData.append('file', uploadFileInput.files[0]);
  const categoryValue = uploadCategoryInput.value.trim();
  if (categoryValue) {
    formData.append('category', categoryValue);
  }

  try {
    statusEl.textContent = 'Uploading...';
    const res = await fetch('/api/media', {
      method: 'POST',
      headers: { 'X-Upload-Token': uploadTokenInput.value },
      body: formData,
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({ detail: 'Upload failed' }));
      throw new Error(error.detail || 'Upload failed');
    }

    uploadForm.reset();
    statusEl.textContent = 'Upload complete';
    await fetchMedia(filterSelect.value);
  } catch (err) {
    console.error(err);
    statusEl.textContent = err.message || 'Unable to upload';
  }
});

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
  filterSelect.innerHTML = '<option value="">All</option>';
  for (const category of allCategories) {
    const option = document.createElement('option');
    option.value = category === 'Uncategorized' ? '' : category;
    option.textContent = category;
    filterSelect.appendChild(option);
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
