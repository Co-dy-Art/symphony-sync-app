// server.js

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000; // You can change this if 3000 is in use

let masterClient = null; // To keep track of the master device's WebSocket connection

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

wss.on('connection', function connection(ws) {
    console.log('Client connected');

    // Assign initial role (e.g., first client could be master, or let client request role)
    // For simplicity, let's assume the client will tell us its role.
    // If no master is currently assigned, this client becomes the master by default.
    if (!masterClient) {
        masterClient = ws;
        ws.send(JSON.stringify({ type: 'role', role: 'master' }));
        console.log('New master assigned based on first connection.');
    } else {
        ws.send(JSON.stringify({ type: 'role', role: 'slave' }));
        console.log('New slave connected.');
    }

    ws.on('message', function incoming(message) {
        let msg;
        try {
            msg = JSON.parse(message);
        } catch (e) {
            console.error('Failed to parse message:', message, e);
            return;
        }
        console.log('received message type:', msg.type);

        // Handle role assignment if coming from client explicitly
        if (msg.type === 'requestRole') {
            if (msg.role === 'master' && !masterClient) {
                masterClient = ws;
                ws.send(JSON.stringify({ type: 'role', role: 'master', message: 'You are now the master.' }));
                console.log('Client requested and became master.');
            } else {
                ws.send(JSON.stringify({ type: 'role', role: 'slave', message: 'You are a slave.' }));
                console.log('Client requested role, assigned slave.');
            }
            return; // Don't broadcast role requests
        }

        // Only master can send commands to be broadcast
        if (ws === masterClient) {
            if (msg.type === 'playbackCommand') {
                console.log('Master sent playback command:', msg.command);
                wss.clients.forEach(function each(client) {
                    if (client !== masterClient && client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify(msg)); // Broadcast playback command to all slaves
                    }
                });
            } else if (msg.type === 'masterAssignTrack') { // NEW BLOCK FOR TRACK ASSIGNMENT
                console.log('Master assigning track:', msg.trackName);
                wss.clients.forEach(function each(client) {
                    if (client !== masterClient && client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({ type: 'assignTrack', trackName: msg.trackName })); // Broadcast track assignment to all slaves
                    }
                });
            }
        } else {
            console.log('Slave tried to send command, ignored. Message type:', msg.type);
        }
    });

    ws.on('close', function close() {
        console.log('Client disconnected');
        if (ws === masterClient) {
            console.log('Master disconnected. Reassigning master...');
            masterClient = null; // Clear master if they disconnect
            // Optional: Implement logic to automatically assign a new master
            // e.g., send a 'requestMasterRole' message to remaining clients,
            // or assign the next connected client as master.
            wss.clients.forEach(function each(client) {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({ type: 'masterDisconnected', message: 'Master disconnected. Please reconnect or refresh if you wish to become master.' }));
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