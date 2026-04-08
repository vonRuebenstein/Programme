"use strict";

(function() {
    // --- Konfiguration ---
    let socket = null;
    const websocketUrl = 'ws://pipbh.b5.intern:8765';
    const syncPorts = [5006]; // Deine Abo-Ports

    /**
     * 1. LOGGING & FLYING MENU
     */
    function debugLog(type, message, data = null) {
        const timestamp = new Date().toLocaleTimeString();
        const styles = {
            send: "color: #0066cc; font-weight: bold;",
            receive: "color: #009933; font-weight: bold;",
            info: "color: #888;",
            error: "color: #ff3333; font-weight: bold;"
        };
        console.log(`%c[${type.toUpperCase()}] %c${timestamp}: ${message}`, styles[type] || "", "color: #333;", data || "");
        
        const menu = document.getElementById('flying-menu-content');
        if (menu) {
            const entry = document.createElement('div');
            entry.className = `border-b border-base-300 pb-1 mb-1 text-[10px] ${type === 'error' ? 'text-error' : ''}`;
            entry.innerHTML = `<span class="opacity-40">[${timestamp}]</span> ${message}`;
            menu.prepend(entry);
            if (menu.children.length > 30) menu.lastChild.remove();
        }
    }

    /**
     * 2. WEBSOCKET LOGIK
     */
    function connect() {
        debugLog('info', "Verbindungsversuch zum Server...");
        socket = new WebSocket(websocketUrl);

        socket.onopen = () => {
            debugLog('info', "✅ Verbindung hergestellt.");
            
            // 1. Daten laden
            socket.send(JSON.stringify({ action: 'request_all_doses' }));
            
            // 2. Abo senden für Echtzeit-Updates
            socket.send(JSON.stringify({ action: "subscribe", ports: syncPorts }));
            debugLog('send', "Abo für Ports " + syncPorts.join(", ") + " aktiviert.");
        };

        socket.onmessage = (event) => {
            try {
                const response = JSON.parse(event.data);
        
                // 1. Priorität: Daten-Antwort vom Server (Initialisierung)
                if (response.action === "getData-response") {
                    const cleanData = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
                    if (Array.isArray(cleanData)) renderAll(cleanData);
                    return; // Abbrechen, da erledigt
                }
        
                // 2. Priorität: Synchronisation über Port 5006
                // Hier ist es völlig egal, welchen 'type' der Server vergeben hat.
                // Sobald die Nachricht über 5006 kam, wissen wir: Jemand hat geschaltet.
                if (response.received_on_port === 5006) {
                    debugLog('info', "Sync-Signal erkannt -> Liste wird aktualisiert.");
                    socket.send(JSON.stringify({ action: 'request_all_doses' }));
                    return;
                }
        
                // 3. Priorität: Live-Status einer einzelnen Steckdose
                if (response.Bezeichnung) {
                    renderSteckdose(response);
                    return;
                }
        
                // 4. Priorität: Alles andere (Zähler-Impulse, Logs etc.)
                // Diese Daten kommen über 5005 oder 5007 rein.
                // Wir loggen sie nur im Flying Menu, ohne die Liste neu zu laden.
                if (response.type === "pulse") {
                    debugLog('receive', `Zähler-Impuls: ID ${response.counter_id} an GPIO ${response.gpio_pin}`);
                } else if (response.type === "log") {
                    debugLog('error', `Server-Log [${response.level}]: ${response.message}`);
                }
        
            } catch (err) {
                console.error("Fehler im Empfang:", err);
            }
        };

        socket.onclose = () => {
            debugLog('error', "⚠️ Verbindung verloren. Reconnect in 5s...");
            setTimeout(connect, 5000);
        };
    }

    /**
     * 3. RENDERING (UI)
     */
    function renderAll(dosen) {
        const container = document.getElementById('steckdosen');
        if (!container) return;
        container.innerHTML = ''; 
        dosen.forEach(renderSteckdose);
    }

    function renderSteckdose(dose) {
        const container = document.getElementById('steckdosen');
        let card = document.getElementById(`card-${dose.Bezeichnung}`);
        
        if (!card) {
            card = document.createElement('div');
            card.id = `card-${dose.Bezeichnung}`;
            card.className = "tooltip tooltip-bottom before:text-[10px] before:text-left before:whitespace-pre-line";
            container.appendChild(card);
        }

        const info = `Name: ${dose.Bezeichnung}\nKurz: ${dose.Kurzname || '-'}\nFB: ${dose.Fernbedienung || '-'}\nKanal: ${dose.Kanal || '-'}\nZeit: ${dose.Zeitstempel || '-'}`;
        card.setAttribute('data-tip', info);

        const activeSVG = dose.Status === 1 ? dose.svg_on : dose.svg_off;
        const colorClass = dose.Status === 1 ? "text-primary" : "text-base-content opacity-20";

        card.innerHTML = `
            <div class="card bg-base-100 shadow-xl border border-base-300 w-full hover:bg-base-200 transition-all duration-300">
                <figure class="px-6 pt-6 ${colorClass}">
                    <svg viewBox="0 0 24 24" class="w-12 h-12 fill-current">${activeSVG}</svg>
                </figure>
                <div class="card-body items-center text-center p-4">
                    <h2 class="card-title text-[10px] uppercase font-bold tracking-widest">${dose.Bezeichnung}</h2>
                    <div class="join mt-2">
                        <button onclick="window.schalte('${dose.Bezeichnung}', 1)" class="btn btn-xs join-item ${dose.Status === 1 ? 'btn-primary' : 'btn-ghost'}">ON</button>
                        <button onclick="window.schalte('${dose.Bezeichnung}', 0)" class="btn btn-xs join-item ${dose.Status === 0 ? 'btn-primary' : 'btn-ghost'}">OFF</button>
                    </div>
                </div>
            </div>`;
    }

    /**
     * 4. GLOBALE FUNKTIONEN
     */
    window.schalte = function(name, status) {
        if (socket && socket.readyState === WebSocket.OPEN) {
            debugLog('send', `Schalte ${name} -> ${status === 1 ? 'AN' : 'AUS'}`);
            socket.send(JSON.stringify({ action: 'Schalten', bezeichnung: name, status: status }));
        }
    };

    // Beim Verlassen der Seite Abo kündigen
    window.addEventListener('beforeunload', () => {
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ action: 'unsubscribe', ports: syncPorts }));
        }
    });

    document.addEventListener('DOMContentLoaded', connect);
})();