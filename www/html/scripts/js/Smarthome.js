'use strict';

// Konfigurationsvariablen für die WebSocket-Verbindung
const WEBSOCKET_HOST = 'ws://pipbh.b5.intern:8765/ws';
let websocket;

// Funktion zum Anzeigen von Benachrichtigungen (angepasst für DaisyUI toast)
function displayNotifications(messages, type = 'info') {
    const benachrichtigungsContainer = document.getElementById('benachrichtigungsContainer');
    if (!benachrichtigungsContainer) {
        console.error("BenachrichtigungsContainer nicht gefunden!");
        return;
    }

    messages.forEach(msg => {
        const benachrichtigung = document.createElement('div');
        benachrichtigung.classList.add('alert');
        
        // DaisyUI Klassen für Typen
        if (type === 'success') {
            benachrichtigung.classList.add('alert-success');
        } else if (type === 'error') {
            benachrichtigung.classList.add('alert-error');
        } else {
            benachrichtigung.classList.add('alert-info');
        }

        benachrichtigung.innerHTML = `<span>${msg}</span>`;

        benachrichtigungsContainer.appendChild(benachrichtigung);

        setTimeout(() => {
            if (benachrichtigungsContainer.contains(benachrichtigung)) {
                benachrichtigungsContainer.removeChild(benachrichtigung);
            }
        }, 5000);
    });
}

// Funktion zum Erstellen oder Aktualisieren der Steckdosen-UI (angepasst für DaisyUI card)
function updateSteckdosenUI(steckdose) {
    const container = document.getElementById('steckdosen');
    let div = document.getElementById(`steckdose-${steckdose.Bezeichnung}`);
    
    // Element neu erstellen, falls es noch nicht existiert
    if (!div) {
        div = document.createElement('div');
        div.id = `steckdose-${steckdose.Bezeichnung}`;
        div.classList.add('card', 'bg-base-100', 'shadow-xl'); // DaisyUI Card-Klassen
        container.appendChild(div);
    }
    
    // Bestimme die Icon-Farbe basierend auf dem Status
    const iconColorClass = steckdose.Status === 1 ? 'text-yellow-400 drop-shadow-lg' : 'text-gray-400';
    
    // UI-Elemente aktualisieren
    // ACHTUNG: Der gesamte Inhalt der Karte wird neu geschrieben
    div.innerHTML = `
        <figure class="px-6 pt-6">
            <svg xmlns="http://www.w3.org/2000/svg" class="w-20 h-20 ${iconColorClass}" viewBox="0 0 24 24" fill="currentColor">
                <path d="M2 12C2 7.21875 5.5625 4.5 9 3.5C9.6875 3.3125 10.375 3.15625 11 3.125C11.6875 3.125 12.375 3.15625 13 3.3125C16.4375 4.5 20 7.21875 20 12C20 16.7812 16.4375 19.5 13 20.6875C12.375 20.8438 11.6875 20.875 11 20.875C10.375 20.875 9.6875 20.8438 9 20.6875C5.5625 19.5 2 16.7812 2 12Z" stroke="#000000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        </figure>
        <div class="card-body items-center text-center p-2">
            <h2 class="card-title text-sm">${steckdose.Bezeichnung}</h2>
            <details class="collapse bg-base-200">
                <summary class="collapse-title font-medium text-xs">Details</summary>
                <div class="collapse-content text-xs">
                    <p>
                        Bezeichnung: ${steckdose.Bezeichnung}<br>
                        Kurzname: ${steckdose.Kurzname || ''}<br>
                        Fernbedienung: ${steckdose.Fernbedienung}<br>
                        Kanal: ${steckdose.Kanal}<br>
                        Zuletzt geschaltet: ${steckdose.Zeitstempel}
                    </p>
                </div>
            </details>
            <div class="card-actions justify-end mt-2">
                <button class="btn btn-success btn-sm" onclick="schalteSteckdose('${steckdose.Bezeichnung}', 1)">Einschalten</button>
                <button class="btn btn-error btn-sm" onclick="schalteSteckdose('${steckdose.Bezeichnung}', 0)">Ausschalten</button>
            </div>
        </div>
    `;
}

// Rest der Funktionen bleibt unverändert

// Funktion zum Verarbeiten der empfangenen WebSocket-Nachrichten
function handleWebSocketMessage(event) {
    try {
        const message = JSON.parse(event.data);
        console.log('Nachricht vom Server erhalten:', message);

        // Fall 1: Die Nachricht ist ein 'Wrapper' (z.B. die initiale Antwort)
        if (message.action) {
            if (message.action === 'getData-response' && message.status === 'success') {
                const data = JSON.parse(message.data);
                if (Array.isArray(data)) {
                    const container = document.getElementById('steckdosen');
                    container.innerHTML = '';
                    data.forEach(dose => updateSteckdosenUI(dose));
                    displayNotifications(['Steckdosen-Daten erfolgreich vom Server empfangen.'], 'success');
                }
            } else if (message.action === 'Schalten-Response' && message.status === 'success') {
                const messageContent = message.message;
                try {
                    const data = JSON.parse(messageContent);
                    if (Array.isArray(data) && data.length > 0) {
                        updateSteckdosenUI(data[0]);
                    } else if (typeof data === 'object' && data.Bezeichnung) {
                        updateSteckdosenUI(data);
                    }
                    displayNotifications([`Schaltbefehl erfolgreich verarbeitet.`], 'success');
                } catch (e) {
                    console.error("Fehler beim Parsen des JSON aus message.message:", e);
                }
            } else if (message.status === 'error') {
                displayNotifications([`Fehler vom Server: ${message.message}`], 'error');
            }
        
        // Fall 2: Die Nachricht ist direkt das JSON-Objekt einer geschalteten Dose
        } else if (message.Bezeichnung) {
            updateSteckdosenUI(message);
            displayNotifications([`Status von '${message.Bezeichnung}' aktualisiert.`], 'info');
        } else {
            console.error('Unbekanntes Nachrichtenformat erhalten:', message);
        }

    } catch (error) {
        console.error("Fehler beim Verarbeiten der WebSocket-Nachricht:", error);
    }
}

function requestAllDoses() {
    if (websocket && websocket.readyState === WebSocket.OPEN) {
        const requestCommand = JSON.stringify({
            action: "request_all_doses"
        });
        websocket.send(requestCommand);
        console.log("Anforderung aller Steckdosen-Daten an den Server gesendet.");
    }
}

// Funktion zur initialen Verbindung mit dem WebSocket-Server
function connectWebSocket() {
    websocket = new WebSocket(WEBSOCKET_HOST);

    websocket.onopen = () => {
        console.log("WebSocket-Verbindung erfolgreich hergestellt.");
        displayNotifications(['Mit dem Echtzeit-Status-Server verbunden.'], 'success');
        
        requestAllDoses();
    };

    websocket.onmessage = handleWebSocketMessage;

    websocket.onclose = (event) => {
        console.log(`WebSocket-Verbindung geschlossen: Code ${event.code}, Grund: ${event.reason}`);
        displayNotifications([`Verbindung zum Server verloren. Versuche Neuverbindung...`], 'error');
        setTimeout(connectWebSocket, 5000); 
    };

    websocket.onerror = (error) => {
        console.error("WebSocket-Fehler:", error);
        displayNotifications([`WebSocket-Fehler: ${error.message}`], 'error');
    };
}

// Funktion zum Schalten der Steckdose über WebSocket
function schalteSteckdose(bezeichnung, status) {
    if (websocket && websocket.readyState === WebSocket.OPEN) {
        const switchCommand = JSON.stringify({
            action: "Schalten",
            bezeichnung: bezeichnung,
            status: status
        });
        websocket.send(switchCommand);
        console.log(`Schaltbefehl gesendet: ${switchCommand}`);
        displayNotifications([`Sende Schaltbefehl für '${bezeichnung}'...`], 'info');
    } else {
        displayNotifications([`WebSocket-Verbindung ist nicht bereit.`], 'error');
        console.error('WebSocket-Verbindung ist nicht bereit, Befehl konnte nicht gesendet werden.');
    }
}

// Main-Programm-Start
document.addEventListener('DOMContentLoaded', () => {
    connectWebSocket();
});

// Stoppt die WebSocket-Verbindung beim Verlassen der Seite
window.addEventListener('beforeunload', () => {
    if (websocket) {
        websocket.close();
        console.log('WebSocket-Verbindung geschlossen.');
    }
});