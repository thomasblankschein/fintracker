# Finanzen

Private Finanz-Tracker mit doppelter Buchhaltung, Kontenrahmen, Kategorien, Zahlungsempfängern, CSV-Import und Prognosen für wiederkehrende Zahlungen.

## Starten

```
npm install
npm run dev
```

Öffnet den Server auf http://localhost:3001 und die App auf **http://localhost:5173**. Zusätzlich startet die mobile Erfassung (siehe [iPhone-Erfassung](#iphone-erfassung-bargeld-ausgaben-unterwegs)): API auf Port 3002, Dev-Frontend auf http://localhost:5174.

Die Daten liegen lokal in `data/finanzen.db` (SQLite). Beim ersten Start wird automatisch ein editierbarer Standard-Kontenrahmen angelegt.

Die API-Dokumentation (Swagger UI) läuft unter **http://localhost:3001/api-docs**, die rohe OpenAPI-Spezifikation unter `/api-docs.json`.

**Ausführliches Anwenderhandbuch mit Screenshots:** [ANWENDERHANDBUCH.md](ANWENDERHANDBUCH.md)

## Betrieb mit Docker

Für den dauerhaften Betrieb (z. B. auf einem Heimserver/Proxmox-LXC) gibt es einen einzelnen Container, der API und gebautes Frontend über denselben Port ausliefert:

```bash
docker compose up -d --build
```

Öffnet die App unter **http://localhost:3001** (Port in `docker-compose.yml` anpassbar). Der Container öffnet zusätzlich **Port 3002** für die mobile iPhone-Erfassung (nur dieser gehört ins Internet, siehe unten). Der Container öffnet zusätzlich **Port 3002** für die mobile iPhone-Erfassung (nur dieser gehört ins Internet, siehe unten). Die SQLite-Datenbank liegt im Volume `./data` und übersteht damit Container-Neustarts und -Updates. Kein separater Datenbank-Container nötig — siehe [CLAUDE.md](CLAUDE.md) für die Hintergründe der Deployment-Entscheidungen.

Update auf eine neue Version: `git pull && docker compose up -d --build`.

### Schritt für Schritt: LXC-Container in Proxmox

Empfohlen: **unprivilegierter LXC-Container mit aktiviertem Nesting**, statt einer VM — deutlich weniger Ressourcen-Overhead, und Proxmox' eigenes Backup (`vzdump`) sichert damit automatisch die komplette App inklusive der SQLite-Datei mit.

**1. CT-Template herunterladen** (falls noch nicht vorhanden)

Im Proxmox-Webinterface: Storage (z. B. `local`) → *CT Templates* → *Templates* → `debian-12-standard` suchen und herunterladen.

**2. Container anlegen**

*Create CT* im Webinterface, dabei:

| Feld | Empfehlung |
|---|---|
| Hostname | z. B. `fintracker` |
| Unprivileged container | **angehakt lassen** (Standard, sicherer) |
| Template | Debian 12 |
| Disk | 8 GB |
| Cores | 1–2 |
| Memory | 1024 MB (+ 512 MB Swap) |
| Network | DHCP oder statische IP, Bridge `vmbr0` |

**3. Nesting aktivieren** (Voraussetzung für Docker im Container)

Container auswählen → *Options* → *Features* → *Edit* → Häkchen bei **Nesting** setzen. Alternativ per Shell auf dem Proxmox-Host:

```bash
pct set <CTID> --features nesting=1
```

**4. Container starten und Shell öffnen**

```bash
pct start <CTID>
pct enter <CTID>
```

(Oder Konsole im Webinterface verwenden.)

**5. System vorbereiten**

```bash
apt update && apt upgrade -y
apt install -y ca-certificates curl gnupg git
```

**6. Docker installieren**

```bash
curl -fsSL https://get.docker.com | sh
docker --version
docker compose version
```

**7. Repository klonen**

Das Repository ist öffentlich, kein SSH-Key oder Token nötig:

```bash
cd /opt
git clone https://github.com/thomasblankschein/fintracker.git
cd fintracker
```

**8. App bauen und starten**

```bash
docker compose up -d --build
```

**9. Erreichbarkeit prüfen**

```bash
docker compose ps
docker compose logs -f
ip a          # eigene IP-Adresse des Containers ermitteln
```

Im Browser: `http://<Container-IP>:3001`.

**10. Autostart einrichten** (damit die App einen Proxmox-Host-Neustart überlebt)

```bash
exit          # zurück auf den Proxmox-Host
pct set <CTID> --onboot 1
```

Docker selbst aktiviert seinen Systemdienst beim Installieren automatisch, und `restart: unless-stopped` in `docker-compose.yml` sorgt dafür, dass der Container von selbst wieder hochkommt — zusammen mit *Start at boot* für den LXC-Container läuft die App nach einem Host-Neustart also ohne weiteres Eingreifen wieder an.

**Update später:**

```bash
pct enter <CTID>
cd /opt/fintracker
git pull
docker compose up -d --build
```

**Troubleshooting:**
- *Docker-Befehle scheitern mit einem cgroup-/Namespace-Fehler* → Nesting-Feature (Schritt 3) prüfen, Container danach neu starten.
- *App von anderen Geräten im Netz nicht erreichbar* → Proxmox-Firewall-Regeln für den Container sowie die Bridge-Zuordnung prüfen.
- *`git clone` scheitert mit "Permission denied" oder "Repository not found"* → URL (Schritt 7) und Internetzugang des Containers prüfen.

## iPhone-Erfassung (Bargeld-Ausgaben unterwegs)

Eine kleine Web-App fürs iPhone (PWA), mit der Bargeld-Ausgaben direkt vor Ort erfasst werden: Betrag, Kategorie, optional Notiz, Datum = heute — ein Bildschirm, ein Button. Ohne Netz werden Einträge auf dem Gerät vorgemerkt und später automatisch (ohne Duplikate) gesendet. Zuletzt erfasste Einträge lassen sich innerhalb von 24 Stunden rückgängig machen. Bedienung: [Anwenderhandbuch 3.9](ANWENDERHANDBUCH.md#39-iphone-erfassung-bargeld-unterwegs).

**Warum ein eigener Port?** Die Hauptapp (Port 3001) hat bewusst keine Anmeldung und ein offenes CORS — sie darf nie direkt aus dem Internet erreichbar sein. Die Erfassung läuft deshalb in einem **zweiten, minimalen Listener (Port 3002)** im selben Prozess. Er liefert nur die mobile App und `/api/m/*`; Konten, Buchungen, Auswertungen oder `/api-docs` gibt es dort nicht (404). **Nur Port 3002 wird in Pangolin veröffentlicht.**

**Absicherung**
- **Gerätetoken statt Passwort:** Jedes iPhone wird einmalig mit einem 8-stelligen Kopplungscode (10 Min gültig, einmalig) gekoppelt und erhält ein zufälliges Token (256 Bit). In der Datenbank steht nur dessen SHA-256-Hash. Es gibt keine Geheimnisse in URLs.
- **Feste Rechte pro Gerät:** Ein Gerät bucht immer nur *Ausgabe-Kategorie ↔ sein festes Bargeldkonto* und sieht keine Salden. Das Konto bestimmt der Server, nie die App.
- **Begrenzungen:** Rate-Limits (fehlgeschlagene Anmeldungen und Kopplungsversuche, Schreibzugriffe pro Gerät), Betrag max. 10.000 €, Notiz max. 120 Zeichen, Datum höchstens 31 Tage zurück, JSON-Body max. 8 kB.
- **Härtung:** strikte Content-Security-Policy, `no-store` für die API, kein CORS, keine Token/Beträge im Log.
- **Widerruf:** Einstellungen → *Mobile Geräte* → *Widerrufen* — wirkt sofort (verlorenes iPhone).

**Einrichtung**
1. In Pangolin eine **Site** mit Newt im LAN anlegen (falls noch nicht vorhanden).
2. Eine **HTTP-Resource** mit eigener (Sub-)Domain anlegen, Target `http://<Host-der-App>:3002` (Host = LXC-IP bzw. Docker-Host). Die Pangolin-eigene Anmeldung für diese Resource **ausschalten**: die App authentifiziert selbst per Gerätetoken (die Login-Seite von Pangolin würde in einer installierten Home-Bildschirm-App stören). Optional in Pangolin Geoblocking/Regeln ergänzen (z. B. nur Deutschland).
3. Nach `docker compose up -d --build` prüfen: `curl -i https://<deine-domain>/api/m/bootstrap` muss `401` liefern, `https://<deine-domain>/api/accounts` muss `404` liefern.
4. Damit die Rate-Limits hinter Pangolin die echte Client-IP sehen: in `docker-compose.yml` `TRUST_PROXY=1` setzen — **erst nachdem** geprüft ist, dass Pangolin `X-Forwarded-For` mitschickt (sonst ließe sich die IP fälschen). Optional `MOBILE_ALLOWED_HOST=<deine-domain>` für eine zusätzliche Host-Header-Prüfung. `MOBILE_PORT=0` schaltet die mobile Erfassung komplett ab.
5. In der Desktop-App: **Einstellungen → Mobile Geräte → Gerät hinzufügen** (Name + Bargeldkonto), Code notieren.
6. Auf dem iPhone die Adresse in **Safari** öffnen → *Teilen → Zum Home-Bildschirm* → die App vom Home-Bildschirm starten → Code eintippen. (Die Kopplung muss in der installierten App erfolgen, nicht in Safari: iOS trennt deren Speicher.)

**Mit dem echten iPhone prüfen** (lässt sich nicht automatisiert testen): HTTPS-Aufruf von außen funktioniert · Kopplung in der Home-Bildschirm-App klappt · Token bleibt nach App-Neustart erhalten · Flugmodus → Eintrag erfassen → Flugmodus aus → Eintrag erscheint in der Desktop-App (genau einmal) · Widerruf in den Einstellungen sperrt das Gerät sofort.

> **Hinweis:** Die Hauptapp auf Port 3001 ist weiterhin unauthentifiziert (siehe [CLAUDE.md](CLAUDE.md), Entscheidungslog). Nur im vertrauenswürdigen LAN betreiben, Port 3001 nicht in Pangolin eintragen und in der Proxmox-Firewall nicht aus dem Internet freigeben.

## Konzept

- **Konten** = Kontenrahmen (Aktiva, Passiva, Eigenkapital, Erträge, Aufwendungen), beliebig tief verschachtelbar (z. B. Aufwendungen > Freizeit & Hobby > Urlaube & Trips). Kategorien sind schlicht Konten vom Typ Erträge/Aufwendungen. Konten lassen sich umbenennen, verschieben (anderes übergeordnetes Konto), mit einem untergeordneten Konto ergänzen und (de)aktivieren. Der Kontenrahmen lässt sich als JSON-Datei exportieren und (per Merge, ohne bestehende Konten zu überschreiben) wieder importieren.
- **Buchungen** bestehen aus mind. 2 Buchungszeilen, deren Beträge sich zu 0 summieren müssen (doppelte Buchhaltung). Vorzeichen: positiv = Geld fließt ins Konto, negativ = Geld fließt heraus. Die Buchungsübersicht lässt sich nach Datum, Zahlungsempfänger, Konto (inkl. Unterkonten) und Beschreibung filtern (auch kombiniert) und bei gesetztem Konto-Filter als CSV exportieren (nur der Anteil des gefilterten Kontos je Buchung, Gegenkonten als Kontext-Spalte).
- **Wiederkehrende Zahlungen** werden auf der Dashboard-Seite in die Zukunft extrapoliert (Prognose) und können mit "Jetzt buchen" als echte Buchung übernommen werden.
- **Auswertungen** nach Kategorie und Zahlungsempfänger, mit Rollup über verschachtelte Kategorie-Ebenen (eine Oberkategorie zeigt die Summe aller Unterkategorien). Zusätzlich die **Geldverwendung** — eine Geldflussrechnung über eine wählbare Gruppe liquider Konten, die alle Abflüsse in Konsum, Vermögensbildung und Schuldentilgung aufteilt (die Kontenauswahl lässt sich als benannte Konfiguration speichern und laden).
- **CSV-Import**: Datei hochladen, Spalten zuordnen (inkl. konfigurierbarer Kopfzeile für Exporte mit Metadaten-Vorspann und Umbuchungen zwischen echten Konten, z. B. Kreditkarten-Ausgleich), Kategorien prüfen/anpassen (Vorschläge basieren auf bisherigen Zahlungsempfänger-Zuordnungen oder ähnlichen früheren Buchungen, Duplikate werden automatisch markiert), Positionen bei Bedarf auf mehrere Gegenkonten aufteilen (Split), Zeilen anhand von Regex-Suchmustern gezielt ignorieren oder einzeln dauerhaft ausschließen (beim erneuten Import derselben Datei erscheinen sie dann automatisch als "ausgeschlossen"), importieren. Spaltenzuordnungen (inkl. Suchmuster) lassen sich als Vorlage speichern und wiederverwenden.
- **iPhone-Erfassung**: separate, minimale PWA (Port 3002, eigener Listener) zum Erfassen von Bargeld-Ausgaben vor Ort. Authentifizierung per gerätegebundenem Token (Kopplung über einen einmaligen Code), jedes Gerät bucht nur auf sein festes Konto; Offline-Warteschlange mit Duplikatschutz. Verwaltung (Geräte koppeln/widerrufen) unter Einstellungen → Mobile Geräte.
