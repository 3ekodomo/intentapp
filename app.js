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
            // Retain original filename if provided by the share intent, otherwise fallback
            const fileName = blob.name || `shared_image_${i}.jpg`; 
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
    const token = UI.token.value.trim();
    const repo = UI.repo.value.trim();
    let folder = UI.folder.value.trim();
    
    if (!token || !repo) return alert('Token and Repository required!');
    if (folder && !folder.endsWith('/')) folder += '/';

    UI.uploadBtn.disabled = true;

    try {
        UI.uploadBtn.innerText = 'Connecting...';
        
        // Step A: Get repository default branch
        let branch = 'main';
        const repoReq = await fetch(`https://api.github.com/repos/${repo}`, {
            headers: { 'Authorization': `token ${token}` }
        });
        if (repoReq.ok) {
            const repoData = await repoReq.json();
            branch = repoData.default_branch;
        }

        // Step B: Get latest commit SHA
        const refReq = await fetch(`https://api.github.com/repos/${repo}/git/refs/heads/${branch}`, {
            headers: { 'Authorization': `token ${token}` }
        });
        if (!refReq.ok) throw new Error("Could not fetch branch reference.");
        const refData = await refReq.json();
        const latestCommitSha = refData.object.sha;

        // Step C: Get base tree SHA
        const commitReq = await fetch(`https://api.github.com/repos/${repo}/git/commits/${latestCommitSha}`, {
            headers: { 'Authorization': `token ${token}` }
        });
        const commitData = await commitReq.json();
        const baseTreeSha = commitData.tree.sha;

        // Step D: Upload blobs (No commit conflicts here)
        const treeItems = [];
        for (let i = 0; i < files.length; i++) {
            UI.uploadBtn.innerText = `Uploading file ${i + 1}/${files.length}...`;
            const file = files[i];
            
            const base64Content = await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result.split(',')[1]);
                reader.readAsDataURL(file);
            });

            // STRICTLY USE ORIGINAL FILENAME
            const path = `${folder}${file.name}`;

            const blobReq = await fetch(`https://api.github.com/repos/${repo}/git/blobs`, {
                method: 'POST',
                headers: { 'Authorization': `token ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: base64Content, encoding: 'base64' })
            });
            
            if (!blobReq.ok) throw new Error(`Failed to upload blob for ${file.name}`);
            const blobData = await blobReq.json();

            treeItems.push({
                path: path,
                mode: '100644',
                type: 'blob',
                sha: blobData.sha
            });
        }

        UI.uploadBtn.innerText = 'Finalizing...';

        // Step E: Create Tree
        const newTreeReq = await fetch(`https://api.github.com/repos/${repo}/git/trees`, {
            method: 'POST',
            headers: { 'Authorization': `token ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ base_tree: baseTreeSha, tree: treeItems })
        });
        const newTreeData = await newTreeReq.json();

        // Step F: Create Commit
        const newCommitReq = await fetch(`https://api.github.com/repos/${repo}/git/commits`, {
            method: 'POST',
            headers: { 'Authorization': `token ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: `Uploaded ${files.length} images via App`,
                tree: newTreeData.sha,
                parents: [latestCommitSha]
            })
        });
        const newCommitData = await newCommitReq.json();

        // Step G: Update Branch Ref
        const updateRefReq = await fetch(`https://api.github.com/repos/${repo}/git/refs/heads/${branch}`, {
            method: 'PATCH',
            headers: { 'Authorization': `token ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ sha: newCommitData.sha })
        });

        if (updateRefReq.ok) {
            // Success
            treeItems.reverse().forEach(item => {
                // Encode the path to handle spaces in original filenames properly in URLs
                const encodedPath = encodeURI(item.path);
                const rawUrl = `https://raw.githubusercontent.com/${repo}/${branch}/${encodedPath}`;
                saveToHistory(rawUrl);
            });
        } else {
            throw new Error("Failed to update branch reference.");
        }

    } catch (error) {
        console.error(error);
        alert(`Error: ${error.message}`);
    } finally {
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
