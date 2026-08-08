// App State
let currentDay = null;
let db = { days: {}, tools: [], signs: {}, curriculum_progress: {}, review: {} };
let audioCtx = null;
let currentModalSign = null;
let saveTimeout = null;
let daySaveTimeout = null;

// Quiz State
let selectedQuizDays = new Set();
let quizQueue = [];
let quizIndex = 0;
let lastClickedQuizDay = null;
let quizMode = 'normal'; // 'normal' | 'anki'
let ankiCardsSeen = 0;
let ankiCardsTotalToday = 0;

// Curriculum Definition (8-Week Fluent-Focus Curriculum)
const CURRICULUM = [
    { week: 1, focus: "Introductions", items: ["Hello", "Name", "What", "Who", "Me/I", "You", "Fingerspell", "Nice-to-meet-you"] },
    { week: 2, focus: "Basic Needs", items: ["Want", "Have", "Need", "Eat", "Drink", "Water", "Food", "Please", "Thank you"] },
    { week: 3, focus: "Small Words/Flow", items: ["Or", "But", "Not", "Yes", "No", "Maybe", "And", "Again", "Slow"] },
    { week: 4, focus: "People & Family", items: ["Mom", "Dad", "Brother", "Sister", "Friend", "Boy", "Girl", "Teacher", "Who"] },
    { week: 5, focus: "Daily Actions", items: ["Go", "Stop", "Sleep", "Wake-up", "Work", "School", "Bathroom", "Help"] },
    { week: 6, focus: "Time & Logistics", items: ["Time", "Day", "Week", "Now", "Later", "Soon", "Where", "How", "Drive"] },
    { week: 7, focus: "Feelings & Questions", items: ["Happy", "Sad", "Angry", "Tired", "Good", "Bad", "Why", "Which", "How-many"] },
    { week: 8, focus: "Conversation", items: ["Review all: Combining signs, facial expressions, and speed"] }
];

// DOM Elements
const gridView = document.getElementById('grid-view');
const logView = document.getElementById('log-view');
const toolboxView = document.getElementById('toolbox-view');
const signsLibraryView = document.getElementById('signs-library-view');
const curriculumView = document.getElementById('curriculum-view');
const quizzesView = document.getElementById('quizzes-view');

const daysGrid = document.getElementById('days-grid');
const dateTitle = document.getElementById('current-date-title');
const youtubeInput = document.getElementById('youtube-url');
const videoContainer = document.getElementById('video-container');

// ---- Helper: YouTube ID Extractor ----
function extractYouTubeId(url) {
    if (!url) return null;
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|shorts\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
}

// ---- Helper: Direct video file detector (mp4/webm/ogg/mov, ignoring query strings) ----
function isDirectVideoFile(url) {
    if (!url) return false;
    const cleanUrl = url.split('?')[0].split('#')[0];
    return /\.(mp4|webm|ogg|mov)$/i.test(cleanUrl);
}

// ---- Unified video renderer ----
// mode: 'main' (day log, controls visible, no autoplay)
//       'preview' (sign modal / polaroid, autoplay muted loop, no controls)
function getVideoEmbedHTML(url, mode) {
    if (!url) {
        return '<i class="ph ph-youtube-logo play-icon" style="color:#ccc;"></i>';
    }

    const youtubeId = extractYouTubeId(url);
    if (youtubeId) {
        if (mode === 'preview') {
            return `<iframe src="https://www.youtube.com/embed/${youtubeId}?autoplay=1&mute=1&controls=0&loop=1&playlist=${youtubeId}&playsinline=1" style="pointer-events: none !important; user-select: none;" allow="autoplay; fullscreen" tabindex="-1"></iframe>`;
        }
        return `<iframe src="https://www.youtube.com/embed/${youtubeId}" allowfullscreen></iframe>`;
    }

    if (isDirectVideoFile(url)) {
        if (mode === 'preview') {
            return `<video src="${url}" autoplay muted loop playsinline style="pointer-events:none; width:100%; height:100%; object-fit:cover;"></video>`;
        }
        return `<video src="${url}" controls playsinline style="width:100%; height:100%; object-fit:contain; background:#000;"></video>`;
    }

    // Not a recognized playable link (e.g. a webpage like a Signing Savvy or Handspeak article link)
    return '<i class="ph ph-link-simple play-icon" style="color:#ccc;"></i>';
}

// ---- Click Sound ----
function playClickSound() {
    try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.08);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.08);
    } catch (e) { /* audio not available, ignore */ }
}

// Fetch Data on Load
async function loadData() {
    const response = await fetch('/api/data');
    db = await response.json();
    if (!db.curriculum_progress) db.curriculum_progress = {};
    if (!db.signs) db.signs = {};
    if (!db.review) db.review = {};
    
    initGrid();
    populateSignsDatalist();
    populateToolsDatalist();
}

function switchView(viewToShow) {
    [gridView, logView, toolboxView, signsLibraryView, curriculumView, quizzesView].forEach(v => v.classList.remove('active'));
    viewToShow.classList.add('active');
}

// ---- Day Auto-Save Logic ----
async function autoSaveDay() {
    if (!currentDay) return;
    if (!db.days[currentDay]) db.days[currentDay] = { signs: [], tools: [] };
    
    db.days[currentDay].notes = document.getElementById('log-notes').value;
    db.days[currentDay].video = youtubeInput.value;

    await fetch('/api/save_day', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            day: currentDay,
            data: db.days[currentDay],
            global_signs: db.signs
        })
    });
}

// Debounce note typing
document.getElementById('log-notes').addEventListener('input', () => {
    clearTimeout(daySaveTimeout);
    daySaveTimeout = setTimeout(autoSaveDay, 500);
});

// 1. Initialize Grid
function initGrid() {
    daysGrid.innerHTML = '';
    for (let i = 1; i <= 47; i++) {
        const btn = document.createElement('button');
        btn.classList.add('day-box');
        btn.innerText = i;
        if (db.days[i] && (db.days[i].notes || (db.days[i].signs && db.days[i].signs.length > 0) || db.days[i].video)) {
            btn.classList.add('has-data');
        }
        btn.addEventListener('click', () => { playClickSound(); openDayLog(i); });
        daysGrid.appendChild(btn);
    }
    const plusBtn = document.createElement('button');
    plusBtn.classList.add('day-box');
    plusBtn.innerHTML = '<i class="ph ph-plus"></i>';
    plusBtn.addEventListener('click', () => { playClickSound(); openDayLog(document.querySelectorAll('.day-box').length); });
    daysGrid.appendChild(plusBtn);
}

// 2. Open Specific Day Log
function openDayLog(dayNumber) {
    currentDay = dayNumber;
    document.getElementById('current-day-badge').innerText = dayNumber;
    
    const options = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' };
    dateTitle.innerText = new Date().toLocaleDateString('en-US', options).toUpperCase();

    if (!db.days[currentDay]) db.days[currentDay] = { notes: '', signs: [], tools: [], video: '' };
    if (!db.days[currentDay].signs) db.days[currentDay].signs = [];
    if (!db.days[currentDay].tools) db.days[currentDay].tools = [];
    const dayData = db.days[currentDay];

    document.getElementById('log-notes').value = dayData.notes || '';
    renderSigns(dayData.signs);
    renderDayTools(dayData.tools);
    document.getElementById('tool-input-group').classList.add('hidden');
    youtubeInput.value = dayData.video || '';
    document.getElementById('video-input-group').classList.add('hidden');
    renderVideo(dayData.video);
    renderResources(dayData);

    switchView(logView);
    requestAnimationFrame(syncNotesHeight);
}

function syncNotesHeight() {
    const notes = document.getElementById('log-notes');
    if (videoContainer.offsetHeight > 0) {
        notes.style.height = videoContainer.offsetHeight + 'px';
    }
}
window.addEventListener('resize', () => {
    if (logView.classList.contains('active')) syncNotesHeight();
});

// 3. Video Embed Logic (YouTube, direct mp4/webm/etc, or placeholder)
document.getElementById('edit-video-btn').addEventListener('click', () => {
    const group = document.getElementById('video-input-group');
    group.classList.toggle('hidden');
    if (!group.classList.contains('hidden')) {
        youtubeInput.focus();
    }
});

youtubeInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        renderVideo(youtubeInput.value);
        document.getElementById('video-input-group').classList.add('hidden');
        requestAnimationFrame(syncNotesHeight);
        autoSaveDay(); // Trigger save
    }
});

function renderVideo(url) {
    videoContainer.innerHTML = getVideoEmbedHTML(url, 'main');
    requestAnimationFrame(syncNotesHeight);
}

// ---- Media Resources (YouTube / TikTok links) ----
// A grid of the actual videos you used to learn from that day, embedded directly.
// TikTok's public embed doesn't support reliable autoplay/mute control the way
// YouTube's does, so those just embed as TikTok's normal player.
function extractTiktokId(url) {
    const match = url.match(/tiktok\.com\/.*\/video\/(\d+)/);
    return match ? match[1] : null;
}

function renderResources(dayData) {
    const grid = document.getElementById('resources-grid');
    grid.innerHTML = '';
    const resources = dayData.resources || [];

    resources.forEach((res, idx) => {
        const card = document.createElement('div');
        card.classList.add('resource-card', res.type);

        if (res.type === 'yt') {
            card.innerHTML = `
                <iframe id="resource-frame-${idx}" src="https://www.youtube.com/embed/${res.id}?autoplay=1&mute=1&loop=1&playlist=${res.id}&controls=1" allow="autoplay; encrypted-media" allowfullscreen></iframe>
                <span class="resource-card-label">YouTube</span>
                <div class="resource-card-controls">
                    <button class="resource-card-btn muted" data-action="unmute" title="Unmute"><i class="ph ph-speaker-slash"></i></button>
                    <button class="resource-card-btn" data-action="delete" title="Remove"><i class="ph ph-trash"></i></button>
                </div>
            `;
            card.querySelector('[data-action="unmute"]').addEventListener('click', (e) => {
                const btn = e.currentTarget;
                const frame = document.getElementById(`resource-frame-${idx}`);
                const isMuted = btn.classList.contains('muted');
                frame.src = `https://www.youtube.com/embed/${res.id}?autoplay=1&mute=${isMuted ? 0 : 1}&loop=1&playlist=${res.id}&controls=1`;
                btn.classList.toggle('muted', !isMuted);
                btn.innerHTML = isMuted ? '<i class="ph ph-speaker-high"></i>' : '<i class="ph ph-speaker-slash"></i>';
                btn.title = isMuted ? 'Mute' : 'Unmute';
            });
        } else if (res.type === 'tiktok') {
            card.innerHTML = `
                <iframe src="https://www.tiktok.com/embed/v2/${res.id}?autoplay=1" allow="autoplay; encrypted-media" allowfullscreen></iframe>
                <span class="resource-card-label">TikTok</span>
                <div class="resource-card-controls">
                    <button class="resource-card-btn" data-action="delete" title="Remove"><i class="ph ph-trash"></i></button>
                </div>
            `;
        } else {
            card.innerHTML = `
                <a href="${res.url}" target="_blank" rel="noopener" style="display:flex; align-items:center; justify-content:center; height:160px; text-align:center; padding:15px; word-break:break-all;">${res.url}</a>
                <div class="resource-card-controls">
                    <button class="resource-card-btn" data-action="delete" title="Remove"><i class="ph ph-trash"></i></button>
                </div>
            `;
        }

        card.querySelector('[data-action="delete"]').addEventListener('click', () => {
            dayData.resources.splice(idx, 1);
            renderResources(dayData);
            autoSaveDay();
        });

        grid.appendChild(card);
    });
}

document.getElementById('add-resource-btn').addEventListener('click', () => {
    playClickSound();
    document.getElementById('resource-input-group').classList.remove('hidden');
    document.getElementById('new-resource-url').focus();
});

document.getElementById('new-resource-url').addEventListener('keypress', (e) => {
    if (e.key !== 'Enter') return;
    const input = e.target;
    const url = input.value.trim();
    if (!url || !currentDay) return;

    const dayData = db.days[currentDay];
    if (!dayData.resources) dayData.resources = [];

    const ytId = extractYouTubeId(url);
    const tiktokId = extractTiktokId(url);
    if (ytId) {
        dayData.resources.push({ url, type: 'yt', id: ytId });
    } else if (tiktokId) {
        dayData.resources.push({ url, type: 'tiktok', id: tiktokId });
    } else {
        dayData.resources.push({ url, type: 'link' });
    }

    input.value = '';
    document.getElementById('resource-input-group').classList.add('hidden');
    renderResources(dayData);
    autoSaveDay();
});

// 4. Signs Logic (Datalist & Adding)
function populateSignsDatalist() {
    const datalist = document.getElementById('global-signs-list');
    datalist.innerHTML = '';
    Object.keys(db.signs).sort().forEach(sign => {
        datalist.innerHTML += `<option value="${sign}">`;
    });
}

document.getElementById('add-sign-btn').addEventListener('click', () => {
    const group = document.getElementById('sign-input-group');
    group.classList.toggle('hidden');
    if (!group.classList.contains('hidden')) document.getElementById('new-sign-input').focus();
});

document.getElementById('new-sign-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && e.target.value.trim() !== '') {
        const newSign = e.target.value.trim();

        if (!db.signs[newSign]) {
            db.signs[newSign] = { video: "", notes: "" };
            populateSignsDatalist();
            saveSignData(newSign); 
        }

        if (!db.days[currentDay]) db.days[currentDay] = { signs: [] };
        if (!db.days[currentDay].signs) db.days[currentDay].signs = [];

        if (!db.days[currentDay].signs.includes(newSign)) {
            db.days[currentDay].signs.push(newSign);
            renderSigns(db.days[currentDay].signs);
            autoSaveDay(); // Trigger save
        }

        e.target.value = '';
        document.getElementById('sign-input-group').classList.add('hidden');
    }
});

function renderSigns(signs) {
    const container = document.getElementById('signs-container');
    container.innerHTML = '';
    signs.forEach((sign, index) => {
        container.innerHTML += `
            <div class="chip">
                <span class="chip-text" style="cursor:pointer;" onclick="openSignModal('${sign.replace(/'/g, "\\'")}', 'day')">${sign}</span>
                <span class="delete-chip" onclick="removeSign(${index})"><i class="ph ph-x"></i></span>
            </div>`;
    });
}

window.removeSign = function(index) {
    db.days[currentDay].signs.splice(index, 1);
    renderSigns(db.days[currentDay].signs);
    autoSaveDay(); // Trigger save
}

// 5. Tools in Daily Log 
function toolIconFor(name) {
    const lower = name.toLowerCase();
    if (lower.includes('gemini')) return 'ph-sparkle';
    if (lower.includes('lifeprint')) return 'ph-book-open';
    return 'ph-wrench';
}

function populateToolsDatalist() {
    const datalist = document.getElementById('global-tools-list');
    datalist.innerHTML = '';
    db.tools.forEach(tool => {
        datalist.innerHTML += `<option value="${tool.name}">`;
    });
}

document.getElementById('add-tool-to-day-btn').addEventListener('click', () => {
    playClickSound();
    const group = document.getElementById('tool-input-group');
    group.classList.toggle('hidden');
    if (!group.classList.contains('hidden')) document.getElementById('new-tool-input').focus();
});

document.getElementById('new-tool-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && e.target.value.trim() !== '') {
        const typed = e.target.value.trim();
        const match = db.tools.find(t => t.name.toLowerCase() === typed.toLowerCase());

        if (!match) {
            alert(`"${typed}" isn't in your Toolbox yet. Add it there first.`);
            return;
        }

        if (!db.days[currentDay].tools) db.days[currentDay].tools = [];
        if (!db.days[currentDay].tools.includes(match.name)) {
            db.days[currentDay].tools.push(match.name);
            renderDayTools(db.days[currentDay].tools);
            autoSaveDay(); // Trigger save
        }

        e.target.value = '';
        document.getElementById('tool-input-group').classList.add('hidden');
    }
});

function renderDayTools(selectedNames) {
    const container = document.getElementById('tools-container');
    container.innerHTML = '';
    selectedNames.forEach(name => {
        const toolDef = db.tools.find(t => t.name === name);
        const link = toolDef ? toolDef.link : '';
        const icon = toolIconFor(name);

        const row = document.createElement('div');
        row.classList.add('tool-row');
        row.innerHTML = `
            <i class="ph ${icon}"></i>
            <span class="tool-row-name">${name}</span>
            <span class="delete-chip"><i class="ph ph-x"></i></span>
        `;
        row.querySelector('.tool-row-name').addEventListener('click', () => {
            if (link) window.open(link, '_blank');
        });
        row.querySelector('.delete-chip').addEventListener('click', (e) => {
            e.stopPropagation();
            removeDayTool(name);
        });
        container.appendChild(row);
    });
}

function removeDayTool(name) {
    db.days[currentDay].tools = db.days[currentDay].tools.filter(t => t !== name);
    renderDayTools(db.days[currentDay].tools);
    autoSaveDay(); // Trigger save
}

// 6. Signs Library (Polaroid Grid) & Modal Logic
function renderSignsLibrary(filterText = "") {
    const grid = document.getElementById('signs-library-grid');
    grid.innerHTML = '';

    const signNames = Object.keys(db.signs)
        .filter(s => s.toLowerCase().includes(filterText.toLowerCase()))
        .sort();

    signNames.forEach(sign => {
        const signData = db.signs[sign];
        const videoUrl = signData.video;
        
        const card = document.createElement('div');
        card.className = 'polaroid-card';
        
        const videoArea = document.createElement('div');
        videoArea.className = 'polaroid-video';
        videoArea.innerHTML = getVideoEmbedHTML(videoUrl, 'preview');

        const labelArea = document.createElement('div');
        labelArea.className = 'polaroid-label';
        labelArea.innerText = sign;

        card.addEventListener('click', () => {
            playClickSound();
            openSignModal(sign, 'library');
        });

        card.appendChild(videoArea);
        card.appendChild(labelArea);
        grid.appendChild(card);
    });
}

document.getElementById('signs-search-bar').addEventListener('input', (e) => {
    renderSignsLibrary(e.target.value);
});

// -- Modal System --
// context: 'library' (opened from Signs Library, full control incl. delete)
//          'day' (opened from a day-log chip, video/notes editable, no delete)
window.openSignModal = function(sign, context) {
    currentModalSign = sign;
    const modal = document.getElementById('sign-modal');
    const data = db.signs[sign] || { video: '', notes: '' };
    
    document.getElementById('modal-sign-title').innerText = sign;
    
    const videoInput = document.getElementById('modal-sign-video');
    const notesInput = document.getElementById('modal-sign-notes');
    const delBtn = document.getElementById('modal-delete-sign');
    const vidSection = document.getElementById('modal-video-section');

    videoInput.value = data.video || '';
    notesInput.value = data.notes || '';
    renderModalVideo(data.video);
    
    // Video and notes are editable from both the Signs Library and a day log,
    // so a video can be attached to a sign right from the day-log page.
    videoInput.readOnly = false;
    notesInput.readOnly = false;
    vidSection.style.display = 'block';
    notesInput.style.border = 'var(--thin-border)';
    notesInput.style.background = 'var(--white)';

    // Global delete stays library-only, since deleting a sign there also
    // strips it out of every day it was logged on.
    delBtn.style.display = (context === 'library') ? 'block' : 'none';
    
    // Populate Days
    const daysContainer = document.getElementById('modal-sign-days');
    daysContainer.innerHTML = '';
    let foundDays = 0;
    
    for (const [dayNum, dayData] of Object.entries(db.days)) {
        if (dayData.signs && dayData.signs.includes(sign)) {
            daysContainer.innerHTML += `<div class="mini-day-box" onclick="jumpToDayFromModal(${dayNum})">${dayNum}</div>`;
            foundDays++;
        }
    }
    
    if (foundDays === 0) daysContainer.innerHTML = '<span style="color:#888;">Not logged yet</span>';

    modal.classList.remove('hidden');
};

window.jumpToDayFromModal = function(dayNum) {
    document.getElementById('sign-modal').classList.add('hidden');
    openDayLog(dayNum);
};

// Modal Auto-Save Listeners
document.getElementById('modal-sign-video').addEventListener('change', (e) => {
    if (!currentModalSign || e.target.readOnly) return;
    if (!db.signs[currentModalSign]) db.signs[currentModalSign] = { video: '', notes: '' };
    db.signs[currentModalSign].video = e.target.value;
    renderModalVideo(e.target.value);
    saveSignData(currentModalSign);
});

document.getElementById('modal-sign-notes').addEventListener('input', (e) => {
    if (!currentModalSign || e.target.readOnly) return;
    if (!db.signs[currentModalSign]) db.signs[currentModalSign] = { video: '', notes: '' };
    db.signs[currentModalSign].notes = e.target.value;
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => saveSignData(currentModalSign), 500); 
});

function renderModalVideo(url) {
    const container = document.getElementById('modal-video-preview');
    container.innerHTML = getVideoEmbedHTML(url, 'preview');
}

async function saveSignData(sign) {
    await fetch('/api/save_sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: sign, data: db.signs[sign] })
    });
}

// Modal Actions
document.querySelector('.close-modal').addEventListener('click', () => {
    document.getElementById('sign-modal').classList.add('hidden');
    
    const modalVideo = document.getElementById('modal-video-preview');
    if(modalVideo) modalVideo.innerHTML = '';
    
    if (signsLibraryView.classList.contains('active')) renderSignsLibrary();
});

document.getElementById('modal-delete-sign').addEventListener('click', async () => {
    if(!confirm(`Are you sure you want to delete "${currentModalSign}" globally? This removes it from all daily logs.`)) return;
    
    delete db.signs[currentModalSign];
    for (const day in db.days) {
        if (db.days[day].signs) {
            db.days[day].signs = db.days[day].signs.filter(s => s !== currentModalSign);
        }
    }
    
    await fetch('/api/delete_sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: currentModalSign })
    });
    
    document.getElementById('sign-modal').classList.add('hidden');
    populateSignsDatalist();
    
    if(signsLibraryView.classList.contains('active')) renderSignsLibrary();
    if(logView.classList.contains('active')) renderSigns(db.days[currentDay].signs);
});

// 7. Navigation Event Listeners
document.getElementById('back-btn').addEventListener('click', () => {
    playClickSound();
    switchView(gridView);
    initGrid();
});

document.getElementById('open-tools-btn').addEventListener('click', () => {
    playClickSound();
    renderToolbox();
    switchView(toolboxView);
});
document.getElementById('close-tools-btn').addEventListener('click', () => {
    playClickSound();
    switchView(gridView);
});

document.getElementById('open-signs-btn').addEventListener('click', () => {
    playClickSound();
    renderSignsLibrary();
    switchView(signsLibraryView);
});
document.getElementById('close-signs-btn').addEventListener('click', () => {
    playClickSound();
    switchView(gridView);
});

document.getElementById('open-curriculum-btn').addEventListener('click', () => {
    playClickSound();
    renderCurriculum();
    switchView(curriculumView);
});
document.getElementById('close-curriculum-btn').addEventListener('click', () => {
    playClickSound();
    switchView(gridView);
});

document.getElementById('add-new-sign-library-btn').addEventListener('click', async () => {
    playClickSound();
    
    const newSignInput = prompt("Enter the name of the new sign:");
    if (!newSignInput || newSignInput.trim() === '') return;
    
    const signName = newSignInput.trim();
    
    if (db.signs[signName]) {
        alert(`The sign "${signName}" already exists!`);
        openSignModal(signName, 'library');
        return;
    }

    db.signs[signName] = { video: "", notes: "" };
    
    await fetch('/api/save_sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: signName, data: db.signs[signName] })
    });

    populateSignsDatalist();
    renderSignsLibrary(document.getElementById('signs-search-bar').value);
    
    openSignModal(signName, 'library');
});

// 9. Toolbox Logic
function renderToolbox() {
    const grid = document.getElementById('toolbox-grid');
    grid.innerHTML = '';
    db.tools.forEach((tool, index) => {
        const item = document.createElement('div');
        item.classList.add('toolbox-item');
        item.innerHTML = `
            <div class="toolbox-info">
                <span class="tool-name">${tool.name}</span>
                ${tool.link ? `<a class="tool-link" href="${tool.link}" target="_blank" rel="noopener">${tool.link}</a>` : '<span class="tool-link" style="color:#aaa;">No link set</span>'}
            </div>
            <div class="toolbox-actions" style="display:flex; gap:8px;">
                <button class="small-icon-btn edit-tool-btn" title="Edit"><i class="ph ph-pencil-simple"></i></button>
                <button class="small-icon-btn delete-tool-btn" title="Delete"><i class="ph ph-trash"></i></button>
            </div>
        `;
        item.querySelector('.edit-tool-btn').addEventListener('click', () => editToolboxItem(index));
        item.querySelector('.delete-tool-btn').addEventListener('click', () => deleteToolboxItem(index));
        grid.appendChild(item);
    });
}

function editToolboxItem(index) {
    const grid = document.getElementById('toolbox-grid');
    const tool = db.tools[index];
    const item = grid.children[index];
    item.innerHTML = `
        <div class="edit-inputs">
            <input type="text" class="edit-tool-name" value="${tool.name}" placeholder="Tool name">
            <input type="text" class="edit-tool-link" value="${tool.link || ''}" placeholder="Link (https://...)">
        </div>
        <div class="toolbox-actions" style="display:flex; gap:8px;">
            <button class="small-icon-btn save-tool-btn" title="Save"><i class="ph ph-check"></i></button>
        </div>
    `;
    item.querySelector('.save-tool-btn').addEventListener('click', async () => {
        const newName = item.querySelector('.edit-tool-name').value.trim();
        const newLink = item.querySelector('.edit-tool-link').value.trim();
        if (!newName) { alert("Tool name can't be empty"); return; }
        db.tools[index] = { name: newName, link: newLink };
        await saveTools();
        populateToolsDatalist();
        renderToolbox();
    });
}

function deleteToolboxItem(index) {
    if (!confirm(`Delete "${db.tools[index].name}"?`)) return;
    db.tools.splice(index, 1);
    saveTools().then(() => {
        populateToolsDatalist();
        renderToolbox();
    });
}

async function saveTools() {
    await fetch('/api/save_tools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tools: db.tools })
    });
}

document.getElementById('add-tool-btn').addEventListener('click', () => {
    playClickSound();
    db.tools.push({ name: '', link: '' });
    renderToolbox();
    editToolboxItem(db.tools.length - 1);
});

// 10. Curriculum Logic
function renderCurriculum() {
    const grid = document.getElementById('curriculum-grid');
    grid.innerHTML = '';

    CURRICULUM.forEach(weekData => {
        const total = weekData.items.length;
        const checkedCount = weekData.items.filter(item => db.curriculum_progress[`${weekData.week}-${item}`]).length;

        const card = document.createElement('div');
        card.classList.add('week-card');
        card.innerHTML = `
            <div class="week-card-header">
                <div>
                    <div class="week-card-title">Week ${weekData.week}: ${weekData.focus}</div>
                </div>
                <div class="week-progress">${checkedCount}/${total} <i class="ph ph-caret-down"></i></div>
            </div>
            <div class="week-items"></div>
        `;

        card.querySelector('.week-card-header').addEventListener('click', () => {
            card.querySelector('.week-items').classList.toggle('open');
        });

        const itemsContainer = card.querySelector('.week-items');
        weekData.items.forEach(item => {
            const key = `${weekData.week}-${item}`;
            const isChecked = !!db.curriculum_progress[key];

            const row = document.createElement('label');
            row.classList.add('curriculum-item');
            if (isChecked) row.classList.add('checked');
            row.innerHTML = `<input type="checkbox" ${isChecked ? 'checked' : ''}> <span>${item}</span>`;

            row.querySelector('input').addEventListener('change', (e) => {
                db.curriculum_progress[key] = e.target.checked;
                row.classList.toggle('checked', e.target.checked);
                saveCurriculum();
                updateWeekProgressLabel(card, weekData);
            });

            itemsContainer.appendChild(row);
        });

        grid.appendChild(card);
    });
}

function updateWeekProgressLabel(card, weekData) {
    const total = weekData.items.length;
    const checkedCount = weekData.items.filter(item => db.curriculum_progress[`${weekData.week}-${item}`]).length;
    card.querySelector('.week-progress').innerHTML = `${checkedCount}/${total} <i class="ph ph-caret-down"></i>`;
}

async function saveCurriculum() {
    await fetch('/api/save_curriculum', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ progress: db.curriculum_progress })
    });
}

// 10b. Spaced Repetition (Anki) Logic
//
// Every sign that has ever been logged on at least one day becomes eligible
// for review. New signs start "new" (never reviewed). Once graded, a sign
// gets an interval (in days) and a due date, following a simplified SM-2
// scheduler. Only signs actually used in a day are ever considered here.

function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDaysISO(isoDate, days) {
    const d = new Date(isoDate + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Every sign that has been attached to at least one logged day.
function getLearnedSigns() {
    const learned = new Set();
    Object.values(db.days).forEach(dayData => {
        if (dayData && dayData.signs) {
            dayData.signs.forEach(s => learned.add(s));
        }
    });
    return learned;
}

// Splits learned signs into "new" (never graded) and "due" (review date has
// arrived) based on db.review. Anything not yet due or not yet learned is
// left out entirely.
function getAnkiQueueData() {
    const learned = getLearnedSigns();
    const today = todayISO();
    const newSigns = [];
    const dueSigns = [];

    learned.forEach(sign => {
        const r = db.review[sign];
        if (!r) {
            newSigns.push(sign);
        } else if (r.due <= today) {
            dueSigns.push(sign);
        }
    });

    return { newSigns, dueSigns };
}

function updateAnkiDueText() {
    const { newSigns, dueSigns } = getAnkiQueueData();
    const total = newSigns.length + dueSigns.length;
    const text = document.getElementById('anki-due-text');
    const btn = document.getElementById('start-anki-btn');

    if (total === 0) {
        text.innerText = "You're all caught up! No cards due today.";
        btn.disabled = true;
        btn.style.opacity = '0.4';
        btn.style.cursor = 'not-allowed';
    } else {
        text.innerText = `${total} card${total === 1 ? '' : 's'} due today (${newSigns.length} new, ${dueSigns.length} review${dueSigns.length === 1 ? '' : 's'}).`;
        btn.disabled = false;
        btn.style.opacity = '1';
        btn.style.cursor = 'pointer';
    }
}

// Simplified SM-2. grade is 'again' | 'hard' | 'good' | 'easy'.
function scheduleReview(sign, grade) {
    const existing = db.review[sign] || { ease: 2.5, interval: 0, reps: 0, lapses: 0, due: todayISO() };
    let { ease, interval, reps, lapses } = existing;
    const today = todayISO();

    if (grade === 'again') {
        lapses += 1;
        reps = 0;
        interval = 1;
        ease = Math.max(1.3, ease - 0.2);
        // Due tomorrow, not "today forever" — it'll still resurface later in *this*
        // session via the requeue logic below, but won't get permanently stuck as
        // "due every single day" once the session ends.
    } else if (grade === 'hard') {
        ease = Math.max(1.3, ease - 0.15);
        interval = reps === 0 ? 1 : Math.max(1, Math.round(interval * 1.2));
        reps += 1;
    } else if (grade === 'easy') {
        ease = ease + 0.15;
        interval = reps === 0 ? 4 : Math.round(interval * ease * 1.3);
        reps += 1;
    } else { // 'good'
        if (reps === 0) interval = 1;
        else if (reps === 1) interval = 6;
        else interval = Math.round(interval * ease);
        reps += 1;
    }

    const due = addDaysISO(today, interval);
    db.review[sign] = { ease, interval, reps, lapses, due };
    saveReview(sign);
}

async function saveReview(sign) {
    await fetch('/api/save_review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ review: { [sign]: db.review[sign] } })
    });
}

document.getElementById('start-anki-btn').addEventListener('click', () => {
    const { newSigns, dueSigns } = getAnkiQueueData();
    const all = shuffleArray([...newSigns, ...dueSigns]);
    if (all.length === 0) return;

    playClickSound();
    quizMode = 'anki';
    quizQueue = all;
    quizIndex = 0;
    ankiCardsSeen = 0;
    ankiCardsTotalToday = all.length;

    document.getElementById('quiz-day-picker').classList.add('hidden');
    document.getElementById('quiz-session').classList.remove('hidden');
    setQuizControlsForMode();
    showQuizCard();
});

function setQuizControlsForMode() {
    const normalControls = document.getElementById('quiz-controls-normal');
    const ankiGrade = document.getElementById('quiz-controls-anki-grade');
    const ankiInfo = document.getElementById('anki-session-info');
    const progress = document.getElementById('quiz-progress');

    if (quizMode === 'anki') {
        normalControls.classList.add('hidden');
        ankiGrade.classList.add('hidden'); // only shown once the card is flipped
        ankiInfo.classList.remove('hidden');
        progress.classList.add('hidden');
    } else {
        normalControls.classList.remove('hidden');
        ankiGrade.classList.add('hidden');
        ankiInfo.classList.add('hidden');
        progress.classList.remove('hidden');
    }
}

// Two-button grading, same as the Korean app's "Still Learning" / "Got It!" — maps
// onto the SM-2 scheduler as 'again' (reset) / 'good' (normal progression) under
// the hood, so the algorithm still runs, it's just not exposed as 4 raw grades.
document.querySelectorAll('#quiz-controls-anki-grade .icon-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        playClickSound();
        const grade = btn.dataset.grade;
        const sign = quizQueue[quizIndex];
        scheduleReview(sign, grade);
        ankiCardsSeen += 1;

        // "Still Learning" cards get requeued a few cards later in the same session
        // instead of disappearing, so they get another pass today.
        quizQueue.splice(quizIndex, 1);
        if (grade === 'again') {
            const reinsertAt = Math.min(quizQueue.length, quizIndex + 3);
            quizQueue.splice(reinsertAt, 0, sign);
        }

        if (quizQueue.length === 0) {
            endAnkiSession();
            return;
        }
        if (quizIndex >= quizQueue.length) quizIndex = 0;
        showQuizCard();
    });
});

function endAnkiSession() {
    document.getElementById('quiz-session').classList.add('hidden');
    document.getElementById('quiz-day-picker').classList.remove('hidden');
    updateAnkiDueText();
    renderQuizDayPicker();
}
// 11. Quiz Logic
document.getElementById('open-quizzes-btn').addEventListener('click', () => {
    playClickSound();
    document.getElementById('quiz-session').classList.add('hidden');
    document.getElementById('quiz-day-picker').classList.remove('hidden');
    quizMode = 'normal';
    lastClickedQuizDay = null;
    updateAnkiDueText();
    renderQuizDayPicker();
    switchView(quizzesView);
});
document.getElementById('close-quizzes-btn').addEventListener('click', () => {
    playClickSound();
    switchView(gridView);
});

function renderQuizDayPicker() {
    const grid = document.getElementById('quiz-days-grid');
    grid.innerHTML = '';

    const dayNums = Object.keys(db.days)
        .filter(d => db.days[d].signs && db.days[d].signs.length > 0)
        .sort((a, b) => Number(a) - Number(b));

    if (dayNums.length === 0) {
        grid.innerHTML = '<p style="grid-column: 1 / -1; color:#888; font-size:1.2rem;">No days with signs logged yet.</p>';
        return;
    }

    dayNums.forEach(day => {
        const btn = document.createElement('button');
        btn.classList.add('day-box', 'quiz-day-box');
        btn.innerText = day;
        if (selectedQuizDays.has(day)) btn.classList.add('selected');

        // Prevent the browser's native shift-click text selection, which
        // otherwise highlights the day numbers blue while range-selecting.
        btn.addEventListener('mousedown', (e) => {
            if (e.shiftKey) e.preventDefault();
        });

        btn.addEventListener('click', (e) => {
            playClickSound();

            if (e.shiftKey && lastClickedQuizDay !== null && dayNums.includes(lastClickedQuizDay)) {
                const startIdx = dayNums.indexOf(lastClickedQuizDay);
                const endIdx = dayNums.indexOf(day);
                const [lo, hi] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
                for (let i = lo; i <= hi; i++) {
                    selectedQuizDays.add(dayNums[i]);
                }
            } else {
                if (selectedQuizDays.has(day)) {
                    selectedQuizDays.delete(day);
                } else {
                    selectedQuizDays.add(day);
                }
                lastClickedQuizDay = day;
            }

            renderQuizDayPicker();
        });
        grid.appendChild(btn);
    });
}

function shuffleArray(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

document.getElementById('start-quiz-btn').addEventListener('click', () => {
    if (selectedQuizDays.size === 0) {
        alert('Pick at least one day to be quizzed on.');
        return;
    }

    const signSet = new Set();
    selectedQuizDays.forEach(day => {
        const dayData = db.days[day];
        if (dayData && dayData.signs) {
            dayData.signs.forEach(s => signSet.add(s));
        }
    });

    if (signSet.size === 0) {
        alert('No signs found in the selected days.');
        return;
    }

    playClickSound();
    quizMode = 'normal';
    quizQueue = shuffleArray(Array.from(signSet));
    quizIndex = 0;
    document.getElementById('quiz-day-picker').classList.add('hidden');
    document.getElementById('quiz-session').classList.remove('hidden');
    setQuizControlsForMode();
    showQuizCard();
});

function showQuizCard() {
    const flashcard = document.getElementById('quiz-flashcard');
    flashcard.classList.remove('flipped');
    document.getElementById('quiz-back-video').innerHTML = '';
    document.getElementById('quiz-controls-anki-grade').classList.add('hidden');

    const sign = quizQueue[quizIndex];
    document.getElementById('quiz-front-word').innerText = sign;

    if (quizMode === 'anki') {
        const remaining = quizQueue.length;
        document.getElementById('anki-session-info').innerText =
            `${ankiCardsSeen} reviewed · ${remaining} left today`;
    } else {
        document.getElementById('quiz-progress').innerText = `${quizIndex + 1} / ${quizQueue.length}`;
        document.getElementById('quiz-prev-btn').disabled = quizIndex === 0;
        document.getElementById('quiz-next-btn').disabled = quizIndex === quizQueue.length - 1;
    }
}

function flipQuizCard() {
    const flashcard = document.getElementById('quiz-flashcard');
    const flipping = !flashcard.classList.contains('flipped');
    flashcard.classList.toggle('flipped');

    if (flipping) {
        const sign = quizQueue[quizIndex];
        const signData = db.signs[sign];
        const backVideo = document.getElementById('quiz-back-video');
        if (signData && signData.video) {
            // 'preview' mode autoplays muted and loops forever, so the sign
            // keeps replaying until the card is flipped or changed.
            backVideo.innerHTML = getVideoEmbedHTML(signData.video, 'preview');
        } else {
            backVideo.innerHTML = '<p style="color:#888; padding: 20px; text-align:center; font-size:1.2rem;">No video saved for this sign yet. Add one from the Signs Library.</p>';
        }

        if (quizMode === 'anki') {
            document.getElementById('quiz-controls-anki-grade').classList.remove('hidden');
        }
    } else if (quizMode === 'anki') {
        document.getElementById('quiz-controls-anki-grade').classList.add('hidden');
    }
}

// Tap the card itself to flip it — no separate "Flip Card" button, same as the
// Korean app's quiz/flashcard screens.
document.getElementById('quiz-flashcard').addEventListener('click', flipQuizCard);

document.getElementById('quiz-next-btn').addEventListener('click', () => {
    if (quizIndex < quizQueue.length - 1) {
        playClickSound();
        quizIndex++;
        showQuizCard();
    }
});
document.getElementById('quiz-prev-btn').addEventListener('click', () => {
    if (quizIndex > 0) {
        playClickSound();
        quizIndex--;
        showQuizCard();
    }
});

document.getElementById('quiz-end-btn').addEventListener('click', () => {
    playClickSound();
    document.getElementById('quiz-session').classList.add('hidden');
    document.getElementById('quiz-day-picker').classList.remove('hidden');
    quizMode = 'normal';
    lastClickedQuizDay = null;
    updateAnkiDueText();
    renderQuizDayPicker();
});

// Start
loadData();