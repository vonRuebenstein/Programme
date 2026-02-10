<?php
    // Fehlerberichterstattung und Logging
    error_reporting(E_ALL);
    ini_set('display_errors', 0); // Fehler nicht im Browser anzeigen
    ini_set('log_errors', 1);     // Fehler ins Log schreiben
    ini_set('error_log', '/var/log/php_errors.log'); // Pfad zur PHP-Fehlerlogdatei

    require_once __DIR__ . '/../../scripts/vendor/autoload.php';
    use Yosymfony\Toml\Toml;

    // Pfad zur TOML-Datei für Anmeldeinformationen
    $credentials_file = '/home/pi/.credentials.toml';

    // Datenbank-Anmeldeinformationen aus der TOML-Datei laden
    $db_host = '';
    $db_user = '';
    $db_pwd = '';
    $db_name = '';

    // Verbindung zum Datenbankserver
    //$db_host = "localhost";
    //$db_user = "temp";
    //$db_pwd = "24021965{temp}";
    //$db_name = "Bungalow";

    try {
        if (!file_exists($credentials_file)) {
            throw new Exception("Die Anmeldeinformationsdatei '$credentials_file' wurde nicht gefunden.");
        }
        if (!is_readable($credentials_file)) {
            throw new Exception("Keine Leserechte für die Anmeldeinformationsdatei '$credentials_file'.");
        }

        $config = Toml::parseFile($credentials_file);

        // Annahme: Die Datenbank-Anmeldeinformationen für PHP sind im [temperatur]-Abschnitt der TOML-Datei
        // Oder du definierst einen neuen Abschnitt speziell für PHP, z.B. [php_db_access]
        if (isset($config['temperatur'])) {
            //$db_host = $config['temperatur']['db_host'] ?? '';
            $db_host = $config['temperatur']['db_host'] ?? '';
            $db_user = $config['temperatur']['db_user'] ?? '';
            $db_pwd = $config['temperatur']['db_pwd'] ?? '';
            $db_name = $config['temperatur']['db_name'] ?? '';
        } else {
            throw new Exception("Der Abschnitt '[temperatur]' oder der benötigte Datenbankabschnitt wurde in der TOML-Datei nicht gefunden.");
        }

        if (empty($db_host) || empty($db_user) || empty($db_pwd) || empty($db_name)) {
            throw new Exception("Unvollständige Datenbank-Anmeldeinformationen in der TOML-Datei.");
        }

    } catch (Exception $e) {
        error_log('Fehler beim Laden der Anmeldeinformationen: ' . $e->getMessage());
        http_response_code(500);
        echo json_encode(["status" => "error", "message" => "Interner Serverfehler: Konfigurationsproblem. Details im Fehlerlog."]);
        exit;
    }


    if (!function_exists('mysqli_init') && !extension_loaded('mysqli')) {
        echo '<div id = "Stats">Die MySQLi-Erweiterung ist nicht installiert!</div>';
    }
    else {
        //echo json_encode ('<div id = "Stats">Die MySQLi-Erweiterung ist verfügbar.</div>');

        //echo '<div id="meinDiv">' . $meinText . '</div>';

        $conn = new mysqli($db_host, $db_user, $db_pwd, $db_name);

        if ($conn->connect_error) {
            die('Connection failed: ' . $conn->connect_error);
        }
        else {
           
            if ($_SERVER['REQUEST_METHOD'] === 'POST') {
                
                $Bungalow = trim($_POST['Bungalow']);
                $Startdatum = trim($_POST['Startdatum']);
                $Enddatum = trim($_POST['Enddatum']);
                $Offset = trim($_POST['Offset']);
                $Chunk_Size = trim($_POST['Chunk_Size']);
                $Total_Chunks = trim($_POST['Total_Chunks']);
  
                if ($Offset == 0) {
                    $stmt = $conn->prepare("CALL Bungalow.proc_Temperatur_Master_CountLines (?, ?, ?)");
                    $stmt->bind_param("sss", $Bungalow, $Startdatum, $Enddatum);
                    $stmt->execute();
                    $result = $stmt->get_result();

                    if ($result instanceof mysqli_result) {
                        $row = $result->fetch_assoc();
                        $Total_Chunks = ceil($row['Anzahl'] / $Chunk_Size);
                        header ('X-Total-Chunks: ' .$Total_Chunks);
                    }
                    $stmt->close();
                }
            
                
                
                
                $stmt = $conn->prepare("CALL Bungalow.proc_Temperatur_Master (?, ?, ?, ?, ?)");
                $stmt->bind_param("sssii", $Bungalow, $Startdatum, $Enddatum, $Offset, $Chunk_Size);
                $stmt->execute();
                $result = $stmt->get_result();

                $data = [];  
                if ($result instanceof mysqli_result) {
                    while($row = $result->fetch_assoc()) {
                        $data[] = $row;
                    }
        
                    $Chunk_Num = ($Offset / $Chunk_Size) +1 ; 
                    header ('Content-Encoding: gzip');  
                    header ('Content-Type: application/json');
                    header ('X-Chunk-Number: ' . $Chunk_Num);
                    //header ('X-Total-Chunks: ' .ceil(count($result) / $Chunk_Size));                  
                //    header ('X-Total-Chunks: ' .$lines);
                    if ($Chunk_Num == $Total_Chunks) {
                        header ('X-Last-Chunk: true');
                    }
                    else {
                        header ('X-Last-Chunk: false');
                    }
                    echo (gzencode(json_encode($data)));
                    flush ();                        
                }
                
                $stmt->close();
                
                //else {
                  //  echo json_encode(["status" => "success", "message" => "stmt->error"]);
                //}
            } 
        }
        $conn->close(); 
    }  
?>