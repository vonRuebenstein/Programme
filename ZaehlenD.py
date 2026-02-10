#!/usr/bin/python3
# -*- coding: utf-8 -*-

"""
ZaehlenD.py - Raspberry Pi GPIO Impulszähler Daemon (High-Performance Version)

Funktionen:
- Asynchrones Logging über UDP (Netlog-kompatibel) und Konsole.
- Volle Entkopplung: ISR -> Queue -> Worker-Thread -> MariaDB.
- Fehlertolerantes Loglevel-Handling (Fallback auf INFO bei Tippfehlern).
- Lokale Pufferung bei Datenbankausfall in JSON-Datei.
- Dynamischer Reload der Konfiguration im laufenden Betrieb via SIGHUP.
"""

import signal
import sys
import time
import threading
import queue
import logging
import logging.handlers
import mysql.connector
import RPi.GPIO as GPIO
import toml
import json
from pathlib import Path

# --- Konfiguration & Pfade ---
CREDENTIALS_FILE = Path.home() / ".credentials.toml"
# Verzeichnis für Pufferdatei ggf. anpassen oder erstellen
PULSE_BUFFER_FILE = Path("/var/lib/zaehlend/pulse_buffer.json")

# --- Logging System (Asynchron) ---

class PlainTextUDPHandler(logging.handlers.DatagramHandler):
    """Sendet rohen Text über UDP, um kompatibel mit NetLog zu bleiben."""
    def makePickle(self, record):
        return self.format(record).encode('utf-8')

def setup_async_logging(config):
    """Initialisiert das Logging mit Fallback-Schutz und Hintergrund-Thread."""
    level_str = config.get("log_level", "INFO").upper()
    level = getattr(logging, level_str, None)
    
    fallback_active = False
    if not isinstance(level, int):
        level = logging.INFO
        fallback_active = True

    log_queue = queue.Queue(-1)
    formatter = logging.Formatter('%(asctime)s [%(levelname)s]: %(message)s', 
                                  datefmt='%d.%m.%Y %H:%M:%S')

    handlers = []
    # UDP/Netlog Handler
    if "log_ip" in config and "log_port" in config:
        udp_h = PlainTextUDPHandler(config["log_ip"], config["log_port"])
        udp_h.setFormatter(formatter)
        handlers.append(udp_h)

    # Konsolen Handler (für Journald)
    console_h = logging.StreamHandler()
    console_h.setFormatter(formatter)
    handlers.append(console_h)

    # Der Listener verarbeitet die Logs im Hintergrund
    listener = logging.handlers.QueueListener(log_queue, *handlers)
    listener.start()

    root = logging.getLogger()
    root.setLevel(level)
    root.handlers = []
    root.addHandler(logging.handlers.QueueHandler(log_queue))

    if fallback_active:
        logging.warning(f"Loglevel '{level_str}' ungültig. Fallback auf INFO.")
    
    return listener

# --- Datenbank & Puffer Logik ---

class MariaDBManager:
    """Verwaltet DB-Verbindung, Heartbeats und den lokalen Datei-Puffer."""
    def __init__(self, config, buffer_file):
        self.config = config
        self.buffer_file = buffer_file
        self.conn = None
        self.last_heartbeat = time.time()

    def _ensure_connection(self):
        """Hält die Verbindung zur MariaDB stabil."""
        if self.conn and (time.time() - self.last_heartbeat) > 300:
            try:
                self.conn.ping(reconnect=True)
                self.last_heartbeat = time.time()
            except: 
                self.conn = None

        if self.conn is None or not self.conn.is_connected():
            try:
                self.conn = mysql.connector.connect(
                    host=self.config["db_host"],
                    user=self.config["db_user"],
                    passwd=self.config["db_pwd"],
                    db=self.config["db_name"]
                )
                return True
            except Exception as e:
                logging.error(f"Datenbankfehler: {e}")
                return False
        return True

    def write_batch(self, batch):
        """Schreibt Daten in DB oder puffert sie bei Ausfall lokal."""
        if self._ensure_connection():
            try:
                cursor = self.conn.cursor()
                sql = "INSERT INTO Bungalow.Zaehlerwerte(Zeitstempel, Zaehler_ID) VALUES (%s, %s)"
                cursor.executemany(sql, batch)
                self.conn.commit()
                cursor.close()
                logging.info(f"DB: {len(batch)} Datensätze übertragen.")
                self._process_file_buffer()
                return
            except Exception as e:
                logging.error(f"Schreibfehler DB: {e}")

        # Pufferung falls DB-Schreiben fehlschlägt
        self._buffer_to_file(batch)

    def _buffer_to_file(self, batch):
        """Hängt Daten bei DB-Ausfall an die Pufferdatei an."""
        try:
            with open(self.buffer_file, 'a') as f:
                for ts, cid in batch:
                    f.write(json.dumps({'t': ts, 'id': cid}) + '\n')
            logging.warning(f"Puffer: {len(batch)} Einträge lokal gesichert.")
        except Exception as e:
            logging.critical(f"Kritischer Pufferfehler: {e}")

    def _process_file_buffer(self):
        """Trägt gepufferte Daten nach, sobald die DB wieder bereit ist."""
        if not self.buffer_file.exists(): return
        try:
            data = []
            with open(self.buffer_file, 'r') as f:
                for line in f:
                    rec = json.loads(line)
                    data.append((rec['t'], rec['id']))
            
            if data:
                cursor = self.conn.cursor()
                cursor.executemany("INSERT INTO Bungalow.Zaehlerwerte(Zeitstempel, Zaehler_ID) VALUES (%s, %s)", data)
                self.conn.commit()
                cursor.close()
                self.buffer_file.unlink() # Puffer nach Erfolg löschen
                logging.info(f"Nachtrag: {len(data)} gepufferte Daten verarbeitet.")
        except Exception as e:
            logging.error(f"Fehler beim Nachtragen des Puffers: {e}")

    def get_configs(self):
        """Lädt die aktuelle Zählerkonfiguration aus der Datenbank."""
        if not self._ensure_connection(): return []
        try:
            cursor = self.conn.cursor(dictionary=True)
            cursor.execute("SELECT BCMPin, BounceTime, PullUpDown, ID, Divider FROM Bungalow.Zaehler WHERE Bezeichnung > ''")
            res = cursor.fetchall()
            cursor.close()
            return res
        except Exception as e:
            logging.error(f"Fehler beim Laden der Zähler-Konfig: {e}")
            return []

# --- Hauptklasse Daemon ---

class ZaehlerDaemon:
    def __init__(self):
        self.stop_event = threading.Event()
        self.pulse_queue = queue.Queue(maxsize=100000)
        
        # Initialer Load der Config-Datei
        try:
            full_toml = toml.load(CREDENTIALS_FILE)
            self.config = full_toml["zaehlen"]
        except Exception as e:
            print(f"Fehler beim Laden der .toml: {e}")
            sys.exit(1)

        self.log_listener = setup_async_logging(self.config)
        self.db_manager = MariaDBManager(self.config, PULSE_BUFFER_FILE)
        
        self.gpio_map = {}
        self.divider_map = {}
        self.pulse_counts = {}

    def _pulse_isr(self, channel):
        """Leichte ISR: Loggt jeden Impuls (Debug) und prüft Teiler (Info)."""
        try:
            cid = self.gpio_map.get(channel)
            if cid is None: return

            logging.debug(f"Puls an Pin {channel} (ID {cid})")

            self.pulse_counts[cid] += 1
            if self.pulse_counts[cid] >= self.divider_map.get(cid, 1):
                self.pulse_counts[cid] = 0
                logging.info(f"Teiler voll für ID {cid}")
                self.pulse_queue.put_nowait((time.time(), cid))
        except queue.Full:
            pass # Notfall: Queue voll

    def reload_config(self, signum=None, frame=None):
        """Aktualisiert die Zählerkonfiguration im laufenden Betrieb (SIGHUP)."""
        logging.info("RELOAD: Starte Neukonfiguration...")
        try:
            new_configs = self.db_manager.get_configs()
            if not new_configs: return

            # Alle Interrupts stoppen bevor neu gemappt wird
            for pin in list(self.gpio_map.keys()):
                try: GPIO.remove_event_detect(pin)
                except: pass

            new_gpio_map, new_divider_map, active_ids = {}, {}, set()

            for cfg in new_configs:
                pin, cid = cfg['BCMPin'], cfg['ID']
                active_ids.add(cid)
                pud = GPIO.PUD_UP if cfg['PullUpDown'] == 'PUD_UP' else GPIO.PUD_DOWN
                
                GPIO.setup(pin, GPIO.IN, pull_up_down=pud)
                GPIO.add_event_detect(pin, GPIO.FALLING, callback=self._pulse_isr, bouncetime=cfg['BounceTime'])
                
                new_gpio_map[pin] = cid
                new_divider_map[cid] = cfg['Divider'] or 1
                
                if cid not in self.pulse_counts:
                    self.pulse_counts[cid] = 0
                    logging.info(f"RELOAD: Zähler ID {cid} neu hinzugefügt.")
            
            # Gelöschte Zähler entfernen
            for old_id in (set(self.pulse_counts.keys()) - active_ids):
                del self.pulse_counts[old_id]
                logging.info(f"RELOAD: Zähler ID {old_id} entfernt.")

            self.gpio_map, self.divider_map = new_gpio_map, new_divider_map
            logging.info("RELOAD: Konfiguration erfolgreich aktualisiert.")
        except Exception as e:
            logging.error(f"RELOAD fehlgeschlagen: {e}")

    def _worker_loop(self):
        """Sammelt Impulse und schreibt sie blockweise in die DB."""
        batch = []
        last_flush = time.time()
        max_batch = self.config.get("pulse_batch_size", 40)
        max_wait = self.config.get("pulse_batch_timeout_seconds", 60)

        while not self.stop_event.is_set():
            try:
                item = self.pulse_queue.get(timeout=1.0)
                batch.append(item)
            except queue.Empty: pass

            if batch and (len(batch) >= max_batch or (time.time() - last_flush) > max_wait):
                self.db_manager.write_batch(batch)
                batch, last_flush = [], time.time()

    def start(self):
        """Initialisierung der Hardware und Start der Threads."""
        GPIO.setmode(GPIO.BCM)
        self.reload_config() # Nutzt die Reload-Logik für den Erststart
        
        threading.Thread(target=self._worker_loop, daemon=True).start()
        logging.info("Daemon bereit und wartet auf Impulse.")
        
        while not self.stop_event.is_set():
            time.sleep(1)

    def stop(self, signum, frame):
        """Sauberes Beenden bei SIGTERM/SIGINT."""
        logging.info(f"Beenden durch Signal {signum}...")
        self.stop_event.set()
        GPIO.cleanup()
        self.log_listener.stop()
        sys.exit(0)

if __name__ == '__main__':
    daemon = ZaehlerDaemon()
    
    # Signal-Registrierung
    signal.signal(signal.SIGTERM, daemon.stop)
    signal.signal(signal.SIGINT, daemon.stop)
    signal.signal(signal.SIGHUP, daemon.reload_config) # Reload Signal
    
    daemon.start()