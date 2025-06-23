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
let serverTimeOffset = 0;
let screenWakeLock = null; // NEW: Variable to hold the screen wake lock

// --- Service Worker ---
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/service-worker.js')
            .then(reg => console.log('Service Worker registered.', reg))
            .catch(err => console.error('Service Worker registration failed:', err));
    });
}

// --- NEW: Screen Wake Lock Function ---
async function requestWakeLock() {
    // Check if the API is supported
    if ('wakeLock' in navigator) {
        try {
            // Request the wake lock
            screenWakeLock = await navigator.wakeLock.request('screen');
            console.log('Screen Wake Lock is active.');
            // Listen for when the lock is released (e.g., user switches tabs)
            screenWakeLock.addEventListener('release', () => {
                console.log('Screen Wake Lock was released.');
                screenWakeLock = null;
            });
        } catch (err) {
            console.error(`Wake Lock failed: ${err.name}, ${err.message}`);
        }
    } else {
        console.warn('Wake Lock API not supported in this browser.');
    }
}


// --- AudioContext Activation (Updated) ---
function setupAudioContextActivation() {
    if (!audioContext || audioContext.state === 'suspended' || audioContext.state === 'interrupted') {
        try {
            if (!audioContext) {
                audioContext = new (window.AudioContext || window.webkitAudioContext)();
                console.log('AudioContext initialized via user gesture listener.');
            }
            if (audioContext.state === 'suspended' || audioContext.state === 'interrupted') {
                audioContext.resume().then(async () => { // made this async
                    console.log('AudioContext resumed successfully on user interaction.');
                    await requestWakeLock(); // Request wake lock after successful interaction
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
                // Already running, so we can request the wake lock
                requestWakeLock();
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

// NEW: Event listener to re-acquire wake lock when tab becomes visible again
document.addEventListener('visibilitychange', async () => {
    if (screenWakeLock === null && document.visibilityState === 'visible') {
        console.log('Re-acquiring screen wake lock after tab visibility change.');
        await requestWakeLock();
    }
});


// --- WebSocket Connection & Message Handling ---
function connectWebSocket() {
    const wsUrl = window.location.protocol === 'https:' ? 'wss://' + window.location.host : 'ws://' + window.location.host;
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        statusElement.textContent = 'Connected. Synchronizing time...';
        syncTimeWithServer();
    };

    ws.onmessage = async (event) => {
        const message = JSON.parse(event.data);
        
        if (message.type !== 'timeSyncResponse') {
            console.log('Message from server:', message);
        }

        if (message.type === 'timeSyncResponse') {
            const roundTripTime = Date.now() - message.clientTime;
            const estimatedServerTime = message.serverTime + (roundTripTime / 2);
            serverTimeOffset = estimatedServerTime - Date.now();
            statusElement.textContent = 'Connected to server.';
            console.log(`Time synchronized. Server is approx. ${Math.abs(serverTimeOffset).toFixed(0)}ms ${serverTimeOffset > 0 ? 'ahead' : 'behind'}.`);

        } else if (message.type === 'role') {
            isMaster = (message.role === 'master');
            statusElement.textContent = `You are: ${isMaster ? 'Master' : 'Slave'} (${message.message || ''})`;
            updateUIVisibility();
            if (isMaster) {
                slaveListContainer.innerHTML = '';
                if (message.existingClients) {
                    message.existingClients.forEach(clientId => addClientToList(clientId));
                }
                updatePlayButtonState();
            }
        } else if (message.type === 'playbackCommand') {
            const targetServerTime = message.serverStartTime;
            const timeUntilStart = targetServerTime - (Date.now() + serverTimeOffset);
            
            console.log(`Playback command received. Will start in ${timeUntilStart.toFixed(0)}ms.`);

            if (timeUntilStart > 0) {
                const localStartTime = audioContext.currentTime + (timeUntilStart / 1000);
                playAudio(localStartTime);
            } else {
                console.warn('Playback command received too late. Discarding.');
            }

        } else if (message.type === 'stopCommand') {
            stopAudio();
        } else if (message.type === 'assignTrack' && !isMaster) {
            slaveAssignedTrackSpan.textContent = message.trackName;
            assignedTrack = message.trackName;
            if (assignedTrack) await loadAudio(`/audio/${assignedTrack}`);
        } else if (message.type === 'newClientConnected' && isMaster) {
            addClientToList(message.clientId);
            updatePlayButtonState();
        } else if (message.type === 'clientDisconnected' && isMaster) {
            removeClientFromList(message.clientId);
            updatePlayButtonState();
        } else if (message.type === 'clientStateUpdate' && isMaster) {
            updateClientState(message.clientId, message.isReady);
            updatePlayButtonState();
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

function syncTimeWithServer() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'timeSync',
            clientTime: Date.now()
        }));
    }
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
    listItem.dataset.clientId = clientId;
    listItem.dataset.ready = "false";

    const statusIndicator = document.createElement('span');
    statusIndicator.className = 'status-indicator';
    statusIndicator.textContent = '●';
    statusIndicator.title = "Not Ready";
    
    const clientLabel = document.createElement('span');
    clientLabel.textContent = `Device ${clientId.substring(0, 6)}...`;
    
    const controlsContainer = document.createElement('div');
    controlsContainer.className = 'client-item-controls';

    const trackSelect = document.createElement('select');
    trackSelect.innerHTML = `
        <option value="">-- Assign --</option>
        <option value="garageDrums.mp3">Garage Drums</option>
        <option value="keys.mp3">Keys</option>
        <option value="techBass.mp3">Tech Bass</option>
        <option value="techDrums.mp3">Tech Drums</option>
        <option value="track1.mp3">Test Track 1</option>
        <option value="track2.mp3">Test Track 2</option>
    `;
    
    const includeCheckbox = document.createElement('input');
    includeCheckbox.type = 'checkbox';
    includeCheckbox.className = 'include-checkbox';
    includeCheckbox.checked = true;
    includeCheckbox.title = "Include in playback";

    controlsContainer.appendChild(trackSelect);
    controlsContainer.appendChild(includeCheckbox);

    listItem.appendChild(statusIndicator);
    listItem.appendChild(clientLabel);
    listItem.appendChild(controlsContainer);
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

function updatePlayButtonState() {
    if (!isMaster) return;

    const slaveItems = slaveListContainer.querySelectorAll('li');
    const includedItems = Array.from(slaveItems).filter(item => {
        const checkbox = item.querySelector('.include-checkbox');
        return checkbox && checkbox.checked;
    });

    const allIncludedAreReady = includedItems.every(item => item.dataset.ready === "true");
    
    playBtn.disabled = !allIncludedAreReady;
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
        const includedItems = Array.from(slaveListContainer.querySelectorAll('li')).filter(item => {
            const checkbox = item.querySelector('.include-checkbox');
            return checkbox && checkbox.checked;
        });
        const targetClientIds = includedItems.map(item => item.dataset.clientId);
        console.log(`Master is requesting playback start for clients:`, targetClientIds);
        ws.send(JSON.stringify({ type: 'requestPlayback', targetClientIds: targetClientIds }));
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
    const target = event.target;
    if (target.classList.contains('include-checkbox')) {
        updatePlayButtonState();
    } 
    else if (target.tagName === 'SELECT') {
        const listItem = target.closest('li');
        const targetClientId = listItem.dataset.clientId;
        const trackName = target.value;
        updateClientState(targetClientId, false);
        updatePlayButtonState();
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