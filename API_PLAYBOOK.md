# API-Playbook

Praxisorientierte Anleitung für alle, die direkt gegen die Finanzen-API sprechen (Skripte, Automatisierungen, eigene Clients). Für das vollständige, formale Referenzblatt aller Endpunkte siehe die interaktive Swagger-UI unter `http://localhost:3001/api-docs` (Spezifikation: [server/openapi.yaml](server/openapi.yaml)). Für das Tabellenschema siehe [DATENMODELL.md](DATENMODELL.md).

- **Base-URL:** `http://localhost:3001/api`
- **Auth:** keine — lokales Single-User-Tool
- **Format:** JSON (`Content-Type: application/json`), Fehler immer als `{"error": "Lesbare Meldung"}` mit Status 400/404/500
- **Geld:** immer Integer-**Cent** (nie Float), z. B. 12,50 € = `1250`
- **Version:** `GET /api/info` → `{"version": "0.20.0"}`, zur Laufzeit aus `server/package.json` gelesen

## 1. Das Grundprinzip verstehen, bevor du buchst

Jede Buchung (`transaction`) besteht aus ≥2 Buchungszeilen (`postings`), deren `amountCents` sich **exakt zu 0 summieren müssen**. Das ist die doppelte Buchhaltung des Systems — die API lehnt jede Buchung ab, die nicht ausgeglichen ist.

Vorzeichen-Konvention pro Buchungszeile: **positiv = Geld fließt in das Konto, negativ = Geld fließt heraus.**

| Kontotyp | Vorzeichen bei Zunahme |
|---|---|
| `asset`, `expense` | positiv |
| `liability`, `income`, `equity` | negativ |

Konten vom Typ `expense`/`income` sind zugleich die **Kategorien** — es gibt keine eigene Kategorie-Ressource. Wer nach Kategorien filtern will, filtert nach diesen Konten.

## 2. Kontenrahmen (`/accounts`)

```bash
GET /api/accounts          # Baum inkl. Saldo pro Konto (rollup über Unterkonten)
GET /api/accounts/flat     # flache Liste aktiver Konten — praktisch für Auswahlfelder
POST /api/accounts         # {name, type, parentId?}
PATCH /api/accounts/{id}   # {name?, parentId?, isActive?}
DELETE /api/accounts/{id}  # nur ohne Buchungen/Unterkonten, sonst isActive:false setzen
```

Beim Ändern von `parentId` (Konto verschieben) prüft der Server zwei Dinge und antwortet sonst mit 400: das Zielkonto darf nicht das Konto selbst oder einer seiner eigenen Nachfahren sein (sonst Zyklus in der Baum-Traversierung), und es muss denselben Kontotyp haben wie das verschobene Konto (sonst würden Salden typübergreifend und damit inhaltlich sinnlos aufsummiert).

Beispielausschnitt aus `GET /accounts`:

```json
{
  "id": 2, "name": "Girokonto", "type": "asset", "parentId": 1,
  "isActive": true, "ownBalance": 105000, "balance": 105000, "children": []
}
```

`ownBalance` = Summe der eigenen Buchungszeilen, `balance` = inklusive aller Unterkonten (relevant nur für Gruppenknoten wie "Aktiva").

**Kontenrahmen als Datei sichern/übertragen:**

```bash
GET /api/accounts/export     # portable JSON-Baumstruktur, ohne IDs/Salden
POST /api/accounts/import    # {name, type, isActive?, children?}[] — dieselbe Struktur
```

```json
[
  { "name": "Aktiva", "type": "asset", "isActive": true, "children": [
    { "name": "Girokonto", "type": "asset", "isActive": true, "children": [] }
  ]}
]
```

Der Import ist ein **Merge, kein Ersetzen**: Ein Knoten wird über `(name, type, Elternknoten)` einem vorhandenen Konto zugeordnet — passt das Tripel, wird nur `isActive` ggf. nachgezogen; sonst wird das Konto neu angelegt. Vorhandene Konten mit Buchungen werden nie gelöscht (das lässt das Schema ohnehin nicht zu, siehe `DELETE /accounts/{id}`). Ein zweimaliger Import derselben Datei ist damit ungefährlich (idempotent) — praktisch für Backups oder um einen Kontenrahmen-Vorschlag mit dem eigenen zu mergen.

## 3. Zahlungsempfänger (`/payees`)

```bash
GET /api/payees      # inkl. expenseTotal (Cent) und transactionCount je Empfänger
POST /api/payees      # {name}
DELETE /api/payees/{id}   # nur wenn in keiner Buchung mehr referenziert
```

Du musst Zahlungsempfänger meist gar nicht separat anlegen: `POST /transactions` mit `payeeName` statt `payeeId` legt bei Bedarf automatisch einen neuen Payee an (Find-or-Create).

## 4. Buchungen erfassen (`/transactions`)

**Einfache Ausgabe** (Wocheneinkauf, 45,90 € vom Girokonto auf die Kategorie Lebensmittel):

```bash
curl -X POST http://localhost:3001/api/transactions \
  -H "Content-Type: application/json" \
  -d '{
    "date": "2026-07-15",
    "description": "Wocheneinkauf",
    "payeeName": "REWE",
    "postings": [
      { "accountId": 14, "amountCents": 4590 },
      { "accountId": 2,  "amountCents": -4590 }
    ]
  }'
```

Kategorie (Lebensmittel, id 14) bekommt das **positive** Vorzeichen (Ausgabe erhöht die Kategorie), das Girokonto (id 2) das **negative** (Geld fließt ab). Summe: `4590 + (-4590) = 0`. ✓

**Einnahme** (Gehalt, 2.800 €) läuft spiegelverkehrt — die Einkommens-Kategorie bekommt das negative Vorzeichen:

```json
{
  "date": "2026-07-05", "description": "Gehalt Juli", "payeeName": "Arbeitgeber GmbH",
  "postings": [
    { "accountId": 2,  "amountCents": 280000 },
    { "accountId": 10, "amountCents": -280000 }
  ]
}
```

**Split-Buchung** (eine Zahlung, mehrere Kategorien — z. B. Supermarkt-Einkauf mit Non-Food-Anteil): einfach mehr als zwei `postings` übergeben, solange die Summe 0 bleibt. Es gibt kein Limit auf die Anzahl der Zeilen.

**Filtern & Suchen:**

```bash
GET /api/transactions?account=2&from=2026-07-01&to=2026-07-31
GET /api/transactions?payee=3
GET /api/transactions?description=Tanken   # Volltextsuche (LIKE, ohne Case-Sensitivity)
```

Alle Filter sind kombinierbar (UND-Verknüpfung). `account` schließt **Unterkonten rekursiv mit ein** — filterst du auf "Freizeit & Hobby", bekommst du auch Buchungen auf einem tiefer verschachtelten "Wochenendreisen" darunter (Kontenrahmen sind beliebig tief schachtelbar, siehe Abschnitt 2). `PATCH /transactions/{id}` und `DELETE /transactions/{id}` funktionieren wie erwartet; beim `PATCH` mit `postings` werden **alle** bisherigen Zeilen ersetzt, nicht gemergt.

**Saldo vor/nach einem Zeitraum** (`GET /transactions/balance?account=2&from=2026-07-01&to=2026-07-31`, `account` Pflicht) — für den Abgleich mit Kontoauszügen, die üblicherweise "Alter Kontostand"/"Neuer Kontostand" ausweisen: `{startBalance, endBalance}` in Cent. `endBalance` = Summe aller Postings bis einschließlich `to` (ohne `to`: aktueller Saldo). `startBalance` = Summe aller Postings vor `from` (ohne `from`: `0`, es gibt dann keinen "Vorzeitraum"). `endBalance - startBalance` ergibt automatisch die Summe der im selben Zeitraum gefilterten Buchungen. Schließt wie beim `account`-Filter oben Unterkonten rekursiv ein.

## 5. Wiederkehrende Zahlungen (`/recurring`)

Eine Vorlage ist strukturell wie eine einfache 2-Zeilen-Buchung, nur mit Wiederholungsregel statt festem Datum:

```json
{
  "name": "Miete",
  "fromAccountId": 2,
  "toAccountId": 13,
  "amountCents": 85000,
  "interval": "monthly",
  "intervalDay": 20,
  "startDate": "2026-07-20"
}
```

`intervalDay` hängt vom `interval` ab: bei `weekly` der Wochentag (`0`=So … `6`=Sa), bei `monthly` der Tag im Monat (1–28, wird bei 29–31 auf 28 gekappt), bei `yearly` der Tag im Jahr (1–365).

```bash
GET /api/recurring                 # inkl. berechnetem nextDueDate
POST /api/recurring/{id}/book      # verbucht die nächste fällige Zahlung als echte Transaction
PATCH /api/recurring/{id}          # z.B. {"active": false} zum Pausieren
```

`last_booked_date` wird nach jedem `book`-Aufruf aktualisiert, damit `nextDueDate` korrekt auf den *übernächsten* Termin springt (kein versehentliches Doppelbuchen).

## 6. Prognose (`/forecast`)

```bash
GET /api/forecast?months=6
```

Projiziert **nur** aktive `recurring`-Vorlagen in die Zukunft — bewusst keine Kursschwankungen o.ä., da diese nicht vorhersehbar sind. Antwort enthält pro Aktiva-/Passiva-Konto eine Zeitreihe (`projection: [{date, balance}]`, beginnend beim aktuellen Saldo) sowie eine flache Liste `upcomingOccurrences` aller anstehenden Termine im Zeitraum.

## 7. Auswertungen (`/reports`)

```bash
GET /api/reports/by-category?from=2026-07-01&to=2026-07-31
GET /api/reports/by-payee?from=2026-07-01&to=2026-07-31
GET /api/reports/money-usage?from=2026-07-01&to=2026-07-31&accounts=2,6,3
```

Anders als bei den rohen `postings` sind die Vorzeichen hier bereits **nutzerfreundlich gedreht**: `by-category` liefert für `income`-Konten positive `totalCents` (statt der intern negativen Buchungssumme); `by-payee` liefert getrennt `expenseTotalCents` und `incomeTotalCents`, beide als positive Beträge.

**`by-category` ist Rollup-fähig** — für jede Kategorie, egal wie tief verschachtelt, enthält `totalCents` die Summe der eigenen Buchungen **plus aller Unterkonten**, rekursiv. Bei `Aufwendungen > Freizeit & Hobby > Urlaube & Trips > Wochenendreisen` bekommst du also eine Zeile pro Ebene, jede mit dem vollständig hochgerechneten Betrag:

```json
[
  { "accountId": 16, "accountName": "Freizeit & Hobby", "depth": 1, "totalCents": 45000 },
  { "accountId": 22, "accountName": "Urlaube & Trips",   "depth": 2, "totalCents": 30000 },
  { "accountId": 23, "accountName": "Wochenendreisen",   "depth": 3, "totalCents": 20000 }
]
```

`depth` zählt ab 1 (direktes Kind von "Aufwendungen"/"Erträge"); der Wurzelknoten selbst wird nicht ausgewiesen. **Wichtig:** Zeilen verschiedener Tiefe nicht einfach aufsummieren — "Freizeit & Hobby" (45000) enthält "Urlaube & Trips" (30000) bereits vollständig. Für eine überschneidungsfreie Gesamtsumme (z. B. für ein Balkendiagramm) nur `depth === 1` verwenden.

**`money-usage` ist eine Geldflussrechnung, keine Erfolgsrechnung.** Während `by-category` nur den echten Verbrauch (`Aufwendungen`) zeigt, beantwortet `money-usage` die Frage „wohin fließt die Liquidität?" — inklusive Vermögensbildung (Sparen/Vorsorge) und Schuldentilgung, die kein Verbrauch sind, aber Liquidität binden. Der Parameter `accounts` (kommagetrennte IDs, inkl. Unterkonten) definiert die **Gruppe liquider Konten** L. Betrachtet werden alle Buchungen mit mindestens einem Posting auf L; aggregiert werden deren **Gegen-Postings** (Konten außerhalb L) je Gegenkonto. Interne Umbuchungen innerhalb L (z. B. Girokonto→Kreditkarte-Ausgleich) haben keine Gegen-Postings außerhalb L und fallen automatisch raus — keine Doppelzählung. Jedes Gegenkonto wird nach `type` + Vorzeichen der aufsummierten Postings klassifiziert:

| Gegenkonto-Typ | Summe > 0 (Abfluss) | Summe < 0 (Zufluss) |
|---|---|---|
| `expense` | Konsum | — |
| `income` | — | Einnahmen |
| `asset` (∉ L) | Vermögensbildung | Vermögensauflösung |
| `liability` | Schuldentilgung | Kreditaufnahme |

`amountCents` ist immer positiv (Magnitude); `direction` ist `herkunft` (Zufluss) oder `verwendung` (Abfluss). `netChangeCents` = Σ Herkunft − Σ Verwendung und entspricht der tatsächlichen Saldoänderung der liquiden Gruppe im Zeitraum. Eine Split-Buchung (z. B. Darlehensrate = Zins + Tilgung) landet anteilig in mehreren Töpfen, weil jedes Gegen-Posting einzeln zählt.

**Kontenauswahl speichern/laden** (`/report-configs`) — damit die liquide Gruppe nicht bei jedem Besuch neu zusammengeklickt werden muss:

```bash
GET /api/report-configs                       # [{ id, name, accountIds: [2,6,3] }, …]
POST /api/report-configs                       # {name, accountIds: number[]}
DELETE /api/report-configs/{id}
```

Bewusst generisch (`accountIds` ohne festen Report-Bezug), damit die Tabelle für künftige Auswertungen mit Kontenauswahl wiederverwendbar bleibt. `name` ist `UNIQUE` (doppelter Name → 400).

## 8. CSV-Import (`/import/*`)

Dreistufiger Ablauf, gedacht für Bank-/Kreditkarten-Exporte:

1. **`POST /import/parse`** `{csvText, skipRows?}` → erkennt Trennzeichen automatisch, liefert `headers` + `sampleRows` zur Anzeige.
2. **`POST /import/preview`** `{csvText, delimiter, hasHeader, skipRows?, mapping: {date, amount, description?, payee?}, defaultAccountId}` (Spaltenindizes, 0-basiert) → geparste Zeilen inkl. `suggestedCategoryAccountId`/`suggestionSource` (Kategorie-Vorschlag, siehe unten) und Doubletten-Hinweis (siehe unten).
3. **`POST /import/commit`** `{defaultAccountId, rows: [{date, amountCents, description, payeeName, postings: [{accountId, amountCents}]}]}` → legt für jede Zeile eine Buchung an: eine Zeile auf `defaultAccountId` plus eine Zeile je Eintrag in `postings` (gleiche Vorzeichenlogik wie in Abschnitt 4). Im Normalfall enthält `postings` genau einen Eintrag (Gegenkonto = gesamter Betrag); für Split-Buchungen (z. B. ein Wocheneinkauf mit Lebensmittel- und Drogerie-Anteil) mehrere Einträge, deren `amountCents` sich exakt zu `-amountCents` der Zeile summieren müssen — sonst wird die Zeile stillschweigend übersprungen (kein Hard-Error, nur der `created`-Zähler fällt niedriger aus). Kontotyp der `postings`-Konten ist **nicht** auf `expense`/`income` beschränkt — auch ein anderes Aktiva-/Passiva-Konto ist zulässig, um echte Kontoumbuchungen (z. B. die monatliche Kreditkarten-Ausgleichszahlung) direkt beim Import korrekt als Umbuchung statt als Kategorie zu erfassen.

`defaultAccountId` ist seit der Doubletten-Erkennung schon in `preview` Pflicht (nicht erst in `commit`), weil der Abgleich das Ziel-Konto kennen muss.

Datums-Parser versteht `YYYY-MM-DD`, `DD.MM.YYYY`, `DD/MM/YYYY`; Betrags-Parser versteht deutsche Schreibweise (`1.234,56`, `-45,90`).

`skipRows` (Default 0, 0-basiert) überspringt eine feste Anzahl führender Zeilen, **bevor** Trennzeichen-Erkennung und Parsing laufen — für Bank-Exports mit Metadaten vor der eigentlichen Tabelle (z. B. MLP Banking AG: Kontoinhaber/Zeitraum/IBAN in den Zeilen 1–14, Spaltenüberschrift erst in Zeile 15 → `skipRows: 14`). Muss in `parse` und `preview` denselben Wert tragen, sonst zeigen die in `parse` ermittelten Spalten-Indizes auf die falschen Zeilen.

**Kategorie-Vorschlag:** Zwei Quellen, in dieser Reihenfolge. (1) `payee` — ein exakt bekannter Zahlungsempfänger (`payees.name`), Kategorie = die bei diesem Zahlungsempfänger bisher am häufigsten gebuchte. (2) Falls kein Zahlungsempfänger passt, Fallback `similarBooking`: sucht frühere Buchungen auf `defaultAccountId` mit **exakt demselben** `amountCents`, vergleicht deren Verwendungszweck unscharf mit dem aktuellen (Wortmengen-Überlappung nach Entfernen von Ziffern und deutschen Monatsnamen, z. B. wird "Miete Juli" mit "Miete August" auf "miete" reduziert und erkannt) und übernimmt bei einer Ähnlichkeit ≥ 0,5 deren Gegenkonto — bewusst **kein** Filter auf `expense`/`income`, damit auch wiederkehrende Umbuchungen erkannt werden. Bewusst keine Volltextsuche/FTS5: Der SQL-Filter auf exakten Betrag hält die Kandidatenmenge klein genug, dass ein einfacher Wortmengen-Vergleich in der Anwendungslogik reicht — angemessen für die Datengröße einer privaten Finanz-App. Bei `similarBooking` trägt die Zeile zusätzlich `similarBookingOf: {transactionId, date, description}` mit der gefundenen Vorbuchung.

**Doubletten-Erkennung:** Jede Vorschau-Zeile trägt zusätzlich `possibleDuplicate` und (falls `true`) `duplicateOf: {transactionId, date, description}`. Ein Treffer liegt vor, wenn auf `defaultAccountId` bereits eine Buchung mit **exakt gleichem, vorzeichenbehaftetem** `amountCents` existiert, deren Datum innerhalb von **±3 Tagen** um das Zeilendatum liegt. Bewusst **kein** Text-/Beschreibungsabgleich — z. B. liest sich derselbe Kreditkarten-Ausgleich im Girokonto- und im Kreditkarten-Auszug meist komplett unterschiedlich, während Datum und Betrag (aus Sicht des jeweiligen Kontos) übereinstimmen. Das ist eine Heuristik, keine exakte Erkennung (keine Bank-Transaktions-ID im generischen CSV-Format); wer die Vorlagen ohne die mitgelieferte UI nutzt, sollte `possibleDuplicate`-Zeilen standardmäßig von `commit` ausschließen und nur bei bewusster Prüfung einschließen. Diese Erkennung greift **nur innerhalb desselben Kontos** — für Fälle, in denen dasselbe Ereignis auf zwei verschiedenen Konten mit großem zeitlichem Abstand auftaucht (z. B. eine Bargeldauszahlung, die auf der Kreditkartenabrechnung sofort erscheint, aber erst Tage später auf dem Girokonto abgebucht wird), siehe `skipPatterns` unten.

**Zeilen ignorieren (`skipPatterns`):** `preview` nimmt optional `skipPatterns: [{pattern, field}]` entgegen (`field` ∈ `description|payee|both`, Regex case-insensitiv). Eine Zeile, deren Beschreibung und/oder Zahlungsempfänger auf ein Muster passt, erhält `ignored: true` und `ignoredByPattern: "<Muster>"` — Kategorie-Vorschlag und Doubletten-Prüfung werden für sie nicht berechnet, und `commit` darf sie nicht enthalten (die mitgelieferte UI blendet sie entsprechend aus). Ungültige Regex werden hier **defensiv ignoriert** (die Zeile matcht dann einfach nie) statt einen Fehler zu werfen — anders als beim Speichern einer Vorlage (siehe unten), wo ein ungültiger Regex mit 400 abgelehnt wird.

**Import-Vorlagen** (`/import-templates`) sparen Schritt 2 bei wiederkehrend gleich strukturierten Exporten:

```bash
GET /api/import-templates
POST /api/import-templates   # {name, delimiter, hasHeader, skipRows?, mapping: {date:{index,header}, amount:{...}, ...}, defaultAccountId?, skipPatterns?: [{pattern, field}]}
DELETE /api/import-templates/{id}
```

Das gespeicherte `mapping` trägt pro Feld sowohl `index` als auch `header`. Beim Wiederanwenden auf eine neue Datei zuerst per `header`-Text abgleichen (robust gegen leicht veränderte Spaltenreihenfolge), erst bei fehlendem Treffer auf den gespeicherten `index` zurückfallen — das musst du als API-Nutzer selbst nachbilden, wenn du die Vorlagen ohne die mitgelieferte UI anwendest. `skipPatterns` (Default `[]`) wird beim Speichern validiert: jedes `pattern` muss ein kompilierbarer Regex sein, sonst 400 `"Ungültiges Suchmuster (Regex): <pattern>"`.

## 9. Typische Fehler

| Ursache | Status | Meldung (Auszug) |
|---|---|---|
| Postings summieren nicht zu 0 | 400 | "müssen sich zu 0 summieren" |
| Weniger als 2 Postings | 400 | "mindestens zwei Buchungszeilen" |
| Posting mit Betrag 0 | 400 | "Betrag 0 sind nicht erlaubt" |
| Konto hat noch Buchungen/Unterkonten | 400 (bei DELETE) | "kann nicht gelöscht werden" |
| Vorlagenname bereits vergeben | 400 | "existiert bereits" |
| Unbekannte ID | 404 | "nicht gefunden" |
