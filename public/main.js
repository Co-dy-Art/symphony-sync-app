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

// NEW ELEMENTS FOR MASTER SECRET
const masterSecretInput = document.createElement('input');
masterSecretInput.type = 'password';
masterSecretInput.placeholder = 'Enter Master Secret';
masterSecretInput.className = 'secret-input';

const becomeMasterBtn = document.createElement('button');
becomeMasterBtn.textContent = 'Become Master';
becomeMasterBtn.className = 'become-master-btn';

// Add new elements to slaveDisplay (initially hidden)
// Note: These are prepended, so they appear at the top of the slaveDisplay div
slaveDisplay.prepend(becomeMasterBtn);
slaveDisplay.prepend(masterSecretInput);

// NEW: Reference to the audio activation container and button
const audioActivationContainer = document.getElementById('audio-activation-container');
const activateAudioBtn = document.getElementById('activateAudioBtn');


let ws;
let isMaster = false;
let audioContext;
let currentAudioBuffer = null;
let currentAudioSource = null; // To keep track of the currently playing source
let assignedTrack = null;
let audioContextResumed = false; // Flag to ensure resume only happens once

// --- Service Worker Registration ---
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/service-worker.js')
            .then(registration => {
                console.log('Service Worker registered! Scope:', registration.scope);
            })
            .catch(err => {
                console.error('Service Worker registration failed:', err);
            });
    });
}

// --- Universal AudioContext Resume on User Gesture ---
// This function will be called by the dedicated button to unlock audio
function resumeAudioContext() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioContext.state === 'suspended' && !audioContextResumed) {
        audioContext.resume().then(() => {
            console.log('AudioContext resumed successfully on user gesture.');
            audioContextResumed = true; // Set flag to prevent repeated attempts
            // Hide the activation container after successful resume
            audioActivationContainer.style.display = 'none';
        }).catch(e => console.error('Error resuming AudioContext:', e));
    }
}

// Attach click listener to the new dedicated button
activateAudioBtn.addEventListener('click', resumeAudioContext);


// --- WebSocket Connection ---
function connectWebSocket() {
    // IMPORTANT: Replace 'https://symphony-sync-app.onrender.com' with your actual Render URL
    ws = new WebSocket('wss://symphony-sync-app.onrender.com');

    ws.onopen = () => {
        statusElement.textContent = 'Connected to server. Waiting for role assignment...';
        console.log('WebSocket connected.');
        // FIX: Removed the automatic 'requestRole' from previous versions.
        // The original problematic line was: ws.send(JSON.stringify({ type: 'requestRole', role: 'auto' }));
    };

    ws.onmessage = async (event) => {
        const message = JSON.parse(event.data);
        console.log('Message from server:', message);

        if (message.type === 'role') {
            isMaster = (message.role === 'master');
            statusElement.textContent = `You are: ${isMaster ? 'Master' : 'Slave'} (${message.message || ''})`;

            // FIX: Correctly manage display of main sections based on role
            if (isMaster) {
                masterControls.style.display = 'block';
                slaveDisplay.style.display = 'none';
                audioActivationContainer.style.display = 'none'; // Ensure hidden for master
            } else { // Is Slave
                masterControls.style.display = 'none';
                slaveDisplay.style.display = 'block';
                // Show audio activation message for slaves only if audio context hasn't resumed
                if (!audioContextResumed) {
                    audioActivationContainer.style.display = 'block';
                } else {
                    audioActivationContainer.style.display = 'none';
                }
            }

            // Show/hide master secret input and button (only relevant for slaves)
            masterSecretInput.style.display = isMaster ? 'none' : 'block';
            becomeMasterBtn.style.display = isMaster ? 'none' : 'block';

            console.log(`Assigned role: ${isMaster ? 'Master' : 'Slave'}`);
        } else if (message.type === 'playbackCommand' && !isMaster) {
            handleSlaveCommand(message.command);
        } else if (message.type === 'assignTrack' && !isMaster) {
            slaveAssignedTrackSpan.textContent = message.trackName;
            assignedTrack = message.trackName;
            console.log(`Assigned track: ${assignedTrack}`);
            // Pre-load audio for the assigned track
            if (assignedTrack) {
                await loadAudio(`/audio/${assignedTrack}`);
            }
        } else if (message.type === 'masterStatusChange' && !isMaster) {
            // If master disconnects or new master emerges, update slave UI
            statusElement.textContent = `You are: Slave (${message.message || 'Master status changed'})`;
            masterSecretInput.style.display = 'block'; // Allow attempt to become master
            becomeMasterBtn.style.display = 'block';
            // Also show audio activation message for slaves if master disappears and audio not resumed
            if (!audioContextResumed) {
                audioActivationContainer.style.display = 'block';
            }
        }
    };

    ws.onclose = () => {
        statusElement.textContent = 'Disconnected from server. Reconnecting...';
        console.log('WebSocket disconnected. Attempting to reconnect in 3 seconds...');
        isMaster = false; // Reset role to force UI update to slave
        masterControls.style.display = 'none';
        slaveDisplay.style.display = 'block'; // Show slave UI on disconnect
        masterSecretInput.style.display = 'block';
        becomeMasterBtn.style.display = 'block';
        
        // Show audio activation message on disconnect if audio not active
        if (!audioContextResumed) {
            audioActivationContainer.style.display = 'block';
        }
        setTimeout(connectWebSocket, 3000); // Attempt to reconnect
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        statusElement.textContent = 'WebSocket error. Check console.';
    };
}

// --- Web Audio API Initialization and Loading ---
async function loadAudio(url) {
    if (!audioContext) { // Ensure AudioContext is initialized if not already
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    playbackStatusSpan.textContent = 'Loading audio...';
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        currentAudioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        playbackStatusSpan.textContent = `Audio loaded: ${assignedTrack || 'N/A'}`;
        console.log(`Audio loaded from ${url}`);
    } catch (error) {
        console.error('Error loading or decoding audio:', error);
        playbackStatusSpan.textContent = `Failed to load audio for ${assignedTrack || 'N/A'}. Check console.`;
    }
}

// --- Playback Functions (Master & Slave) ---
function playAudio(delay = 0) {
    if (!currentAudioBuffer || !audioContext) {
        console.warn('No audio buffer loaded or AudioContext not initialized.');
        playbackStatusSpan.textContent = 'No track assigned or loaded.';
        return;
    }

    // Ensure audio context is resumed if suspended (e.g., due to user interaction policy)
    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }

    if (currentAudioSource) {
        currentAudioSource.stop(); // Stop previous source if it exists
        currentAudioSource.disconnect();
    }

    currentAudioSource = audioContext.createBufferSource();
    currentAudioSource.buffer = currentAudioBuffer;
    currentAudioSource.connect(audioContext.destination);

    // Schedule playback with a small delay for synchronization
    // This is the crucial part for attempting sync across devices
    const startTime = audioContext.currentTime + delay; // delay in seconds
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

// --- Master Control Logic ---
playBtn.addEventListener('click', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        // Send a play command with a future start time (e.g., 500ms from now)
        // This gives clients a small buffer to receive the command before playing
        const command = { action: 'play', delay: 0.5 }; // 0.5 seconds delay
        ws.send(JSON.stringify({ type: 'playbackCommand', command: command }));
        // Master also plays its own track
        playAudio(command.delay);
    }
});

stopBtn.addEventListener('click', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        const command = { action: 'stop' };
        ws.send(JSON.stringify({ type: 'playbackCommand', command: command }));
        // Master also stops its own track
        stopAudio();
    }
});

// The assignTrackBtn listener logic. This is the SOLE, correct listener for this button.
// It sends a 'masterAssignTrack' message to the server,
// which the server then broadcasts as 'assignTrack' to slaves.
assignTrackBtn.addEventListener('click', async () => {
    const selectedTrack = trackSelect.value;
    if (selectedTrack) {
        assignedTrack = selectedTrack; // Master assigns to itself
        masterAssignedTrackSpan.textContent = selectedTrack;
        console.log(`Master assigned self track: ${selectedTrack}`);
        await loadAudio(`/audio/${selectedTrack}`); // Load master's own audio

        // Send a message to the server to broadcast the assignment
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'masterAssignTrack', // This type is handled by the server to broadcast
                trackName: selectedTrack
            }));
        }
    }
});

// --- Slave Command Handler ---
function handleSlaveCommand(command) {
    console.log('Slave received command:', command);
    if (command.action === 'play') {
        playAudio(command.delay);
    } else if (command.action === 'stop') {
        stopAudio();
    }
}

// --- New: Become Master Button Logic ---
becomeMasterBtn.addEventListener('click', () => {
    // AudioContext resume is now primarily handled by the dedicated "Enable Audio" button click.
    // This button click is primarily for sending the secret.

    const secret = masterSecretInput.value;
    if (secret) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'attemptMaster', secret: secret }));
            masterSecretInput.value = ''; // Clear input after sending
        }
    } else {
        alert('Please enter the Master Secret.'); // Use alert for simplicity, could be custom modal
    }
});


// Initial connection attempt when the page loads
connectWebSocket();