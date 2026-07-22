# Finanzen

Private Finanz-Tracker mit doppelter Buchhaltung, Kontenrahmen, Kategorien, Zahlungsempfängern, CSV-Import und Prognosen für wiederkehrende Zahlungen.

## Starten

```
npm install
npm run dev
```

Öffnet den Server auf http://localhost:3001 und die App auf **http://localhost:5173**.

Die Daten liegen lokal in `data/finanzen.db` (SQLite). Beim ersten Start wird automatisch ein editierbarer Standard-Kontenrahmen angelegt.

Die API-Dokumentation (Swagger UI) läuft unter **http://localhost:3001/api-docs**, die rohe OpenAPI-Spezifikation unter `/api-docs.json`.

**Ausführliches Anwenderhandbuch mit Screenshots:** [ANWENDERHANDBUCH.md](ANWENDERHANDBUCH.md)

## Betrieb mit Docker

Für den dauerhaften Betrieb (z. B. auf einem Heimserver/Proxmox-LXC) gibt es einen einzelnen Container, der API und gebautes Frontend über denselben Port ausliefert:

```bash
docker compose up -d --build
```

Öffnet die App unter **http://localhost:3001** (Port in `docker-compose.yml` anpassbar). Die SQLite-Datenbank liegt im Volume `./data` und übersteht damit Container-Neustarts und -Updates. Kein separater Datenbank-Container nötig — siehe [CLAUDE.md](CLAUDE.md) für die Hintergründe der Deployment-Entscheidungen.

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

Das Repository ist **privat** — für den Zugriff per SSH-Deploy-Key (read-only, an dieses eine Repo gebunden):

```bash
ssh-keygen -t ed25519 -C "fintracker-lxc" -f ~/.ssh/id_ed25519 -N ""
cat ~/.ssh/id_ed25519.pub
```

Den ausgegebenen öffentlichen Schlüssel auf GitHub unter *Repository → Settings → Deploy keys → Add deploy key* eintragen (Schreibzugriff **nicht** nötig). Danach:

```bash
cd /opt
git clone git@github.com:thomasblankschein/fintracker.git
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
- *`git clone` scheitert mit "Permission denied" oder "Repository not found"* → Deploy-Key-Eintrag auf GitHub und den lokalen SSH-Key (Schritt 7) gegenprüfen.

## Konzept

- **Konten** = Kontenrahmen (Aktiva, Passiva, Eigenkapital, Erträge, Aufwendungen), beliebig tief verschachtelbar (z. B. Aufwendungen > Freizeit & Hobby > Urlaube & Trips). Kategorien sind schlicht Konten vom Typ Erträge/Aufwendungen. Der Kontenrahmen lässt sich als JSON-Datei exportieren und (per Merge, ohne bestehende Konten zu überschreiben) wieder importieren.
- **Buchungen** bestehen aus mind. 2 Buchungszeilen, deren Beträge sich zu 0 summieren müssen (doppelte Buchhaltung). Vorzeichen: positiv = Geld fließt ins Konto, negativ = Geld fließt heraus. Die Buchungsübersicht lässt sich nach Datum, Zahlungsempfänger, Konto (inkl. Unterkonten) und Beschreibung filtern (auch kombiniert).
- **Wiederkehrende Zahlungen** werden auf der Dashboard-Seite in die Zukunft extrapoliert (Prognose) und können mit "Jetzt buchen" als echte Buchung übernommen werden.
- **Auswertungen** nach Kategorie und Zahlungsempfänger, mit Rollup über verschachtelte Kategorie-Ebenen (eine Oberkategorie zeigt die Summe aller Unterkategorien).
- **CSV-Import**: Datei hochladen, Spalten zuordnen (inkl. Umbuchungen zwischen echten Konten, z. B. Kreditkarten-Ausgleich), Kategorien prüfen/anpassen (Vorschläge basieren auf bisherigen Zahlungsempfänger-Zuordnungen, Duplikate werden automatisch markiert), importieren. Spaltenzuordnungen lassen sich als Vorlage speichern und wiederverwenden.
