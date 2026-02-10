"use strict";

class Fetcher {
    constructor(url) {
        this.url = url;
        this.allData = [];
        this.chunkNum = 0;
        this.chunk_Size = 10000;
        this.offset = 0;
        this.totalChunks = 1;
        this.progressbar = null;
        this.stopflag = false;
    }

    async fetchData(Bungalow, Startdatum, Enddatum) {
        this.updateProgressBar(0);
        this.allData = []; // Daten bei neuem Fetch leeren
        this.offset = 0; // Offset bei neuem Fetch zurücksetzen
        this.chunkNum = 0; // Chunk-Nummer zurücksetzen
        this.totalChunks = 1; // totalChunks für den ersten Request auf 1 setzen
        this.stopflag = false; // stopflag zurücksetzen

        while (!this.stopflag) {
            const response = await fetch(this.url, {
                method: 'POST',
                headers: {'Content-Type': 'application/x-www-form-urlencoded'},
                body: `Bungalow=${Bungalow}
                       &Startdatum=${Startdatum}
                       &Enddatum=${Enddatum}
                       &Offset=${this.offset}
                       &Chunk_Size=${this.chunk_Size}
                       &Total_Chunks=${this.totalChunks}`
            });

            const data = await response.json();

            this.chunkNum = parseInt(response.headers.get('X-Chunk-Number'), 10);
            const isLastChunk = response.headers.get('X-Last-Chunk') === 'true';

            this.allData = this.allData.concat(data);

            if (this.chunkNum === 1) {
                this.totalChunks = parseInt(response.headers.get('X-Total-Chunks'), 10);
            }

            this.updateProgressBar(this.chunkNum / this.totalChunks * 100);

            if (isLastChunk) {
                break;
            } else {
                this.offset = this.offset + this.chunk_Size;
            }
        }
        return this.allData;
    }

    updateProgressBar(val) {
        if (this.progressbar !== null) {
            this.progressbar.value = val;
        }
        return;
    }

    setProgressBar(obj) {
        if (obj && obj.tagName === 'PROGRESS') {
            this.progressbar = obj;
        }
        return;
    }

    stop() {
        this.stopflag = true;
        console.log('Fetch-Vorgang wird angehalten.');
    }
}

function ToLocalDate(date, loc) {
    let datum = new Date(date);
    let options = { year: 'numeric', month: '2-digit', day: '2-digit' };
    let formatter = new Intl.DateTimeFormat(loc, options);
    return formatter.format(datum);
}

function group(data, groupByKeys, valueKey) {
    const result = {};
    data.forEach(item => {
        let currentGroup = result;
        groupByKeys.forEach(key => {
            currentGroup = currentGroup[item[key]] || (currentGroup[item[key]] = {});
        });

        currentGroup.min = Math.min(currentGroup.min || Infinity, item[valueKey]);
        currentGroup.max = Math.max(currentGroup.max || -Infinity, item[valueKey]);

        currentGroup.sum = (currentGroup.sum || 0) + item[valueKey];
        currentGroup.count = (currentGroup.count || 0) + 1;
        currentGroup.avg = currentGroup.sum / currentGroup.count;
    });
    return result;
}

// Eine globale Farbpalette, die Plotly's Standardfarben nachahmt oder eigene feste Farben bereitstellt
const PLOTLY_DEFAULT_COLORS = [
    '#1f77b4', // muted blue
    '#ff7f0e', // safety orange
    '#2ca02c', // cooked asparagus green
    '#d62728', // brick red
    '#9467bd', // muted purple
    '#8c564b', // raw sienna
    '#e377c2', // middle purple
    '#7f7f7f', // gray
    '#bcbd22', // curry yellow-green
    '#17becf'  // blue-teal
];


async function init() {
    let btn_stop_button = document.getElementById('stop-button');
    let btn_submitdate = document.getElementById('submitdate');
    let dat_Startdatum = document.getElementById('startdate');
    let dat_Enddatum = document.getElementById('enddate');
    btn_stop_button.disabled = false;
    btn_submitdate.disabled = true;
    dat_Startdatum.disabled = true;
    dat_Enddatum.disabled= true;
    let Startdatum = dat_Startdatum.value;
    let Enddatum = dat_Enddatum.value;
    
    
    const Bungalow = 'B5';

    const TempFetcher = new Fetcher('scripts/Temperatur.php');
    TempFetcher.setProgressBar(document.getElementById('progress-bar'));
    document.getElementById('stop-button').addEventListener('click', () => {
        TempFetcher.stop();
    });

    let allData = await TempFetcher.fetchData(Bungalow, Startdatum, Enddatum);

    btn_stop_button.disabled = true;
    
    if (!allData || allData.length === 0) {
        console.warn("Keine Daten zum Verarbeiten gefunden.");
        document.getElementById('plot_div').innerHTML = '<p>Keine Daten für den gewählten Zeitraum vorhanden.</p>';
        document.getElementById('plot_div1').innerHTML = '';
        TempFetcher.updateProgressBar(0);
        return;
    }

    let df = new dfd.DataFrame(allData);

    console.log(allData);

    if (df.columns.includes('Zeitpunkt') && df.head(1)['Zeitpunkt'].values.length > 0) {
        Startdatum = ToLocalDate(df.head(1)['Zeitpunkt'].values[0], 'de-DE');
        Enddatum = ToLocalDate(df.tail(1)['Zeitpunkt'].values[0], 'de-DE');
    } else {
        console.warn("Spalte 'Zeitpunkt' nicht gefunden oder leer. Datumsanzeige kann ungenau sein.");
        Startdatum = document.getElementById('startdate').value;
        Enddatum = document.getElementById('enddate').value;
    }

    let grouped = df.groupby(["Bezeichnung"]).agg({"Temperatur":["mean","max","min"]});

    let bezeichnung = grouped["Bezeichnung"].values;
    let minimum = grouped["Temperatur_min"].values;
    let maximum = grouped["Temperatur_max"].values;
    let durchschnitt = grouped["Temperatur_mean"].values;
    let maximum1 = maximum.map((value, index) => value - minimum[index]);

    // Dynamische Farbzuweisung für den ersten Plot
    const bezeichnungToColorMap = {};
    // Die 'bezeichnung'-Variable enthält die einzigartigen Bezeichnungen aus dem ersten Grouping
    bezeichnung.forEach((name, index) => {
        bezeichnungToColorMap[name] = PLOTLY_DEFAULT_COLORS[index % PLOTLY_DEFAULT_COLORS.length];
    });


    var trace1 = { // Balken für Minimalwert (Höhe ist Max-Min)
        x: bezeichnung,
        y: maximum1,
        base: minimum, // Startpunkt des Balkens
        type: 'bar',
        orientation: 'v',
        hovertemplate: 'Sensor: %{x}<br>Max: %{y:.2f}°C<br>Min: %{base:.2f}°C',
        name: "Temperaturbereich",
        marker: {
            color: bezeichnung.map(name => bezeichnungToColorMap[name]) // Farbliche Unterscheidung
        },
        showlegend: true // Sicherstellen, dass die Legende angezeigt wird
    };

    var trace2 = { // Punktmarkierung für Durchschnittswert
        x: grouped["Bezeichnung"].values,
        y: durchschnitt,
        mode: 'markers',
        marker: {
            // Die Farbe für die Marker muss ebenfalls aus der Map geholt werden,
            // aber Plotly kann hier auch die Standardfarbe nutzen, wenn sie nicht explizit gesetzt ist.
            // Um sicherzustellen, dass sie mit den Balken übereinstimmt:
            color: grouped["Bezeichnung"].values.map(name => bezeichnungToColorMap[name]),
            size: 12,
            line: { // Optional: Rand um die Marker, um sie sichtbarer zu machen
                color: 'black',
                width: 1
            }
        },
        name: 'Mittelwert',
        showlegend: true // Sicherstellen, dass die Legende angezeigt wird
    };

    var traces = [trace1, trace2];

    var layout = { // Layout für Balkendiagramm
        title: `Sensorenübersicht vom ${Startdatum} bis ${Enddatum}`,
        yaxis: {
            title: 'Temperatur (°C)'
        },
        showlegend: true // Legende global für den Plot anzeigen
    };

    var config = {
    responsive: true
    };

    Plotly.newPlot('plot_div', traces, layout);

    // --- Zweiter Plot: Tagesverlauf ---
    if (df.columns.includes('Zeitpunkt') && df.columns.includes('Bezeichnung')) {
        let traces_hourly = [];
        let uniqueBezeichnungen = df['Bezeichnung'].unique().values;

        const bezeichnungToColorMapHourly = {};
        uniqueBezeichnungen.forEach((name, index) => {
             bezeichnungToColorMapHourly[name] = PLOTLY_DEFAULT_COLORS[index % PLOTLY_DEFAULT_COLORS.length];
        });

        uniqueBezeichnungen.forEach(bezeichnungName => {
            let filteredDf = df.query(df['Bezeichnung'].eq(bezeichnungName));
            filteredDf.sortValues('Zeitpunkt', { inplace: true });

            let trace = {
                x: filteredDf['Zeitpunkt'].values,
                y: filteredDf['Temperatur'].values,
                mode: 'lines+markers',
                name: bezeichnungName,
                marker: { size: 4 },
                line: { color: bezeichnungToColorMapHourly[bezeichnungName] },
                hovertemplate: `Sensor: ${bezeichnungName}<br>
                                 Zeitpunkt: %{x|%d.%m.%Y %H:%M:%S}<br>
                                 Temperatur: %{y:.2f}°C<extra></extra>`
            };
            traces_hourly.push(trace);
        });

        var layout_hourly = {
            title: `Tagesverlauf der Sensoren vom ${Startdatum} bis ${Enddatum}`,
            height:800,
            xaxis: {
                title: 'Zeitpunkt',
                type: 'date',
                // Die dtick und tickformat können beibehalten werden oder Plotly überlassen werden,
                // wenn der Slider und Zoom aktiv sind, da der Benutzer den Detailgrad steuert.
                // dtick: 24 * 60 * 60 * 1000, // Beschriftung alle 24 Stunden
                // tickformat: '%d.%m.', // Nur das Datum anzeigen (z.B. "30.06.")
                automargin: true,
                tickangle: 45,
                
                // *** Hinzufügungen für Slider und Range-Selektor ***
                rangeslider: {
                    visible: true,
                    // Optional: rangemode: 'match', // 'fixed' oder 'tozero'
                },
                rangeselector: {
                    buttons: [
                        {
                            count: 1,
                            label: '1d', // 1 Tag
                            step: 'day',
                            stepmode: 'backward'
                        },
                        {
                            count: 7,
                            label: '1w', // 1 Woche
                            step: 'day',
                            stepmode: 'backward'
                        },
                        {
                            count: 1,
                            label: '1m', // 1 Monat
                            step: 'month',
                            stepmode: 'backward'
                        },
                        {
                            count: 6,
                            label: '6m', // 6 Monate
                            step: 'month',
                            stepmode: 'backward'
                        },
                        {
                            step: 'all',
                            label: 'Alles' // Alle Daten
                        }
                    ]
                }
            },
            yaxis: {
                title: 'Temperatur (°C)'
                },
            hovermode: 'x unified'
        };
var config = {
    responsive: true
};


        Plotly.newPlot('plot_div1', traces_hourly, layout_hourly);
    } else {
        console.warn("Für den Tagesverlaufs-Plot fehlen 'Zeitpunkt' oder 'Bezeichnung' Spalten.");
        document.getElementById('plot_div1').innerHTML = '<p>Für den Tagesverlaufs-Plot fehlen die Spalten "Zeitpunkt" oder "Bezeichnung".</p>';
    }

    let gr = group(allData, ['Bezeichnung'], 'Temperatur');
    console.log("Gruppierte Daten mit eigener Funktion:", gr);

    df = null;
    
    dat_Enddatum.disabled = false;
    dat_Startdatum.disabled = false;
    btn_submitdate.disabled = false;
    return;
}


// --- Initialisierung der Datumseingabefelder und Event Listener ---
const endday = new Date();
const startday = new Date();
startday.setMonth(endday.getMonth() - 1);

let enddate = document.getElementById('enddate');
enddate.value = endday.toISOString().split('T')[0];
enddate.min = '2020-03-25';
enddate.max = enddate.value;
enddate.addEventListener('change', changeenddate, false);

let startdate = document.getElementById('startdate');
startdate.value = startday.toISOString().split('T')[0];
startdate.min = '2020-03-25';
startdate.max = enddate.value;
startdate.addEventListener('change', changestartdate, false);

const button_submitdate = document.getElementById('submitdate');
button_submitdate.addEventListener('click', init, false);

function changeenddate() {
    startdate.max = enddate.value;
    return;
}

function changestartdate() {
    enddate.min = startdate.value;
    return;
}

init();