// PWA Registration and Installation
let deferredPrompt;
const installBtn = document.getElementById('installBtn');

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js');
}

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    installBtn.style.display = 'block';
});

installBtn.addEventListener('click', async () => {
    if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') installBtn.style.display = 'none';
        deferredPrompt = null;
    }
});

const UI = {
    token: document.getElementById('ghToken'),
    repo: document.getElementById('ghRepo'),
    folder: document.getElementById('ghFolder'),
    fileInput: document.getElementById('fileInput'),
    uploadBtn: document.getElementById('uploadBtn'),
    results: document.getElementById('results'),
    toast: document.getElementById('toast')
};

// Load History and Settings
let uploadHistory = JSON.parse(localStorage.getItem('uploadHistory')) || [];
UI.token.value = localStorage.getItem('ghToken') || '';
UI.repo.value = localStorage.getItem('ghRepo') || '';
UI.folder.value = localStorage.getItem('ghFolder') || '';

['token', 'repo', 'folder'].forEach(id => {
    UI[id].addEventListener('input', (e) => localStorage.setItem(`gh${id.charAt(0).toUpperCase() + id.slice(1)}`, e.target.value));
});

// Render existing history on load
window.addEventListener('DOMContentLoaded', async () => {
    renderHistory();
    
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('shared') === 'true') {
        const cache = await caches.open('shared-files-cache');
        const keys = await cache.keys();
        const filesToUpload = [];
        
        for (let i = 0; i < keys.length; i++) {
            const response = await cache.match(keys[i]);
            const blob = await response.blob();
            // Added index 'i' to guarantee unique names even if processed in the same millisecond
            filesToUpload.push(new File([blob], `shared_${Date.now()}_${i}.jpg`, { type: blob.type }));
            await cache.delete(keys[i]);
        }
        
        if(filesToUpload.length > 0) processUploads(filesToUpload);
        window.history.replaceState({}, document.title, window.location.pathname);
    }
});

UI.uploadBtn.addEventListener('click', () => {
    const files = Array.from(UI.fileInput.files);
    if (files.length > 0) processUploads(files);
});

async function processUploads(files) {
    const token = UI.token.value.trim();
    const repo = UI.repo.value.trim();
    let folder = UI.folder.value.trim();
    
    if (!token || !repo) return alert('Token and Repository required!');
    if (folder && !folder.endsWith('/')) folder += '/';

    UI.uploadBtn.disabled = true;

    for (let i = 0; i < files.length; i++) {
        UI.uploadBtn.innerText = `Uploading ${i + 1} of ${files.length}...`;
        await uploadSingleFile(files[i], token, repo, folder, i);
        
        // Crucial 1-second delay to prevent GitHub branch head conflicts (409 Error)
        if (i < files.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }

    UI.uploadBtn.disabled = false;
    UI.uploadBtn.innerText = 'Upload';
    UI.fileInput.value = ''; 
}

async function uploadSingleFile(file, token, repo, folder, index) {
    // 1. Read file to Base64 synchronously within a Promise
    const base64Content = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result.split(',')[1]);
        reader.readAsDataURL(file);
    });

    // 2. Guarantee absolute uniqueness in the file path
    const safeName = file.name ? file.name.replace(/[^a-zA-Z0-9.-]/g, '_') : 'image.jpg';
    const uniqueString = `${Date.now()}-${index}`;
    const path = `${folder}${uniqueString}-${safeName}`;
    const url = `https://api.github.com/repos/${repo}/contents/${path}`;

    // 3. Upload to GitHub and wait for the response
    try {
        const response = await fetch(url, {
            method: 'PUT',
            headers: { 
                'Authorization': `token ${token}`, 
                'Content-Type': 'application/json' 
            },
            body: JSON.stringify({ 
                message: `Upload ${safeName} via PWA`, 
                content: base64Content 
            })
        });

        if (response.ok) {
            // 4. On success, add to history immediately
            const rawUrl = `https://raw.githubusercontent.com/${repo}/main/${path}`;
            saveToHistory(rawUrl);
        } else {
            const errorData = await response.json();
            alert(`Failed for ${safeName}: ${errorData.message}`);
        }
    } catch (error) {
        alert(`Network error during ${safeName} upload`);
    }
}

function saveToHistory(url) {
    uploadHistory.unshift(url);
    localStorage.setItem('uploadHistory', JSON.stringify(uploadHistory));
    renderHistory();
}

function renderHistory() {
    UI.results.innerHTML = '';
    uploadHistory.forEach(url => {
        const markdownText = `![image](${url})`;

        const item = document.createElement('div');
        item.className = 'result-item';

        const img = document.createElement('img');
        img.src = url;
        img.onclick = () => window.open(url, '_blank');

        const linksContainer = document.createElement('div');
        linksContainer.className = 'links-container';

        const mdBox = document.createElement('p');
        mdBox.className = 'link-box';
        mdBox.innerText = markdownText;
        mdBox.onclick = () => copyToClipboard(markdownText);

        const directBox = document.createElement('p');
        directBox.className = 'link-box';
        directBox.innerText = url;
        directBox.onclick = () => copyToClipboard(url);

        linksContainer.appendChild(mdBox);
        linksContainer.appendChild(directBox);
        
        item.appendChild(img);
        item.appendChild(linksContainer);
        UI.results.appendChild(item);
    });
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        UI.toast.style.opacity = '1';
        setTimeout(() => { UI.toast.style.opacity = '0'; }, 2000);
    });
}
