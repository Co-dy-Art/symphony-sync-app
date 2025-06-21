// server.js

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

// DEFINE YOUR MASTER SECRET HERE! CHANGE THIS TO A STRONG, UNIQUE CODE!
const MASTER_SECRET = "qwerty"; // <<< IMPORTANT: CHANGE THIS!

let masterClient = null; // To keep track of the master device's WebSocket connection

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

wss.on('connection', function connection(ws) {
    console.log('Client connected');

    // Initially, clients are considered slaves. They must explicitly request master role with secret.
    ws.send(JSON.stringify({ type: 'role', role: 'slave', message: 'Connected. Enter secret to become Master.' }));
    console.log('New client connected, initially assigned slave role.');


    ws.on('message', function incoming(message) {
        let msg;
        try {
            msg = JSON.parse(message);
        } catch (e) {
            console.error('Failed to parse message:', message, e);
            return;
        }
        console.log('received message type:', msg.type);

        // Handle client attempting to become master
        if (msg.type === 'attemptMaster') {
            if (msg.secret === MASTER_SECRET) {
                if (masterClient && masterClient !== ws) {
                    console.log('New client provided correct secret. Assigning as new master.');
                    if (masterClient && masterClient.readyState === WebSocket.OPEN) {
                         masterClient.send(JSON.stringify({ type: 'role', role: 'slave', message: 'Master role taken by another client.' }));
                    }
                    masterClient = ws;
                    ws.send(JSON.stringify({ type: 'role', role: 'master', message: 'You are now the master!' }));
                    wss.clients.forEach(function each(client) {
                        if (client !== ws && client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify({ type: 'masterStatusChange', masterPresent: true }));
                        }
                    });

                } else if (!masterClient) {
                     console.log('New client provided correct secret. Assigning as master.');
                     masterClient = ws;
                     ws.send(JSON.stringify({ type: 'role', role: 'master', message: 'You are now the master!' }));
                     wss.clients.forEach(function each(client) {
                        if (client !== ws && client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify({ type: 'masterStatusChange', masterPresent: true }));
                        }
                    });
                } else if (masterClient === ws) {
                    ws.send(JSON.stringify({ type: 'role', role: 'master', message: 'You are already the master.' }));
                }

            } else {
                ws.send(JSON.stringify({ type: 'role', role: 'slave', message: 'Incorrect secret. You are a slave.' }));
                console.log('Client attempted master role with incorrect secret.');
            }
            return;
        }

        // Only the current master can send commands
        if (ws === masterClient) {
            // Master is requesting that playback starts for everyone
            if (msg.type === 'requestPlayback') {
                console.log('Master requested playback. Broadcasting command to all clients...');
                const playbackMsg = { type: 'playbackCommand' };
                wss.clients.forEach(function each(client) {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify(playbackMsg));
                    }
                });

            // Master is requesting that playback STOPS for everyone
            } else if (msg.type === 'requestStop') {
                console.log('Master requested stop. Broadcasting command to all clients...');
                const stopMsg = { type: 'stopCommand' };
                wss.clients.forEach(function each(client) {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify(stopMsg));
                    }
                });

            } else if (msg.type === 'masterAssignTrack') {
                console.log('Master assigning track:', msg.trackName);
                // Broadcast track assignment only to slaves
                wss.clients.forEach(function each(client) {
                    if (client !== masterClient && client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({ type: 'assignTrack', trackName: msg.trackName }));
                    }
                });
            }
        } else {
            console.log('Non-master client tried to send command, ignored. Message type:', msg.type);
        }
    });

    ws.on('close', function close() {
        console.log('Client disconnected');
        if (ws === masterClient) {
            console.log('Master disconnected. Master role is now vacant.');
            masterClient = null; // Master disconnected
            // Inform all clients that the master has disconnected
            wss.clients.forEach(function each(client) {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({ type: 'masterStatusChange', masterPresent: false, message: 'Master disconnected. Role is now vacant.' }));
                }
            });
        }
    });

    ws.on('error', function error(err) {
        console.error('WebSocket error for client:', err.message);
    });
});

server.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
    console.log('WebSocket server is running.');
});