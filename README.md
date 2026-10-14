# TV-Web-Launcher

Beliebige Webseiten als «Apps» auf dem Samsung TV: Adresse in einer Weboberfläche auf dem NAS eintragen, auf dem TV erscheint eine Kachel. Die Webseite öffnet sich im Vollbild und lässt sich mit der Fernbedienung bedienen.

```
Admin-Seite (Browser) ──► sites.json auf dem NAS ──► Kachelseite /tv (TizenBrew-Modul) ──► Webseite + tv.js
```

| Baustein | Ort | Aufgabe |
|---|---|---|
| Web-Launcher-Dienst | Docker-Container auf dem UGREEN-NAS | Admin-Seite, Liste, Kachelseite, TV-Skript |
| TizenBrew | TV (einmalig) | Homebrew-Launcher für Samsung-TVs |
| Modul «Web-Launcher» | GitHub-Repo `tv-web-launcher-module` | öffnet die Kachelseite und führt das TV-Skript in jeder Seite aus |

## Technische Entscheidungen

| Thema | Entscheidung | Grund |
|---|---|---|
| Sprache | Node.js 20, **ohne npm-Abhängigkeiten** | kein Build-Schritt, kleines Image (`node:20-alpine`) |
| Port | `8095` (Variable `PORT`) | Vorgabe |
| Daten | `/data/sites.json`, `/data/icons/` im Volume `/volume1/docker/tv-launcher/data` | übersteht Updates |
| Admin-Schutz | HTTP-Basic-Auth, Passwort aus `ADMIN_PASSWORD` | einfach, funktioniert auf jedem Gerät |
| TV-Seiten | ohne Login | Fernbedienung |
| Code im Container | wird beim Start von GitHub geladen | Update = Container neu starten, kein eigenes Image |
| TizenBrew-Variante | **A** – ein Modul für alle Webseiten | TizenBrew führt das Modul-Skript bei *jedem* neuen JavaScript-Kontext aus (`Runtime.executionContextCreated` in `service-nextgen/service/utils/debugger.js`), also auch nach Wechsel auf fremde Domains |
| tv.js im Modul | `loader.js` **enthält** `tv.js` vollständig | Viele Seiten blockieren das Nachladen von `http://NAS/tv.js` per Content-Security-Policy bzw. Mixed-Content (getestet mit Wikipedia). Per DevTools-Protokoll ausgeführter Code ist davon nicht betroffen |
| Einstellungen pro Seite | Kachelseite übergibt die Liste per `window.name` | `window.name` übersteht den Domainwechsel; Abruf vom NAS wäre auf https-Seiten blockiert |
| User-Agent | nur `navigator.userAgent` (JavaScript) | der HTTP-User-Agent ist im TV-Browser nicht pro Seite umstellbar |

### Ordnerstruktur

```
tv-web-launcher/
├─ src/server.js          HTTP-Dienst + API
├─ public/admin.html      Admin-Oberfläche (handytauglich)
├─ public/tv.html         Kachelseite für den TV (1920×1080)
├─ public/tv.js           Fernbedienungs-Skript
├─ tools/build-module.js  erzeugt ../tv-web-launcher-module (package.json + loader.js)
├─ test/fixture.html      Testseite für die Navigation
├─ sites.example.json     Beispiel-Liste (wird beim ersten Start übernommen)
├─ Dockerfile             klassischer Image-Bau (optional)
└─ docker-compose.yml     Projekt für UGOS Pro
```

## Installation auf dem UGREEN-NAS (UGOS Pro)

1. **Docker** öffnen → **Projekt** → **Erstellen**.
2. Projektname `tv-web-launcher`, Speicherort z. B. `/volume1/docker/tv-launcher`.
3. Inhalt von [`docker-compose.yml`](docker-compose.yml) einfügen und **zwei Werte anpassen**:
   - `ADMIN_PASSWORD` – eigenes Passwort für die Admin-Seite
   - `REPO` – `Schnitzelbrot6969/tv-web-launcher`
4. **Bereitstellen**. Nach ca. 30 Sekunden läuft der Container (Status «Läuft»).
5. Test im Browser: `http://<NAS-IP>:8095/tv` zeigt die Kacheln, `http://<NAS-IP>:8095/admin` fragt nach dem Passwort (Benutzer `admin`).

> Der Container hat `restart: unless-stopped` und startet nach einem NAS-Neustart automatisch.
> Keine Portfreigabe im Router einrichten – der Dienst ist nur fürs Heimnetz gedacht.

### Sonderfall: Zugriff aus einer VM auf demselben NAS
VMs auf dem UGREEN-NAS sind per *MacVTap* angebunden und erreichen die NAS-IP selbst **nicht**. Deshalb hängt der Container zusätzlich per **macvlan** an LAN2 (`eth1`, Brückenmodus) und hat die eigene Adresse **192.168.1.230** – darüber ist die Admin-Seite auch aus der VM erreichbar: `http://192.168.1.230:8095/admin`. Der TV nutzt weiter `http://192.168.1.194:8095/tv` (beides funktioniert im ganzen Heimnetz).

## TizenBrew auf dem TV (Tizen 8, einmalig)

Schritte mit **[Fernbedienung]** macht eine Person am TV (Samsung Smart Remote ohne Zifferntasten), alles andere läuft am PC.

1. **[Fernbedienung]** Home-Taste → **Apps** öffnen.
2. **[Fernbedienung]** Auf der Apps-Seite die Taste **123** (bzw. die Farb-/Zahlen-Taste) drücken → auf der Bildschirm-Zifferntastatur `1 2 3 4 5` eingeben.
3. **[Fernbedienung]** *Developer Mode* auf **On**, bei *Host PC IP* die IP des PCs eintragen, auf dem der TizenBrew Installer läuft → **OK** → TV neu starten (Power-Taste gedrückt halten, bis das Samsung-Logo kommt).
4. Am PC **TizenBrew Installer Desktop** starten (github.com/reisxd/TizenBrewInstaller, Releases), TV-IP eingeben, «Install TizenBrew». Für Tizen 7+ fragt er nach einem Samsung-Konto (Signatur). Am TV die Verbindung ggf. mit **Zulassen** bestätigen.
5. **[Fernbedienung]** TizenBrew öffnen → *Module Manager* → *Add Module* → **GitHub** → `Schnitzelbrot6969/tv`.
6. **[Fernbedienung]** Modul «Web-Launcher» starten → Kachelseite. Optional in TizenBrew *Autolaunch* = Web-Launcher.

## Neue Webseite hinzufügen

1. `http://<NAS-IP>:8095/admin` öffnen, mit `admin` + Passwort anmelden.
2. Name und Adresse eintragen → **Speichern**. Das Icon (Favicon) wird automatisch geholt.
3. Optional unter «Weitere Einstellungen»: Zoom (z. B. 150 %), eigenes CSS (z. B. Cookie-Banner ausblenden), User-Agent, eigene Pfeiltasten-Navigation der Seite.
4. Auf dem TV die Web-Launcher-App öffnen (oder auf der Kachelseite **rote Taste**) → neue Kachel ist da.

Reihenfolge: Pfeil-Buttons oder am ☰ ziehen. Sicherung: «Liste exportieren» / «Liste importieren».

## Fernbedienung

| Taste | Kachelseite | Geöffnete Webseite |
|---|---|---|
| Pfeile | Kachel wählen | Fokus zum nächsten Link/Button/Feld; ohne Ziel → scrollen |
| OK | Webseite öffnen | Element anklicken; Textfeld öffnet die Bildschirmtastatur |
| Zurück | App beenden | Seite zurück; auf der Startseite der App → Kachelseite |
| 2× Zurück (schnell) | – | immer zurück zur Kachelseite |
| Rot (falls vorhanden) | Liste neu laden | immer zurück zur Kachelseite |
| ⏯ ⏩ ⏪ | – | an das Video der Seite (±10 s) |

## Update des Containers

- **Code-Update** (neue Version auf GitHub): in UGOS Docker den Container **neu starten** – der Code wird beim Start frisch geladen.
- **Node-Image aktualisieren**: Projekt stoppen → Image neu ziehen → starten.
- Die Daten (`/volume1/docker/tv-launcher/data`) bleiben in beiden Fällen erhalten.
- **tv.js geändert?** Zusätzlich das Modul neu bauen und pushen:
  ```bash
  NAS_URL=http://192.168.1.194:8095 node tools/build-module.js
  ```
  danach im Modul-Repo committen/pushen und den jsDelivr-Cache leeren: `https://purge.jsdelivr.net/gh/Schnitzelbrot6969/tv@main/loader.js`. Auf dem TV TizenBrew neu starten.

## Lokal entwickeln

```bash
PORT=8095 ADMIN_PASSWORD=test node src/server.js
```
Danach `http://localhost:8095/tv` bzw. `/admin`. Die Beispiel-Liste wird beim ersten Start übernommen.

## Bekannte Grenzen

- Kopiergeschützte Streams (Netflix, Disney+ …) laufen meist nicht → offizielle TV-Apps nutzen.
- Logins per Fernbedienung sind umständlich; die Sitzung bleibt meist per Cookie erhalten.
- Manche Seiten brauchen eigenes CSS/JS, um gut bedienbar zu sein; Seiten mit eigener TV-Steuerung → «Eigene Navigation der Webseite» wählen.
- Nach Werksreset oder manchen Firmware-Updates muss TizenBrew neu installiert werden.
- Nutzungsbedingungen der jeweiligen Webseiten beachten.
