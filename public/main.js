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
slaveDisplay.prepend(becomeMasterBtn);
slaveDisplay.prepend(masterSecretInput);

// NEW: Placeholder for dynamic message for audio activation if needed
let audioActivationMessageElement = null; // Will create dynamically if needed


let ws;
let isMaster = false;
let audioContext = null; // Initialize as null, will be created/resumed explicitly
let currentAudioBuffer = null;
let currentAudioSource = null; // To keep track of the currently playing source
let assignedTrack = null;


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

// --- Universal AudioContext Initialization and Resume on ANY User Interaction ---
// This is the most robust pattern for browser autoplay policies.
function setupAudioContextActivation() {
    // If audioContext hasn't been created yet, or is suspended/interrupted
    if (!audioContext || audioContext.state === 'suspended' || audioContext.state === 'interrupted') {
        try {
            if (!audioContext) {
                audioContext = new (window.AudioContext || window.webkitAudioContext)();
                console.log('AudioContext initialized via user gesture listener.');
            }

            if (audioContext.state === 'suspended' || audioContext.state === 'interrupted') {
                audioContext.resume().then(() => {
                    console.log('AudioContext resumed successfully on user interaction.');
                    // Remove the listeners once successfully resumed
                    document.body.removeEventListener('click', setupAudioContextActivation);
                    document.body.removeEventListener('touchstart', setupAudioContextActivation);
                    // Hide any dynamic message if it was shown
                    if (audioActivationMessageElement) {
                        audioActivationMessageElement.remove();
                        audioActivationMessageElement = null;
                    }
                }).catch(e => {
                    console.error('Error resuming AudioContext:', e);
                    displayAudioActivationPrompt(); // Keep showing prompt if resume fails
                });
            } else {
                // Already running, just remove listeners
                document.body.removeEventListener('click', setupAudioContextActivation);
                document.body.removeEventListener('touchstart', setupAudioContextActivation);
                if (audioActivationMessageElement) {
                    audioActivationMessageElement.remove();
                    audioActivationMessageElement = null;
                }
            }
        } catch (e) {
            console.error('Failed to create AudioContext:', e);
            displayAudioActivationPrompt(); // Show prompt if creation failed
        }
    }
}

// Function to dynamically display an audio activation prompt
function displayAudioActivationPrompt() {
    // Only display if we are a slave and AudioContext is not running
    if (!isMaster && (!audioContext || audioContext.state === 'suspended' || audioContext.state === 'interrupted')) {
        if (!audioActivationMessageElement) {
            audioActivationMessageElement = document.createElement('div');
            audioActivationMessageElement.id = 'dynamic-audio-prompt';
            audioActivationMessageElement.style.cssText = `
                padding: 15px;
                background-color: #ffe0b2;
                border: 1px solid #ffb74d;
                border-radius: 8px;
                margin-top: 20px;
                margin-bottom: 20px;
                color: #333;
                font-weight: bold;
                text-align: center;
                cursor: pointer; /* Indicate it's clickable */
            `;
            audioActivationMessageElement.innerHTML = `<p>Tap/Click anywhere to enable audio for this device.</p>`;
            // Prepend to container so it appears above other elements
            document.querySelector('.container').prepend(audioActivationMessageElement);

            // Re-attach listeners to this new element if it appears
            audioActivationMessageElement.addEventListener('click', setupAudioContextActivation);
            audioActivationMessageElement.addEventListener('touchstart', setupAudioContextActivation);
        } else {
            audioActivationMessageElement.style.display = 'block'; // Ensure visible
        }
        playbackStatusSpan.textContent = 'Audio context suspended. Please click to enable.';
    } else if (audioActivationMessageElement) {
        audioActivationMessageElement.style.display = 'none'; // Hide if not needed
    }
}


// Attach universal click/touch listeners to the body to catch any user interaction
// This will trigger setupAudioContextActivation
document.body.addEventListener('click', setupAudioContextActivation);
document.body.addEventListener('touchstart', setupAudioContextActivation);


// --- WebSocket Connection ---
function connectWebSocket() {
    // IMPORTANT: Replace 'https://symphony-sync-app.onrender.com' with your actual Render URL
    // For local testing, you might use: 'ws://localhost:3000'
    const wsUrl = window.location.protocol === 'https:' ? 'wss://' + window.location.host : 'ws://' + window.location.host;
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        statusElement.textContent = 'Connected to server. Waiting for role assignment...';
        console.log('WebSocket connected.');

        // Ensure master/slave UI are hidden until role is assigned
        masterControls.style.display = 'none';
        slaveDisplay.style.display = 'none';
        // NEW: Hide dynamic audio prompt until role is determined
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

            // Correctly manage display of main sections based on role
            if (isMaster) {
                masterControls.style.display = 'block';
                slaveDisplay.style.display = 'none';
                // Master never needs audio activation prompt
                if (audioActivationMessageElement) {
                    audioActivationMessageElement.style.display = 'none';
                }
            } else { // Is Slave
                masterControls.style.display = 'none';
                slaveDisplay.style.display = 'block';
                // Display prompt for slaves if audio context is not running
                displayAudioActivationPrompt();
            }

            // Show/hide master secret input and button (only relevant for slaves)
            masterSecretInput.style.display = isMaster ? 'none' : 'block';
            becomeMasterBtn.style.display = isMaster ? 'none' : 'block';

            console.log(`Assigned role: ${isMaster ? 'Master' : 'Slave'}`);
        } else if (message.type === 'playbackCommand' && !isMaster) {
            // *** FIX #1: Correctly pass the nested 'command' object ***
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
            displayAudioActivationPrompt();
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
        displayAudioActivationPrompt();
        setTimeout(connectWebSocket, 3000); // Attempt to reconnect
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        statusElement.textContent = 'WebSocket error. Check console.';
    };
}

// --- Web Audio API Initialization and Loading ---
async function loadAudio(url) {
    // It is critical that audioContext is in 'running' state BEFORE trying to decode or play.
    // displayAudioActivationPrompt() will guide the user.
    if (!audioContext || audioContext.state !== 'running') {
        console.warn('AudioContext is not running or suspended. Cannot load audio until it is active.');
        playbackStatusSpan.textContent = 'Audio context suspended. Please click to enable.';
        if (!isMaster) { // Only show prompt on slaves
            displayAudioActivationPrompt();
        }
        return; // IMPORTANT: Do not proceed with loading if AudioContext is not active
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
// *** FIX #2: Universal function to schedule playback at a precise time ***
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

    // Schedule playback for the exact absolute time received from the master.
    currentAudioSource.start(startTime); 
    
    playbackStatusSpan.textContent = `Playback scheduled for time: ${startTime.toFixed(3)}`;

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
// *** FIX #3: Master sends a precise future start time ***
playBtn.addEventListener('click', () => {
    if (ws && ws.readyState === WebSocket.OPEN && audioContext && audioContext.state === 'running') {
        // 1. Calculate an absolute future start time (e.g., 2 seconds from now)
        const startTime = audioContext.currentTime + 2.0;

        // 2. Create the command with this absolute start time
        const command = { action: 'play', time: startTime };

        // 3. Send the command to the server
        ws.send(JSON.stringify({ type: 'playbackCommand', command: command }));
        
        // 4. The master also plays its own track using the SAME start time
        playAudio(startTime);
        console.log(`Master initiated synchronized playback for time: ${startTime}`);
    } else {
        console.warn("Cannot start playback. Master's WebSocket is not open or AudioContext is not running.");
        if (!audioContext || audioContext.state !== 'running') {
             playbackStatusSpan.textContent = "Your audio is not active. Please click the screen.";
        }
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
// *** FIX #4: Slave handler now looks for 'time' property ***
function handleSlaveCommand(command) {
    console.log('Slave received command:', command);
    if (command.action === 'play' && command.time) {
        playAudio(command.time);
    } else if (command.action === 'stop') {
        stopAudio();
    }
}

// --- New: Become Master Button Logic (remains as part of secret login) ---
becomeMasterBtn.addEventListener('click', () => {
    const secret = masterSecretInput.value;
    if (secret) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'attemptMaster', secret: secret }));
            masterSecretInput.value = ''; // Clear input after sending
        }
    } else {
        alert('Please enter the Master Secret.');
    }
});


// Initial connection attempt when the page loads
connectWebSocket();