"use strict";

let socket;
let currentDataStore = [];
const BUNGALOW_ID = "B5"; 

document.addEventListener('DOMContentLoaded', () => {
    initWebSocket();
    setupEventListeners();
    initDateFields();
});

function initWebSocket() {
    // Nutzt die IP des aktuellen Hosts (Raspberry Pi)
    const wsUri = `ws://pipbh.b5.intern:8765/ws`;
    socket = new WebSocket(wsUri);

    socket.onopen = () => {
        console.log("mit websocket verbunden");
    };

    socket.onmessage = (event) => {
        const response = JSON.parse(event.data);
        
        switch (response.action) {
            case "temp_data_chunk":
                // Wir schicken die Daten in die Pumpe
                handleIncomingChunk(response.data, response.progress);
                break;
            case "temp_stream_finished":
                finalizeLoading();
                break;
        }
    };

    socket.onclose = () => {
        console.warn("WS-Verbindung unterbrochen. Reconnect folgt...");
        setTimeout(initWebSocket, 5000);
    };
}

function handleIncomingChunk(chunk, progress) {
    const progressBar = document.getElementById('progress-bar');
    if (progressBar) progressBar.value = progress;

    if (!chunk || chunk.length === 0) return;

    // 1. Daten nach "Bezeichnung" gruppieren (Spaltenname aus deiner SP!)
    const tracesUpdate = {};
    chunk.forEach(row => {
        const name = row.Bezeichnung; 
        if (!tracesUpdate[name]) {
            tracesUpdate[name] = { x: [], y: [] };
        }
        // "Zeitpunkt" und "Temperatur" sind die Aliase aus deiner proc_Temperatur_Master_1
        tracesUpdate[name].x.push(row.Zeitpunkt);
        tracesUpdate[name].y.push(row.Temperatur);
    });

    const plotDiv = document.getElementById('plot_div1');

    // 2. Erster Chunk? Dann Plot erstellen. Sonst? Erweitern.
    if (!plotDiv.data || plotDiv.data.length === 0) {
        console.log("Erster Chunk empfangen, erstelle Plot...");
        createNewTraces(tracesUpdate);
    } else {
        const updateX = [];
        const updateY = [];
        const indices = [];

        // Wir ordnen die neuen Datenpunkte den existierenden Linien zu
        plotDiv.data.forEach((trace, idx) => {
            if (tracesUpdate[trace.name]) {
                updateX.push(tracesUpdate[trace.name].x);
                updateY.push(tracesUpdate[trace.name].y);
                indices.push(idx);
            }
        });

        if (indices.length > 0) {
            // Der Turbo-Befehl von Plotly
            Plotly.extendTraces('plot_div1', { x: updateX, y: updateY }, indices);
        }
    }
}

function createNewTraces(tracesUpdate) {
    const newTraces = Object.keys(tracesUpdate).map(name => {
        return {
            x: tracesUpdate[name].x,
            y: tracesUpdate[name].y,
            name: name,
            mode: 'lines',
            type: 'scattergl', // Hier wird die GPU gezündet
            line: { width: 2 }
        };
    });

    const layout = {
        title: 'Temperaturverlauf ' + BUNGALOW_ID,
        xaxis: { title: 'Zeitraum', type: 'date' },
        yaxis: { title: 'Temperatur in °C' },
        showlegend: true,
        hovermode: 'closest'
    };

    Plotly.newPlot('plot_div1', newTraces, layout);
}

function startLoading() {
    const start = document.getElementById('startdate').value;
    const end = document.getElementById('enddate').value;

    if (!start || !end) return;

    console.log(`Anforderung an Server: ${start} bis ${end}`);
    
    // Altes Diagramm löschen und Buttons sperren
    Plotly.purge('plot_div1'); 
    document.getElementById('progress-bar').value = 0;
    document.getElementById('submitdate').disabled = true;
    document.getElementById('stop-button').disabled = false;

    // Die Anfrage durch den Tunnel schießen
    socket.send(JSON.stringify({
        action: "request_temp_history",
        bungalow: BUNGALOW_ID,
        start: start,
        end: end
    }));
}

function finalizeLoading() {
    console.log("Datenstrom abgeschlossen.");
    document.getElementById('progress-bar').value = 100;
    document.getElementById('submitdate').disabled = false;
    document.getElementById('stop-button').disabled = true;
}

function setupEventListeners() {
    const btn = document.getElementById('submitdate');
    if (btn) btn.onclick = startLoading;
}

function initDateFields() {
    const endday = new Date();
    const startday = new Date();
    
    // Setzt das Startdatum genau einen Monat zurück
    startday.setMonth(endday.getMonth() - 1);

    // Falls der Monat davor kürzer war (z.B. 31. März -> 28. Februar), 
    // korrigiert JS das automatisch.
    
    document.getElementById('enddate').value = endday.toISOString().split('T')[0];
    document.getElementById('startdate').value = startday.toISOString().split('T')[0];
    
    console.log(`Standard-Zeitraum gesetzt: ${startday.toISOString().split('T')[0]} bis ${endday.toISOString().split('T')[0]}`);
}