// server.js

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const crypto = require('crypto'); // Import crypto for generating unique IDs

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const MASTER_SECRET = "qwerty";

let masterClient = null;
const clients = new Map(); // Use a Map to store clients by their unique ID

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

wss.on('connection', function connection(ws) {
    // Assign a unique ID to every connection
    const clientId = crypto.randomUUID();
    ws.id = clientId; // Attach the ID to the WebSocket object itself
    clients.set(clientId, ws); // Store the client in the Map
    console.log(`Client connected with ID: ${clientId}`);

    ws.send(JSON.stringify({ type: 'role', role: 'slave', message: 'Connected. Enter secret to become Master.' }));

    ws.on('message', function incoming(message) {
        let msg;
        try { msg = JSON.parse(message); } catch (e) { return; }
        console.log(`received message type: ${msg.type} from client: ${ws.id}`);

        if (msg.type === 'attemptMaster') {
            if (msg.secret === MASTER_SECRET) {
                console.log(`Client ${ws.id} is now the master.`);
                if (masterClient && masterClient.id !== ws.id) {
                    masterClient.send(JSON.stringify({ type: 'role', role: 'slave', message: 'Master role taken by another client.' }));
                }
                masterClient = ws;
                // Get a list of all OTHER clients to send to the new master
                const otherClientIds = Array.from(clients.keys()).filter(id => id !== ws.id);
                ws.send(JSON.stringify({ type: 'role', role: 'master', message: 'You are now the master!', existingClients: otherClientIds }));
            } else {
                ws.send(JSON.stringify({ type: 'role', role: 'slave', message: 'Incorrect secret.' }));
            }
            return;
        }

        if (ws === masterClient) {
            if (msg.type === 'requestPlayback') {
                const playbackMsg = { type: 'playbackCommand' };
                wss.clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(playbackMsg));
                });
            } else if (msg.type === 'requestStop') {
                const stopMsg = { type: 'stopCommand' };
                wss.clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(stopMsg));
                });
            } else if (msg.type === 'assignTrackToClient') {
                const { targetClientId, trackName } = msg.payload;
                const targetClient = clients.get(targetClientId);
                if (targetClient && targetClient.readyState === WebSocket.OPEN) {
                    console.log(`Assigning track ${trackName} to client ${targetClientId}`);
                    targetClient.send(JSON.stringify({ type: 'assignTrack', trackName: trackName }));
                }
            }
        } else {
            console.log(`Message from non-master client ${ws.id} ignored.`);
        }
    });

    ws.on('close', function close() {
        console.log(`Client disconnected: ${ws.id}`);
        clients.delete(ws.id);
        if (masterClient && masterClient.id === ws.id) {
            console.log('Master disconnected.');
            masterClient = null;
        } else if (masterClient && masterClient.readyState === WebSocket.OPEN) {
            // Notify the master that a slave has disconnected
            masterClient.send(JSON.stringify({ type: 'clientDisconnected', clientId: ws.id }));
        }
    });

    ws.on('error', (err) => console.error(`WebSocket error for client ${ws.id}:`, err.message));

    // After setting up listeners, if a master already exists, notify them of the new client
    if (masterClient && masterClient.readyState === WebSocket.OPEN && masterClient.id !== ws.id) {
        masterClient.send(JSON.stringify({ type: 'newClientConnected', clientId: ws.id }));
    }
});

server.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
});