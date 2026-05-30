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
    uploadType: document.getElementById('uploadType'), // New Select Element
    fileInput: document.getElementById('fileInput'),
    uploadBtn: document.getElementById('uploadBtn'),
    results: document.getElementById('results'),
    toast: document.getElementById('toast')
};

let isUploading = false; 
let uploadHistory = JSON.parse(localStorage.getItem('uploadHistory')) || [];

UI.token.value = localStorage.getItem('ghToken') || '';
UI.repo.value = localStorage.getItem('ghRepo') || '';
UI.folder.value = localStorage.getItem('ghFolder') || '';
UI.uploadType.value = localStorage.getItem('ghUploadType') || 'image/*';
UI.fileInput.accept = UI.uploadType.value; // Set initial accept attribute

['token', 'repo', 'folder'].forEach(id => {
    UI[id].addEventListener('input', (e) => localStorage.setItem(`gh${id.charAt(0).toUpperCase() + id.slice(1)}`, e.target.value));
});

// Update accept attribute and save preference when dropdown changes
UI.uploadType.addEventListener('change', (e) => {
    UI.fileInput.accept = e.target.value;
    localStorage.setItem('ghUploadType', e.target.value);
});

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
            
            // Generate filename with correct extension based on MIME type
            let fileName = blob.name;
            if (!fileName || !fileName.includes('.')) {
                let ext = '.jpg'; // Default fallback
                if (blob.type) {
                    if (blob.type.includes('jpeg')) ext = '.jpg';
                    else if (blob.type.includes('png')) ext = '.png';
                    else if (blob.type.includes('gif')) ext = '.gif';
                    else if (blob.type.includes('webp')) ext = '.webp';
                    else if (blob.type.includes('mp4')) ext = '.mp4';
                    else ext = `.${blob.type.split('/')[1]}`;
                }
                fileName = `shared_file_${i}${ext}`;
            }
            
            filesToUpload.push(new File([blob], fileName, { type: blob.type }));
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
    if (isUploading) return;
    
    const token = UI.token.value.trim();
    const repo = UI.repo.value.trim();
    let folder = UI.folder.value.trim();
    
    if (!token || !repo) return alert('Token and Repository required!');
    if (folder && !folder.endsWith('/')) folder += '/';

    isUploading = true;
    UI.uploadBtn.disabled = true;

    try {
        UI.uploadBtn.innerText = 'Connecting...';
        
        let branch = 'main';
        const repoReq = await fetch(`https://api.github.com/repos/${repo}`, { headers: { 'Authorization': `token ${token}` } });
        if (repoReq.ok) {
            branch = (await repoReq.json()).default_branch;
        }

        const treeItems = [];
        const usedPaths = new Set(); 

        for (let i = 0; i < files.length; i++) {
            UI.uploadBtn.innerText = `Uploading file ${i + 1}/${files.length}...`;
            const file = files[i];
            
            const base64Content = await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result.split(',')[1]);
                reader.readAsDataURL(file);
            });

            let safeName = file.name || 'upload_file';
            let path = `${folder}${safeName}`;
            let counter = 1;
            while(usedPaths.has(path)) {
                const nameParts = safeName.split('.');
                const ext = nameParts.length > 1 ? `.${nameParts.pop()}` : '';
                const base = nameParts.join('.');
                path = `${folder}${base}(${counter})${ext}`;
                counter++;
            }
            usedPaths.add(path);

            const blobReq = await fetch(`https://api.github.com/repos/${repo}/git/blobs`, {
                method: 'POST',
                headers: { 'Authorization': `token ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: base64Content, encoding: 'base64' })
            });
            
            if (!blobReq.ok) throw new Error(`Failed to upload blob for ${safeName}`);
            const blobData = await blobReq.json();

            treeItems.push({ path: path, mode: '100644', type: 'blob', sha: blobData.sha });
        }

        UI.uploadBtn.innerText = 'Finalizing...';

        let retries = 3;
        let success = false;

        while (retries > 0 && !success) {
            try {
                const refReq = await fetch(`https://api.github.com/repos/${repo}/git/refs/heads/${branch}`, { headers: { 'Authorization': `token ${token}` } });
                const latestCommitSha = (await refReq.json()).object.sha;

                const commitReq = await fetch(`https://api.github.com/repos/${repo}/git/commits/${latestCommitSha}`, { headers: { 'Authorization': `token ${token}` } });
                const baseTreeSha = (await commitReq.json()).tree.sha;

                const newTreeReq = await fetch(`https://api.github.com/repos/${repo}/git/trees`, {
                    method: 'POST',
                    headers: { 'Authorization': `token ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ base_tree: baseTreeSha, tree: treeItems })
                });
                const newTreeData = await newTreeReq.json();

                const newCommitReq = await fetch(`https://api.github.com/repos/${repo}/git/commits`, {
                    method: 'POST',
                    headers: { 'Authorization': `token ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message: `Uploaded ${files.length} files via App`, tree: newTreeData.sha, parents: [latestCommitSha] })
                });
                const newCommitData = await newCommitReq.json();

                const updateRefReq = await fetch(`https://api.github.com/repos/${repo}/git/refs/heads/${branch}`, {
                    method: 'PATCH',
                    headers: { 'Authorization': `token ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sha: newCommitData.sha })
                });

                if (updateRefReq.ok) {
                    success = true;
                    treeItems.reverse().forEach(item => {
                        const rawUrl = `https://raw.githubusercontent.com/${repo}/${branch}/${encodeURI(item.path)}`;
                        saveToHistory(rawUrl);
                    });
                } else if (updateRefReq.status === 409) {
                    retries--;
                    await new Promise(r => setTimeout(r, 1000));
                } else {
                    throw new Error("Failed to update branch reference.");
                }
            } catch (retryError) {
                if (retries === 1) throw retryError; 
                retries--;
            }
        }

        if (!success) throw new Error("Failed to commit after multiple retries due to branch conflicts.");

    } catch (error) {
        console.error(error);
        alert(`Error: ${error.message}`);
    } finally {
        isUploading = false;
        UI.uploadBtn.disabled = false;
        UI.uploadBtn.innerText = 'Upload';
        UI.fileInput.value = '';
    }
}

function saveToHistory(url) {
    uploadHistory.unshift(url);
    localStorage.setItem('uploadHistory', JSON.stringify(uploadHistory));
    renderHistory();
}

function deleteFromHistory(index) {
    uploadHistory.splice(index, 1);
    localStorage.setItem('uploadHistory', JSON.stringify(uploadHistory));
    renderHistory();
}

// Helper to check if file is an image based on URL extension
function isImageFile(url) {
    return /\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?.*)?$/i.test(url);
}

function renderHistory() {
    UI.results.innerHTML = '';
    uploadHistory.forEach((url, index) => {
        const item = document.createElement('div');
        item.className = 'result-item';

        const isImg = isImageFile(url);
        const fileName = url.split('/').pop();
        
        // Generate proper Markdown: ![image](url) for images, [filename](url) for other files
        const markdownText = isImg ? `![image](${url})` : `[${decodeURI(fileName)}](${url})`;

        // Preview Box Setup
        const previewBox = document.createElement('div');
        previewBox.className = 'preview-box';
        previewBox.onclick = () => window.open(url, '_blank');

        if (isImg) {
            const img = document.createElement('img');
            img.src = url;
            previewBox.appendChild(img);
        } else {
            const fileIcon = document.createElement('div');
            fileIcon.className = 'file-icon';
            fileIcon.innerText = '📄 File';
            previewBox.appendChild(fileIcon);
        }

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
        
        const deleteBtn = document.createElement('button');
        deleteBtn.innerText = '❌';
        deleteBtn.style.cssText = 'position: absolute; top: 10px; right: 10px; background: rgba(0,0,0,0.7); border: 1px solid #444; border-radius: 5px; cursor: pointer; color: white; padding: 5px 8px; width: auto; font-size: 12px; z-index: 2;';
        deleteBtn.onclick = () => deleteFromHistory(index);

        linksContainer.appendChild(mdBox);
        linksContainer.appendChild(directBox);
        
        item.appendChild(previewBox);
        item.appendChild(linksContainer);
        item.appendChild(deleteBtn);
        UI.results.appendChild(item);
    });
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        UI.toast.style.opacity = '1';
        setTimeout(() => { UI.toast.style.opacity = '0'; }, 2000);
    });
}
