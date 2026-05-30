// Register Service Worker for PWA
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js');
}

const UI = {
    token: document.getElementById('ghToken'),
    repo: document.getElementById('ghRepo'),
    folder: document.getElementById('ghFolder'),
    fileInput: document.getElementById('fileInput'),
    uploadBtn: document.getElementById('uploadBtn'),
    results: document.getElementById('results')
};

// Load saved settings
UI.token.value = localStorage.getItem('ghToken') || '';
UI.repo.value = localStorage.getItem('ghRepo') || '';
UI.folder.value = localStorage.getItem('ghFolder') || '';

// Save settings on change
['token', 'repo', 'folder'].forEach(id => {
    UI[id].addEventListener('input', (e) => localStorage.setItem(`gh${id.charAt(0).toUpperCase() + id.slice(1)}`, e.target.value));
});

// Check for files shared via Web Share Target (Intent)
window.addEventListener('DOMContentLoaded', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('shared') === 'true') {
        const cache = await caches.open('shared-files-cache');
        const keys = await cache.keys();
        const filesToUpload = [];
        
        for (const request of keys) {
            const response = await cache.match(request);
            const blob = await response.blob();
            // Assign a random timestamp name for shared files
            const file = new File([blob], `shared_img_${Date.now()}.jpg`, { type: blob.type });
            filesToUpload.push(file);
            await cache.delete(request); // Clean up cache
        }
        
        if(filesToUpload.length > 0) {
            processUploads(filesToUpload);
        }
        // Clean URL
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
    
    if (!token || !repo) return alert('Token and Repository are required!');
    if (folder && !folder.endsWith('/')) folder += '/';

    for (const file of files) {
        await uploadToGitHub(file, token, repo, folder);
    }
}

async function uploadToGitHub(file, token, repo, folder) {
    const reader = new FileReader();
    reader.onloadend = async () => {
        const base64Content = reader.result.split(',')[1];
        const path = `${folder}${file.name.replace(/\s+/g, '-')}`;
        const url = `https://api.github.com/repos/${repo}/contents/${path}`;

        try {
            const response = await fetch(url, {
                method: 'PUT',
                headers: {
                    'Authorization': `token ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    message: `Upload ${file.name} via PWA`,
                    content: base64Content
                })
            });

            if (response.ok) {
                // Ensure branch is correct, defaults to main for newer repos
                const rawUrl = `https://raw.githubusercontent.com/${repo}/main/${path}`;
                renderResult(rawUrl);
            } else {
                const errorData = await response.json();
                alert(`Upload failed: ${errorData.message}`);
            }
        } catch (error) {
            alert('Network error during upload');
        }
    };
    reader.readAsDataURL(file);
}

function renderResult(url) {
    const item = document.createElement('div');
    item.className = 'result-item';

    const img = document.createElement('img');
    img.src = url;

    const markdownArea = document.createElement('textarea');
    markdownArea.readOnly = true;
    markdownArea.rows = 2;
    markdownArea.value = `![image](${url})`;

    const directLinkArea = document.createElement('textarea');
    directLinkArea.readOnly = true;
    directLinkArea.rows = 1;
    directLinkArea.value = url;

    item.appendChild(img);
    item.appendChild(markdownArea);
    item.appendChild(directLinkArea);
    UI.results.prepend(item);
}
