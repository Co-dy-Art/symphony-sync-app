// public/main.js

const statusElement = document.getElementById('status');
const masterControls = document.getElementById('master-controls');
const slaveDisplay = document.getElementById('slave-display');
const playBtn = document.getElementById('playBtn');
const stopBtn = document.getElementById('stopBtn');
const slaveAssignedTrackSpan = document.getElementById('slaveAssignedTrack');
const playbackStatusSpan = document.getElementById('playbackStatus');
const slaveListContainer = document.getElementById('slave-list-container');
const masterTrackSelect = document.getElementById('masterTrackSelect');

const masterSecretInput = document.createElement('input');
masterSecretInput.type = 'password';
masterSecretInput.placeholder = 'Enter Master Secret';
masterSecretInput.className = 'secret-input';

const becomeMasterBtn = document.createElement('button');
becomeMasterBtn.textContent = 'Become Master';
becomeMasterBtn.className = 'become-master-btn';

slaveDisplay.prepend(becomeMasterBtn);
slaveDisplay.prepend(masterSecretInput);

let audioActivationMessageElement = null;
let ws;
let isMaster = false;
let audioContext = null;
let currentAudioBuffer = null;
let currentAudioSource = null;
let assignedTrack = null;

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/service-worker.js')
            .then(reg => console.log('Service Worker registered.', reg))
            .catch(err => console.error('Service Worker registration failed:', err));
    });
}

function setupAudioContextActivation() {
    if (!audioContext || audioContext.state === 'suspended' || audioContext.state === 'interrupted') {
        try {
            if (!audioContext) {
                audioContext = new (window.AudioContext || window.webkitAudioContext)();
                console.log('AudioContext initialized via user gesture listener.');
            }
            if (audioContext.state === 'suspended' || audioContext.state === 'interrupted') {
                audioContext.resume().then(() => {
                    console.log('AudioContext resumed successfully on user interaction.');
                    document.body.removeEventListener('click', setupAudioContextActivation);
                    document.body.removeEventListener('touchstart', setupAudioContextActivation);
                    if (audioActivationMessageElement) {
                        audioActivationMessageElement.remove();
                        audioActivationMessageElement = null;
                    }
                }).catch(e => {
                    console.error('Error resuming AudioContext:', e);
                    displayAudioActivationPrompt();
                });
            } else {
                document.body.removeEventListener('click', setupAudioContextActivation);
                document.body.removeEventListener('touchstart', setupAudioContextActivation);
                if (audioActivationMessageElement) {
                    audioActivationMessageElement.remove();
                    audioActivationMessageElement = null;
                }
            }
        } catch (e) {
            console.error('Failed to create AudioContext:', e);
            displayAudioActivationPrompt();
        }
    }
}

function displayAudioActivationPrompt() {
    if (!isMaster && (!audioContext || audioContext.state === 'suspended' || audioContext.state === 'interrupted')) {
        if (!audioActivationMessageElement) {
            audioActivationMessageElement = document.createElement('div');
            audioActivationMessageElement.id = 'dynamic-audio-prompt';
            audioActivationMessageElement.style.cssText = `padding: 15px; background-color: #ffe0b2; border: 1px solid #ffb74d; border-radius: 8px; margin-top: 20px; margin-bottom: 20px; color: #333; font-weight: bold; text-align: center; cursor: pointer;`;
            audioActivationMessageElement.innerHTML = `<p>Tap/Click anywhere to enable audio for this device.</p>`;
            document.querySelector('.container').prepend(audioActivationMessageElement);
            audioActivationMessageElement.addEventListener('click', setupAudioContextActivation);
            audioActivationMessageElement.addEventListener('touchstart', setupAudioContextActivation);
        } else {
            audioActivationMessageElement.style.display = 'block';
        }
        playbackStatusSpan.textContent = 'Audio context suspended. Please click to enable.';
    } else if (audioActivationMessageElement) {
        audioActivationMessageElement.style.display = 'none';
    }
}

document.body.addEventListener('click', setupAudioContextActivation);
document.body.addEventListener('touchstart', setupAudioContextActivation);

function connectWebSocket() {
    const wsUrl = window.location.protocol === 'https:' ? 'wss://' + window.location.host : 'ws://' + window.location.host;
    ws = new WebSocket(wsUrl);
    ws.onopen = () => {
        statusElement.textContent = 'Connected to server. Waiting for role assignment...';
    };

    ws.onmessage = async (event) => {
        const message = JSON.parse(event.data);
        console.log('Message from server:', message);

        if (message.type === 'role') {
            isMaster = (message.role === 'master');
            statusElement.textContent = `You are: ${isMaster ? 'Master' : 'Slave'} (${message.message || ''})`;
            updateUIVisibility();
            if (isMaster) {
                slaveListContainer.innerHTML = '';
                if (message.existingClients) {
                    message.existingClients.forEach(clientId => addClientToList(clientId));
                }
                checkAllClientsReady();
            }
        } else if (message.type === 'playbackCommand') {
            const delay = 1.0;
            const startTime = audioContext.currentTime + delay;
            playAudio(startTime);
        } else if (message.type === 'stopCommand') {
            stopAudio();
        } else if (message.type === 'assignTrack' && !isMaster) {
            slaveAssignedTrackSpan.textContent = message.trackName;
            assignedTrack = message.trackName;
            if (assignedTrack) await loadAudio(`/audio/${assignedTrack}`);
        } else if (message.type === 'newClientConnected' && isMaster) {
            addClientToList(message.clientId);
            checkAllClientsReady();
        } else if (message.type === 'clientDisconnected' && isMaster) {
            removeClientFromList(message.clientId);
            checkAllClientsReady();
        } else if (message.type === 'clientStateUpdate' && isMaster) {
            updateClientState(message.clientId, message.isReady);
            checkAllClientsReady();
        }
    };

    ws.onclose = () => {
        statusElement.textContent = 'Disconnected from server. Reconnecting...';
        console.log('WebSocket disconnected. Attempting to reconnect in 3 seconds...');
        isMaster = false;
        updateUIVisibility();
        displayAudioActivationPrompt();
        setTimeout(connectWebSocket, 3000);
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        statusElement.textContent = 'WebSocket error. Check console.';
    };
}

function updateUIVisibility() {
    if (isMaster) {
        masterControls.style.display = 'block';
        slaveDisplay.style.display = 'none';
        if (audioActivationMessageElement) audioActivationMessageElement.style.display = 'none';
    } else {
        masterControls.style.display = 'none';
        slaveDisplay.style.display = 'block';
        displayAudioActivationPrompt();
    }
    masterSecretInput.style.display = isMaster ? 'none' : 'block';
    becomeMasterBtn.style.display = isMaster ? 'none' : 'block';
}

function addClientToList(clientId) {
    const listItem = document.createElement('li');
    listItem.id = `client-${clientId}`;
    listItem.dataset.ready = "false";

    const statusIndicator = document.createElement('span');
    statusIndicator.className = 'status-indicator';
    statusIndicator.textContent = '●';
    statusIndicator.title = "Not Ready";
    
    const clientLabel = document.createElement('span');
    clientLabel.textContent = `Device ${clientId.substring(0, 6)}...`;
    
    const trackSelect = document.createElement('select');
    trackSelect.dataset.clientId = clientId;
    trackSelect.innerHTML = `<option value="">-- Assign Track --</option><option value="track1.mp3">Track 1</option><option value="track2.mp3">Track 2</option><option value="guitar.mp3">Guitar</option><option value="drums.mp3">Drums</option><option value="bass.mp3">Bass</option>`;

    listItem.appendChild(statusIndicator);
    listItem.appendChild(clientLabel);
    listItem.appendChild(trackSelect);
    slaveListContainer.appendChild(listItem);
}

function removeClientFromList(clientId) {
    const listItem = document.getElementById(`client-${clientId}`);
    if (listItem) listItem.remove();
}

function updateClientState(clientId, isReady) {
    const listItem = document.getElementById(`client-${clientId}`);
    if (!listItem) return;

    const statusIndicator = listItem.querySelector('.status-indicator');
    listItem.dataset.ready = isReady ? "true" : "false";
    
    if (isReady) {
        statusIndicator.classList.add('ready');
        statusIndicator.title = "Ready";
    } else {
        statusIndicator.classList.remove('ready');
        statusIndicator.title = "Not Ready";
    }
}

function checkAllClientsReady() {
    if (!isMaster) return;
    const slaveItems = slaveListContainer.querySelectorAll('li');
    let allReady = true;
    if (slaveItems.length === 0) {
        allReady = true;
    } else {
        slaveItems.forEach(item => {
            if (item.dataset.ready !== "true") {
                allReady = false;
            }
        });
    }
    playBtn.disabled = !allReady;
}

async function loadAudio(url) {
    if (!audioContext || audioContext.state !== 'running') {
        playbackStatusSpan.textContent = 'Audio context suspended. Please click to enable.';
        if (!isMaster) displayAudioActivationPrompt();
        return;
    }
    playbackStatusSpan.textContent = 'Loading audio...';
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const arrayBuffer = await response.arrayBuffer();
        currentAudioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        playbackStatusSpan.textContent = `Audio loaded: ${url.split('/').pop()}`;
        console.log(`Audio loaded from ${url}`);
        
        if (!isMaster && ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'clientReady' }));
        }
    } catch (error) {
        console.error('Error loading or decoding audio:', error);
        playbackStatusSpan.textContent = `Failed to load audio. Check console.`;
    }
}

function playAudio(startTime) {
    if (!currentAudioBuffer || !audioContext || audioContext.state !== 'running') {
        console.warn(`Cannot play. Buffer: ${!!currentAudioBuffer}, Context: ${audioContext ? audioContext.state : 'null'}`);
        playbackStatusSpan.textContent = 'Audio not ready or not enabled.';
        if (!isMaster) displayAudioActivationPrompt();
        return;
    }
    if (currentAudioSource) {
        currentAudioSource.stop();
        currentAudioSource.disconnect();
    }
    currentAudioSource = audioContext.createBufferSource();
    currentAudioSource.buffer = currentAudioBuffer;
    currentAudioSource.connect(audioContext.destination);
    currentAudioSource.start(startTime);
    playbackStatusSpan.textContent = `Playing (scheduled for ${startTime.toFixed(3)})`;
    currentAudioSource.onended = () => {
        console.log('Audio finished.');
        playbackStatusSpan.textContent = 'Finished';
    };
}

function stopAudio() {
    if (currentAudioSource) {
        currentAudioSource.stop();
        currentAudioSource.disconnect();
        currentAudioSource = null;
        playbackStatusSpan.textContent = 'Stopped';
        console.log('Audio stopped.');
    }
}

playBtn.addEventListener('click', () => {
    if (isMaster && ws && ws.readyState === WebSocket.OPEN) {
        console.log('Master is requesting playback start...');
        ws.send(JSON.stringify({ type: 'requestPlayback' }));
    }
});

stopBtn.addEventListener('click', () => {
    if (isMaster && ws && ws.readyState === WebSocket.OPEN) {
        console.log('Master is requesting playback stop...');
        ws.send(JSON.stringify({ type: 'requestStop' }));
    }
});

masterTrackSelect.addEventListener('change', async (event) => {
    if (isMaster) {
        const selectedTrack = event.target.value;
        assignedTrack = selectedTrack;
        if (selectedTrack) {
            console.log(`Master assigned self track: ${selectedTrack}`);
            await loadAudio(`/audio/${selectedTrack}`);
        } else {
            currentAudioBuffer = null;
            playbackStatusSpan.textContent = 'Ready';
        }
    }
});

slaveListContainer.addEventListener('change', (event) => {
    if (event.target.tagName === 'SELECT' && event.target.dataset.clientId) {
        const targetClientId = event.target.dataset.clientId;
        const trackName = event.target.value;
        if (trackName) {
            console.log(`Assigning track ${trackName} to client ${targetClientId}`);
            ws.send(JSON.stringify({
                type: 'assignTrackToClient',
                payload: { targetClientId, trackName }
            }));
        }
    }
});

becomeMasterBtn.addEventListener('click', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        const secret = masterSecretInput.value;
        if (secret) {
            ws.send(JSON.stringify({ type: 'attemptMaster', secret: secret }));
            masterSecretInput.value = '';
        }
    } else {
        alert('Please enter the Master Secret.');
    }
});

connectWebSocket();