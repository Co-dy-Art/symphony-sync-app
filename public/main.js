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
let audioContext = null; // Initialize as null, create on user gesture
let currentAudioBuffer = null;
let currentAudioSource = null; // To keep track of the currently playing source
let assignedTrack = null;
// Removed: let audioContextResumed = false; // Rely directly on audioContext.state

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

// --- AudioContext Initialization and Resume Function ---
// This function will be called ONLY by the dedicated "Enable Audio" button.
function initializeAndResumeAudioContext() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        console.log('AudioContext initialized.');
    }

    if (audioContext.state === 'suspended') {
        audioContext.resume().then(() => {
            console.log('AudioContext resumed successfully via button.');
            audioActivationContainer.style.display = 'none'; // Hide button after resume
        }).catch(e => console.error('Error resuming AudioContext:', e));
    } else {
        // If already running or not suspended, just hide the button
        audioActivationContainer.style.display = 'none';
        console.log('AudioContext already active or not suspended.');
    }
}

// Attach click listener to the dedicated "Enable Audio" button
activateAudioBtn.addEventListener('click', initializeAndResumeAudioContext);


// --- WebSocket Connection ---
function connectWebSocket() {
    // IMPORTANT: Replace 'https://symphony-sync-app.onrender.com' with your actual Render URL
    ws = new WebSocket('wss://symphony-sync-app.onrender.com');

    ws.onopen = () => {
        statusElement.textContent = 'Connected to server. Waiting for role assignment...';
        console.log('WebSocket connected.');

        // Ensure master/slave UI and audio activation UI are hidden until role is assigned
        masterControls.style.display = 'none';
        slaveDisplay.style.display = 'none';
        audioActivationContainer.style.display = 'none'; 
    };

    ws.onmessage = async (event) => {
        const message = JSON.parse(event.data);
        console.log('Message from server:', message);

        if (message.type === 'role') {
            isMaster = (message.role === 'master');
            statusElement.textContent = `You are: ${isMaster ? 'Master' : 'Slave'} (${message.message || ''})`;

            // Correctly manage display of main sections based on role
            if (isMaster) {
                masterControls.style.display = 'block';
                slaveDisplay.style.display = 'none';
                audioActivationContainer.style.display = 'none'; // Master never needs this
            } else { // Is Slave
                masterControls.style.display = 'none';
                slaveDisplay.style.display = 'block';
                // Show audio activation message for slaves only if audio context is not yet active
                // Initialize audioContext here for its state to be checked
                if (!audioContext) { // If it's null, it hasn't been touched yet
                    audioContext = new (window.AudioContext || window.webkitAudioContext)();
                }
                if (audioContext.state === 'suspended' || audioContext.state === 'interrupted') {
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
            handleSlaveCommand(command);
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
            if (!audioContext || audioContext.state === 'suspended' || audioContext.state === 'interrupted') {
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
        if (!audioContext || audioContext.state === 'suspended' || audioContext.state === 'interrupted') {
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
    // AudioContext will be initialized by the button click
    if (!audioContext) { // As a fallback, if for some reason button wasn't clicked first
         audioContext = new (window.AudioContext || window.webkitAudioContext)();
         console.warn('AudioContext initialized by loadAudio, ideally should be by button.');
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
    // This is a fallback, primary resume is now on dedicated button click
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
    // This button click is primarily for sending the secret.
    // AudioContext resume is handled by the dedicated "Enable Audio" button.

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