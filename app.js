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
        for (const request of keys) {
            const response = await cache.match(request);
            const blob = await response.blob();
            filesToUpload.push(new File([blob], `shared_img_${Date.now()}.jpg`, { type: blob.type }));
            await cache.delete(request);
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

    // Disable button to prevent double clicks during upload
    UI.uploadBtn.disabled = true;
    UI.uploadBtn.innerText = 'Uploading...';

    for (const file of files) {
        await uploadToGitHub(file, token, repo, folder);
        // Small artificial delay to ensure GitHub API state updates between commits
        await new Promise(resolve => setTimeout(resolve, 500)); 
    }

    // Reset button
    UI.uploadBtn.disabled = false;
    UI.uploadBtn.innerText = 'Upload';
    UI.fileInput.value = ''; // Clear file input
}

// Wrapped in a Promise for strict sequential execution
function uploadToGitHub(file, token, repo, folder) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = async () => {
            const base64Content = reader.result.split(',')[1];
            const path = `${folder}${Date.now()}-${file.name.replace(/\s+/g, '-')}`;
            const url = `https://api.github.com/repos/${repo}/contents/${path}`;

            try {
                const response = await fetch(url, {
                    method: 'PUT',
                    headers: { 'Authorization': `token ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message: `Upload via PWA`, content: base64Content })
                });

                if (response.ok) {
                    const rawUrl = `https://raw.githubusercontent.com/${repo}/main/${path}`;
                    saveToHistory(rawUrl);
                    resolve(true); // Resolve promise to move to next file
                } else {
                    const errorData = await response.json();
                    alert(`Failed for ${file.name}: ${errorData.message}`);
                    resolve(false); // Resolve so it doesn't break the loop for other files
                }
            } catch (error) {
                alert(`Network error during ${file.name} upload`);
                resolve(false);
            }
        };
        reader.readAsDataURL(file);
    });
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

        // Image Preview (Click to open)
        const img = document.createElement('img');
        img.src = url;
        img.onclick = () => window.open(url, '_blank');

        const linksContainer = document.createElement('div');
        linksContainer.className = 'links-container';

        // Markdown Link (Click to copy)
        const mdBox = document.createElement('p');
        mdBox.className = 'link-box';
        mdBox.innerText = markdownText;
        mdBox.onclick = () => copyToClipboard(markdownText);

        // Direct Link (Click to copy)
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
