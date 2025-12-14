const grid = document.querySelector('.grid');
const statusEl = document.querySelector('.status');
const modal = document.querySelector('.modal');
const modalContent = document.querySelector('.modal-content');
const closeBtn = document.querySelector('.close');
const uploadForm = document.querySelector('#upload-form');
const fileInput = document.querySelector('#file');
const categorySelect = document.querySelector('#category');
const tokenInput = document.querySelector('#token');
const uploadProgress = document.querySelector('.upload-progress');

async function fetchMedia() {
  try {
    statusEl.textContent = 'Loading media...';
    const res = await fetch('/api/media');
    if (!res.ok) throw new Error('Failed to load media');
    const items = await res.json();
    renderGrid(items);
    statusEl.textContent = items.length ? '' : 'No media uploaded yet';
  } catch (err) {
    console.error(err);
    statusEl.textContent = 'Unable to load media';
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
    meta.innerHTML = `<strong>${item.name}</strong><span>${new Date(item.modified).toLocaleString()}</span>`;

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

function setUploadMessage(message, tone = 'muted') {
  if (!uploadProgress) return;
  uploadProgress.textContent = message;
  uploadProgress.dataset.tone = tone;
}

function setUploadDisabled(disabled) {
  if (!uploadForm) return;
  const elements = uploadForm.querySelectorAll('input, select, button');
  elements.forEach((el) => {
    el.disabled = disabled;
  });
}

function uploadMedia(formData, token) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/media');
    if (token) {
      xhr.setRequestHeader('X-Upload-Token', token);
    }

    xhr.upload.addEventListener('progress', (event) => {
      if (!event.lengthComputable) return;
      const percent = Math.round((event.loaded / event.total) * 100);
      setUploadMessage(`Uploading... ${percent}%`, 'muted');
    });

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        const reason = xhr.responseText || 'Upload failed';
        reject(new Error(reason));
      }
    };

    xhr.onerror = () => reject(new Error('Network error while uploading'));

    xhr.send(formData);
  });
}

uploadForm?.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (!fileInput?.files?.length) {
    setUploadMessage('Please choose a file to upload.', 'error');
    return;
  }

  const formData = new FormData();
  formData.append('file', fileInput.files[0]);
  if (categorySelect?.value) {
    formData.append('category', categorySelect.value);
  }

  setUploadDisabled(true);
  setUploadMessage('Preparing upload...', 'muted');

  try {
    await uploadMedia(formData, tokenInput?.value?.trim());
    setUploadMessage('Upload complete! Refreshing gallery...', 'success');
    uploadForm.reset();
    await fetchMedia();
    setUploadMessage('Choose a file to upload another item.', 'muted');
  } catch (err) {
    console.error(err);
    setUploadMessage(err.message || 'Upload failed', 'error');
  } finally {
    setUploadDisabled(false);
  }
});

fetchMedia();
