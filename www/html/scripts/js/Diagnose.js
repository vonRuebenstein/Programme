'use strict'

/**
 * ========================================
 * Globale Konfiguration & Variablen
 * ========================================
 */

// DOM-Elemente abrufen
const connectionStatusSpan = document.getElementById('connectionStatus');
const messagesDiv = document.getElementById('messages');

// WebSocket-URL Konfiguration
const websocketUrl = 'ws://pipbh.b5.intern:8765';

let ws; 
let reconnectInterval = null;

// Konfiguration für den exponentiellen Backoff
const reconnectSettings = {
    delay: 1000,    // Starts with 1 second delay
    maxDelay: 32000 // Maximum delay of 32 seconds
};
let reconnectAttempts = 0;

const subscribedPorts = [5005, 5006, 5007]; // The ports to be subscribed to on this page
    
// Mapping of ports to DaisyUI colors
const portColors = {
    5005: 'alert-primary',
    5006: 'alert-secondary',
    5007: 'alert-accent'
};

/**
 * ========================================
 * WebSocket-Verwaltung
 * ========================================
 */

/**
 * Establishes the WebSocket connection.
 */
function connectWebSocket() {
    console.log(`Attempting to connect WebSocket to: ${websocketUrl}`);
    
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        console.log('WebSocket is already open or connecting. Aborting connection attempt.');
        return;
    }
    
    try {
        ws = new WebSocket(websocketUrl);
    } catch (e) {
        console.error('Error creating WebSocket object:', e);
        handleConnectionError();
        return;
    }
    
    // --- 4. WebSocket Event Handler ---
    
    ws.onopen = function(event) {
        console.log('WebSocket connected:', event);
        connectionStatusSpan.textContent = 'Verbunden';
        connectionStatusSpan.className = 'badge badge-lg badge-success animate-pulse';
        
        // Reset timer and attempts on successful connection
        if (reconnectInterval) {
            clearTimeout(reconnectInterval);
            reconnectInterval = null;
        }
        reconnectAttempts = 0;
        console.log('Reconnect timer and attempts stopped/reset.');
        
        // Send a single message containing all ports in the array
        const subscribeMessage = JSON.stringify({ action: 'subscribe', ports: subscribedPorts });
        ws.send(subscribeMessage);
        console.log(`Subscription message sent: ${subscribeMessage}`);
    };
    
    ws.onmessage = function(event) {
        console.log('Raw data received:', event.data);

        try {
            const data = JSON.parse(event.data);
            
            console.log('Parsed data:', data);

            // Remove initial waiting message
            if (messagesDiv.querySelector('.text-muted.text-center')) {
                messagesDiv.innerHTML = '';
            }

            const messageElement = document.createElement('div');
            messageElement.classList.add('alert', 'shadow-lg', 'mb-2', 'p-2', 'rounded-lg');

            // Set DaisyUI class based on the port
            const actualReceivedPort = data?.received_on_port;
            const portColorClass = (typeof actualReceivedPort !== 'undefined' && portColors[actualReceivedPort]) ? portColors[actualReceivedPort] : 'alert-info';
            messageElement.classList.add(portColorClass);

            let content = '';
            // Determine message type and format content accordingly
            if (data?.type === 'pulse') {
                content = `
                    <div class="message-col timestamp">${data?.timestamp}</div>
                    <div class="message-col source-port">Port: ${actualReceivedPort}</div> 
                    <div class="message-col sender">${data?.sender_ip}:${data?.sender_port}</div> 
                    <div class="message-col content pulse-message">${data?.message}</div>
                `;
            } else if (data?.type === 'log') {
                content = `
                    <div class="message-col timestamp">${data?.timestamp}</div>
                    <div class="message-col source-port">Port: ${actualReceivedPort}</div> 
                    <div class="message-col sender">${data?.sender_ip}:${data?.sender_port}</div> 
                    <div class="message-col content log-message"><span class="log-level-${data?.level?.toLowerCase()}">[${data?.level}]</span>: ${data?.message}</div>
                `;
            } else { // generic or unknown
                content = `
                    <div class="message-col timestamp">${data?.timestamp}</div>
                    <div class="message-col source-port">Port: ${actualReceivedPort}</div> 
                    <div class="message-col sender">${data?.sender_ip}:${data?.sender_port}</div> 
                    <div class="message-col content generic-message">${data?.message}</div>
                `;
            }

            // Create a temporary div to parse the content string to allow for class manipulation
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = content;
            
            // Re-add DaisyUI-specific classes for visual consistency
            if (data?.type === 'log') {
                const logLevelSpan = tempDiv.querySelector('span');
                if (logLevelSpan) {
                    switch (data.level) {
                        case 'INFO':
                            logLevelSpan.classList.add('text-blue-500', 'font-bold');
                            break;
                        case 'WARN':
                            logLevelSpan.classList.add('text-yellow-500', 'font-bold');
                            break;
                        case 'ERROR':
                            logLevelSpan.classList.add('text-red-500', 'font-bold');
                            break;
                        default:
                            break;
                    }
                }
            }

            messageElement.innerHTML = tempDiv.innerHTML;
            messagesDiv.prepend(messageElement);

            const maxMessages = 100;
            while (messagesDiv.children.length > maxMessages) {
                messagesDiv.removeChild(messagesDiv.lastChild);
            }

        } catch (e) {
            console.error('Error parsing WebSocket message or updating DOM:', e);
            console.error('Received data that caused the error:', event.data);
        }
    };
    
    ws.onclose = function(event) {
        console.warn('WebSocket disconnected:', event);
        connectionStatusSpan.textContent = 'Getrennt';
        connectionStatusSpan.className = 'badge badge-lg badge-error';
        
        // Stop old reconnect timers if they exist
        if (reconnectInterval) {
            clearTimeout(reconnectInterval);
        }
        
        // Calculate the delay with exponential backoff
        const delay = Math.min(
            reconnectSettings.delay * Math.pow(2, reconnectAttempts),
            reconnectSettings.maxDelay
        );
        
        reconnectAttempts++;
        
        console.log(`Starting automatic reconnect attempt in ${delay / 1000} seconds (Attempt ${reconnectAttempts})...`);
        reconnectInterval = setTimeout(connectWebSocket, delay);
    };

    ws.onerror = function(event) {
        console.error('WebSocket error:', event);
        // The onclose method is called after onerror, so the reconnect logic can remain centralized there.
        // It's not necessary to call handleConnectionError here.
    };

    function handleConnectionError() {
        connectionStatusSpan.textContent = 'Fehler!';
        connectionStatusSpan.className = 'badge badge-lg badge-error';
        if (!reconnectInterval) {
            console.log('Starting automatic reconnect attempt after error in 3 seconds...');
            reconnectInterval = setTimeout(connectWebSocket, 3000);
        }
    }
}
    
/**
 * ========================================
 * Initialisierung
 * ========================================
 */
    
// Unsubscribe when leaving the page
window.addEventListener('beforeunload', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        // Send a single message to unsubscribe from all ports
        const unsubscribeMessage = JSON.stringify({ action: 'unsubscribe', ports: subscribedPorts });
        ws.send(unsubscribeMessage);
        console.log(`Unsubscribe message sent: ${unsubscribeMessage}`);
        ws.close();
    }
});

document.addEventListener('DOMContentLoaded', connectWebSocket);
