# SQLite-Datenmodell

Das Datenmodell besteht aus bewusst nur **6 Tabellen** (5 im Kern-Schema [001_init.sql](server/src/migrations/001_init.sql), plus `import_templates` in [002_import_templates.sql](server/src/migrations/002_import_templates.sql)). Kategorien sind keine eigene Entität, sondern normale Konten vom Typ `income`/`expense` im Kontenrahmen — das spart eine Tabelle gegenüber klassischen Finanz-Apps.

## ER-Diagramm

```mermaid
erDiagram
    ACCOUNTS {
        integer id PK
        text name
        text type "asset | liability | equity | income | expense"
        integer parent_id FK "NULL bei Wurzelknoten"
        integer is_active "0/1"
    }
    PAYEES {
        integer id PK
        text name "UNIQUE"
    }
    TRANSACTIONS {
        integer id PK
        text date "YYYY-MM-DD"
        text description
        integer payee_id FK "nullable"
    }
    POSTINGS {
        integer id PK
        integer transaction_id FK
        integer account_id FK
        integer amount_cents "signiert, Summe pro Transaktion = 0"
    }
    RECURRING_TEMPLATES {
        integer id PK
        text name
        integer payee_id FK "nullable"
        integer from_account_id FK
        integer to_account_id FK
        integer amount_cents
        text interval "weekly | monthly | yearly"
        integer interval_day
        text start_date
        text end_date "nullable"
        integer active
        text last_booked_date "nullable"
    }
    IMPORT_TEMPLATES {
        integer id PK
        text name "UNIQUE"
        text delimiter
        integer has_header "0/1"
        text mapping "JSON: {date,amount,description?,payee?} je {index,header}"
        integer default_account_id FK "nullable"
    }

    ACCOUNTS ||--o{ ACCOUNTS       : "parent_id (Kontenrahmen-Baum)"
    ACCOUNTS ||--o{ POSTINGS       : "account_id"
    TRANSACTIONS ||--o{ POSTINGS   : "transaction_id"
    PAYEES ||--o{ TRANSACTIONS     : "payee_id"
    PAYEES ||--o{ RECURRING_TEMPLATES : "payee_id"
    ACCOUNTS ||--o{ RECURRING_TEMPLATES : "from_account_id"
    ACCOUNTS ||--o{ RECURRING_TEMPLATES : "to_account_id"
    ACCOUNTS ||--o{ IMPORT_TEMPLATES : "default_account_id"
```

## Tabellen im Detail

### `accounts` — Kontenrahmen
Selbstreferenzierender Baum (`parent_id`) für die Hierarchie Aktiva/Passiva/Eigenkapital/Erträge/Aufwendungen — beliebig tief verschachtelbar (kein Tiefenlimit im Schema), z. B. Aufwendungen > Freizeit & Hobby > Urlaube & Trips > Wochenendreisen. Blätter unter `income`/`expense` fungieren zugleich als **Kategorien**; Auswertungen (`/reports/by-category`) rollen Beträge über beliebig viele Ebenen hoch. `is_active = 0` deaktiviert ein Konto ohne es zu löschen (Historie bleibt erhalten).

### `payees` — Zahlungsempfänger
Freie, eindeutige Liste (`UNIQUE(name)`), wird bei neuer Buchung per Autocomplete wiederverwendet oder automatisch angelegt (`findOrCreatePayee`).

### `transactions` — Buchungen
Der eigentliche Beleg: Datum, Beschreibung, optional ein Zahlungsempfänger. Enthält selbst keine Beträge — die stehen in `postings`.

### `postings` — Buchungszeilen
Herzstück der doppelten Buchhaltung: mindestens 2 Zeilen pro Transaktion, `amount_cents` ist **vorzeichenbehaftet** (positiv = Geld fließt ins Konto, negativ = Geld fließt heraus), und die Summe aller Zeilen einer Transaktion muss exakt 0 ergeben. Das ersetzt klassische Soll/Haben-Spalten durch ein einziges Vorzeichen.

### `recurring_templates` — Wiederkehrende Zahlungen
Vorlagen für Extrapolation (Prognose) und "Jetzt buchen". Fix auf **zwei** Konten (`from`/`to`) begrenzt — für Aufteilungen (z. B. Zins/Tilgung bei einer Hypothek) reicht das nicht, dafür muss weiterhin manuell mit Splits gebucht werden. `last_booked_date` verhindert, dass ein bereits verbuchtes Vorkommen erneut als "fällig" auftaucht.

### `import_templates` — CSV-Import-Vorlagen
Speichert Spalten-Zuordnung, Trennzeichen und Ziel-Konto für wiederkehrend gleich strukturierte CSV-Exporte (z. B. der monatliche Kreditkarten-Export derselben Bank). Das Mapping liegt als **JSON-Text** in `mapping` statt als eigene Spalten je Feld — hält die Tabelle schlank, analog zu `postings` als "flexible" Tabelle im Kernschema. Jedes gemappte Feld (`date`, `amount`, optional `description`/`payee`) trägt sowohl den Spalten-**Index** als auch den **Header-Text** zum Speicherzeitpunkt: beim Anwenden auf eine neue Datei wird zuerst per Header-Text gesucht (übersteht leicht andere Spaltenreihenfolge bei künftigen Exporten), erst bei fehlendem Treffer auf den Index zurückgefallen. `default_account_id` ist optional und wird beim Anwenden als Ziel-Konto vorausgefüllt.

## Kernentscheidung: ein Vorzeichen statt Soll/Haben

Statt zwei Spalten (Soll/Haben) hat jede Buchungszeile nur `amount_cents`:

| Kontotyp | Beispiel | Zeichen bei Zunahme |
|---|---|---|
| Aktiva | Girokonto | positiv |
| Aufwendungen | Lebensmittel | positiv |
| Passiva | Kreditkarte | **negativ** |
| Erträge | Gehalt | **negativ** |
| Eigenkapital | Eröffnungsbilanz | negativ |

Das ist weiterhin echte doppelte Buchhaltung (jede Transaktion balanciert über ≥2 Konten auf 0), nur ohne die Soll/Haben-Terminologie. In Dashboard/Auswertungen wird das Vorzeichen für Erträge zur Anzeige umgedreht, damit Einnahmen dort positiv erscheinen.
