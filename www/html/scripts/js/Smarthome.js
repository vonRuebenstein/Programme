"use strict";

/**
 * Smarthome.js
 * Steuerung der Geräte via WebSocket & MariaDB-SVGs
 */

(function() {
    let socket = null;
    const RECONNECT_DELAY = 5000;

    // Initialisierung, wenn das DOM bereit ist
    document.addEventListener('DOMContentLoaded', () => {
        connect();
    });

    /**
     * Stellt die Verbindung zum WebSocket-Server her
     */
    function connect() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.hostname}:8001`;
        
        socket = new WebSocket(wsUrl);

        socket.onopen = () => {
            console.log("✅ WebSocket verbunden");
            // Initial alle Daten abrufen
            socket.send(JSON.stringify({ action: 'get_all' }));
        };

        socket.onmessage = (event) => {
            try {
                const response = JSON.parse(event.data);
                handleServerAction(response);
            } catch (err) {
                console.error("❌ Fehler beim Parsen der Server-Nachricht:", err);
            }
        };

        socket.onclose = () => {
            console.warn(`⚠️ Verbindung verloren. Reconnect in ${RECONNECT_DELAY/1000}s...`);
            setTimeout(connect, RECONNECT_DELAY);
        };

        socket.onerror = (err) => {
            console.error("[WebSocket] Fehler:", err);
            socket.close();
        };
    }

    /**
     * Verteilt die Aktionen vom Server
     */
    function handleServerAction(response) {
        switch (response.action) {
            case 'list':
                renderAll(response.data);
                break;
            case 'update':
                renderSteckdose(response.data);
                break;
            case 'error':
                alert("Server-Fehler: " + response.message);
                break;
            default:
                console.log("Unbekannte Aktion:", response.action);
        }
    }

    /**
     * Rendert alle Geräte initial
     */
    function renderAll(dosen) {
        const container = document.getElementById('steckdosen');
        if (!container) return;
        container.innerHTML = ''; 
        dosen.forEach(dose => renderSteckdose(dose));
    }

    /**
     * Erstellt oder aktualisiert eine einzelne Card
     */
    function renderSteckdose(steckdose) {
        const container = document.getElementById('steckdosen');
        if (!container) return;

        let card = document.getElementById(`card-${steckdose.Bezeichnung}`);

        if (!card) {
            card = document.createElement('div');
            card.id = `card-${steckdose.Bezeichnung}`;
            card.className = "card bg-base-100 shadow-xl border border-base-300 transition-all duration-500 hover:scale-[1.02]";
            container.appendChild(card);
        }

        const activeSVG = steckdose.Status === 1 ? steckdose.svg_on : steckdose.svg_off;
        const zeit = steckdose.Zeitstempel ? steckdose.Zeitstempel.split(' ')[1] : '--:--';

        card.innerHTML = `
            <figure class="px-6 pt-8">
                <svg viewBox="0 0 24 24" class="w-20 h-20" fill="none" stroke-linecap="round" stroke-linejoin="round">
                    ${activeSVG}
                </svg>
            </figure>
            <div class="card-body items-center text-center p-6">
                <h2 class="card-title text-sm font-bold uppercase tracking-tighter">${steckdose.Bezeichnung}</h2>
                <div class="badge badge-ghost badge-xs opacity-40 font-mono">${zeit}</div>
                
                <div class="card-actions justify-center mt-6">
                    <div class="join border border-base-200">
                        <button class="btn btn-sm join-item ${steckdose.Status === 1 ? 'btn-primary' : 'btn-ghost'}" 
                                onclick="window.schalte('${steckdose.Bezeichnung}', 1)">ON</button>
                        <button class="btn btn-sm join-item ${steckdose.Status === 0 ? 'btn-primary' : 'btn-ghost'}" 
                                onclick="window.schalte('${steckdose.Bezeichnung}', 0)">OFF</button>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Globale Schalt-Funktion (an window gebunden für onclick-Zugriff)
     */
    window.schalte = function(name, status) {
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
                action: 'Schalten',
                dose: name,
                status: status
            }));
        } else {
            console.error("Versuch zu schalten ohne aktive Verbindung.");
        }
    };

})();