// server.js

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const MASTER_SECRET = "qwerty";

let masterClient = null;
const clients = new Map();
const readyClients = new Set();

app.use(express.static(path.join(__dirname, 'public')));

wss.on('connection', function connection(ws) {
    const clientId = crypto.randomUUID();
    ws.id = clientId;
    clients.set(clientId, ws);
    console.log(`Client connected with ID: ${clientId}`);

    ws.send(JSON.stringify({ type: 'role', role: 'slave', message: 'Connected. Enter secret to become Master.' }));

    ws.on('message', function incoming(message) {
        let msg;
        try { msg = JSON.parse(message); } catch (e) { return; }
        // Don't log timeSync messages to avoid clutter
        if (msg.type !== 'timeSync') {
            console.log(`received message type: ${msg.type} from client: ${ws.id}`);
        }

        // --- Time Synchronization Handler ---
        if (msg.type === 'timeSync') {
            ws.send(JSON.stringify({
                type: 'timeSyncResponse',
                clientTime: msg.clientTime, // Echo back the client's original time
                serverTime: Date.now()      // Add the server's current time
            }));
            return;
        }

        if (msg.type === 'attemptMaster') {
            if (msg.secret === MASTER_SECRET) {
                console.log(`Client ${ws.id} is now the master.`);
                if (masterClient && masterClient.id !== ws.id) {
                    masterClient.send(JSON.stringify({ type: 'role', role: 'slave', message: 'Master role taken by another client.' }));
                }
                masterClient = ws;
                readyClients.clear();
                const otherClientIds = Array.from(clients.keys()).filter(id => id !== ws.id);
                ws.send(JSON.stringify({ type: 'role', role: 'master', message: 'You are now the master!', existingClients: otherClientIds }));
            } else {
                ws.send(JSON.stringify({ type: 'role', role: 'slave', message: 'Incorrect secret.' }));
            }
            return;
        }

        if (msg.type === 'clientReady') {
            console.log(`Client ${ws.id} reported it is ready.`);
            readyClients.add(ws.id);
            if (masterClient && masterClient.readyState === WebSocket.OPEN) {
                masterClient.send(JSON.stringify({ type: 'clientStateUpdate', clientId: ws.id, isReady: true }));
            }
            return;
        }

        if (ws === masterClient) {
            if (msg.type === 'requestPlayback') {
                const { targetClientIds } = msg;
                console.log(`Master requested playback for ${targetClientIds.length} clients.`);
                
                // Set a start time 2 seconds in the future from the server's perspective
                const serverStartTime = Date.now() + 2000;
                
                const playbackMsg = { type: 'playbackCommand', serverStartTime: serverStartTime };

                if (targetClientIds && Array.isArray(targetClientIds)) {
                    targetClientIds.forEach(clientId => {
                        const client = clients.get(clientId);
                        if (client && client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify(playbackMsg));
                        }
                    });
                }
                masterClient.send(JSON.stringify(playbackMsg));

            } else if (msg.type === 'requestStop') {
                const stopMsg = { type: 'stopCommand' };
                wss.clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(stopMsg));
                });
            } else if (msg.type === 'assignTrackToClient') {
                const { targetClientId, trackName } = msg.payload;
                const targetClient = clients.get(targetClientId);
                
                readyClients.delete(targetClientId);
                if (masterClient && masterClient.readyState === WebSocket.OPEN) {
                    masterClient.send(JSON.stringify({ type: 'clientStateUpdate', clientId: targetClientId, isReady: false }));
                }

                if (targetClient && targetClient.readyState === WebSocket.OPEN) {
                    targetClient.send(JSON.stringify({ type: 'assignTrack', trackName: trackName }));
                }
            }
        }
    });

    ws.on('close', function close() {
        console.log(`Client disconnected: ${ws.id}`);
        clients.delete(ws.id);
        readyClients.delete(ws.id);
        if (masterClient && masterClient.id === ws.id) {
            console.log('Master disconnected.');
            masterClient = null;
        } else if (masterClient && masterClient.readyState === WebSocket.OPEN) {
            masterClient.send(JSON.stringify({ type: 'clientDisconnected', clientId: ws.id }));
        }
    });

    ws.on('error', (err) => console.error(`WebSocket error for client ${ws.id}:`, err.message));

    if (masterClient && masterClient.readyState === WebSocket.OPEN && masterClient.id !== ws.id) {
        masterClient.send(JSON.stringify({ type: 'newClientConnected', clientId: ws.id }));
    }
});

server.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));