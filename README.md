# 🌿 Raspberry Pi Überwachungssytem für Gartenanlagen und Bungalows

Dieses Projekt hilft Verantwortlichen für Gartenanlagen, ihren Zählerstand und den aktuellen Verbrauch im Blick zu behalten. Es hilft Lecks, die z.B. im Anlagenintenrnem Netz auftreten können frühzeitig zu erkennen
und Gegenmaßnahmen einzuleiten. Es ist modular aufgebaut und läuft auf einem Raspberry Pi.

## 🚀 Die Komponenten

Das System besteht aus mehreren spezialisierten Programmen:

* **ZaehlenD.py**:  Ein Hintergrunddienst (Daemon), der Zählimpulse von S0-Schnittstelle von Wasser- oder Stromzählern via GPIO erfasst und in einer Datenbank speichert.
* **Zaehlerstand**: Ein Kommandozeilen-Tool, um den aktuellen Zählerstand und den gerade aktuellen Verbrauch anzuzeigen.
* **Temperatur**:   Liest Daten von angeschloseenen DS18x20 Sensoren aus und speicher sie in einer Datenbank oder als csv Datei. Schaltet eventuell vorhandene Heizeinrichtungen um im Winter
                    Wasserzähler for dem abfrieren zu schützen. die Heizungen werden in der Datenbank konfiguriert und die Temperaturschwellen in der .credentials.toml 
                    Zeigt Temperaturwerte aller angeschlossenen Sensoren auf der Kommandozeile an.
* **Schalten**:     Steuert Funksteckdosen an, 433Mhz lernfähige oder mit DIP Schaltern sowie Zigbee Schalter. Vorraussetzung für Schaltvorgänge im Programm Temperatur.
                    Vorraussetzung für Zigbee ist Zigbee2MQTT in einem Docker Container
* **server.py**:    Ein Echzeitserver für die grafische Temperaturanzeige, die grafische Bedienung der Funksteckdosen und die Logdaten des ZaehlenD.py Daemons. Läuft als Daemon.

* **www**:          Ein erster Entwurf für eine grafische Oberfläche im Browser.

## 🛠 Installation & Setup

1. Repository klonen oder herunterladen.
2. Abhängigkeiten installieren: `pip install RPi.GPIO mysql-connector-python toml`
3. Eine `.credentials.toml` mit den Datenbank-Zugangsdaten im Home-Verzeichnis anlegen (wird von Git ignoriert).
4. mariadb
5. Kernelmodule für die Temperatusensoren w1-therm und w1-gpio

## 📈 Roadmap / Geplant
- [ ] Fertigstellung der Web-Oberfläche.
- [ ] Alarm-Funktion bei Frostgefahr.
- [ ] Grafische Auswertung der Zählerstände.

---
*Viel Spaß beim Gärtnern und Basteln!*

Stand 03.02.2026