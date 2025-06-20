// public/main.js

const statusElement = document.getElementById('status');
const masterControls = document.getElementById('master-controls');
const slaveDisplay = document.getElementById('slave-display');
const playBtn = document.getElementById('playBtn');
const stopBtn = document.getElementById('stopBtn');
const trackSelect = document.getElementById('trackSelect');
const assignTrackBtn = document.getElementById('assignTrackBtn');
const masterAssignedTrackSpan = document.getElementById('masterAssignedTrack');
const slaveAssignedTrackSpan = document.getElementById('slaveAssignedTrack');
const playbackStatusSpan = document.getElementById('playbackStatus');

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
            .then(registration => console.log('Service Worker registered! Scope:', registration.scope))
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
        console.log('WebSocket connected.');
        masterControls.style.display = 'none';
        slaveDisplay.style.display = 'none';
        if (audioActivationMessageElement) {
            audioActivationMessageElement.style.display = 'none';
        }
    };

    ws.onmessage = async (event) => {
        const message = JSON.parse(event.data);
        console.log('Message from server:', message);

        if (message.type === 'role') {
            isMaster = (message.role === 'master');
            statusElement.textContent = `You are: ${isMaster ? 'Master' : 'Slave'} (${message.message || ''})`;
            if (isMaster) {
                masterControls.style.display = 'block';
                slaveDisplay.style.display = 'none';
                if (audioActivationMessageElement) {
                    audioActivationMessageElement.style.display = 'none';
                }
            } else {
                masterControls.style.display = 'none';
                slaveDisplay.style.display = 'block';
                displayAudioActivationPrompt();
            }
            masterSecretInput.style.display = isMaster ? 'none' : 'block';
            becomeMasterBtn.style.display = isMaster ? 'none' : 'block';
            console.log(`Assigned role: ${isMaster ? 'Master' : 'Slave'}`);
        } else if (message.type === 'playbackCommand') {
            // This now runs on ALL devices (Master and Slaves)
            console.log('Received playback command. Scheduling audio with 1 second delay.');
            const delay = 1.0; // A fixed buffer to absorb network jitter
            const startTime = audioContext.currentTime + delay;
            playAudio(startTime);
        } else if (message.type === 'assignTrack' && !isMaster) {
            slaveAssignedTrackSpan.textContent = message.trackName;
            assignedTrack = message.trackName;
            console.log(`Assigned track: ${assignedTrack}`);
            if (assignedTrack) {
                await loadAudio(`/audio/${assignedTrack}`);
            }
        } else if (message.type === 'masterStatusChange' && !isMaster) {
            statusElement.textContent = `You are: Slave (${message.message || 'Master status changed'})`;
            masterSecretInput.style.display = 'block';
            becomeMasterBtn.style.display = 'block';
            displayAudioActivationPrompt();
        }
    };

    ws.onclose = () => {
        statusElement.textContent = 'Disconnected from server. Reconnecting...';
        console.log('WebSocket disconnected. Attempting to reconnect in 3 seconds...');
        isMaster = false;
        masterControls.style.display = 'none';
        slaveDisplay.style.display = 'block';
        masterSecretInput.style.display = 'block';
        becomeMasterBtn.style.display = 'block';
        displayAudioActivationPrompt();
        setTimeout(connectWebSocket, 3000);
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        statusElement.textContent = 'WebSocket error. Check console.';
    };
}

async function loadAudio(url) {
    if (!audioContext || audioContext.state !== 'running') {
        console.warn('AudioContext is not running or suspended. Cannot load audio until it is active.');
        playbackStatusSpan.textContent = 'Audio context suspended. Please click to enable.';
        if (!isMaster) {
            displayAudioActivationPrompt();
        }
        return;
    }
    playbackStatusSpan.textContent = 'Loading audio...';
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const arrayBuffer = await response.arrayBuffer();
        currentAudioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        playbackStatusSpan.textContent = `Audio loaded: ${assignedTrack || 'N/A'}`;
        console.log(`Audio loaded from ${url}`);
    } catch (error) {
        console.error('Error loading or decoding audio:', error);
        playbackStatusSpan.textContent = `Failed to load audio for ${assignedTrack || 'N/A'}. Check console.`;
    }
}

function playAudio(startTime) {
    if (!currentAudioBuffer || !audioContext || audioContext.state !== 'running') {
        console.warn(`Cannot play. Buffer: ${!!currentAudioBuffer}, Context: ${audioContext ? audioContext.state : 'null'}`);
        playbackStatusSpan.textContent = 'Audio not ready or not enabled by user click.';
        if (!isMaster) {
            displayAudioActivationPrompt();
        }
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
        // Just send a simple request. The server will do the rest.
        ws.send(JSON.stringify({ type: 'requestPlayback' }));
    }
});

stopBtn.addEventListener('click', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        // This command should also be broadcast via the server to be in sync
        // For now, it stops locally. This can be a future improvement.
        ws.send(JSON.stringify({ type: 'requestStop' })); // A potential new command
        // stopAudio(); // Local stop might not be what's desired. Let server command it.
    }
});

assignTrackBtn.addEventListener('click', async () => {
    const selectedTrack = trackSelect.value;
    if (selectedTrack) {
        assignedTrack = selectedTrack;
        masterAssignedTrackSpan.textContent = selectedTrack;
        console.log(`Master assigned self track: ${selectedTrack}`);
        await loadAudio(`/audio/${selectedTrack}`);
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'masterAssignTrack',
                trackName: selectedTrack
            }));
        }
    }
});

becomeMasterBtn.addEventListener('click', () => {
    const secret = masterSecretInput.value;
    if (secret) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'attemptMaster', secret: secret }));
            masterSecretInput.value = '';
        }
    } else {
        alert('Please enter the Master Secret.');
    }
});

connectWebSocket();