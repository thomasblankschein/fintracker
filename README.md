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

## Konzept

- **Konten** = Kontenrahmen (Aktiva, Passiva, Eigenkapital, Erträge, Aufwendungen), beliebig tief verschachtelbar (z. B. Aufwendungen > Freizeit & Hobby > Urlaube & Trips). Kategorien sind schlicht Konten vom Typ Erträge/Aufwendungen. Der Kontenrahmen lässt sich als JSON-Datei exportieren und (per Merge, ohne bestehende Konten zu überschreiben) wieder importieren.
- **Buchungen** bestehen aus mind. 2 Buchungszeilen, deren Beträge sich zu 0 summieren müssen (doppelte Buchhaltung). Vorzeichen: positiv = Geld fließt ins Konto, negativ = Geld fließt heraus. Die Buchungsübersicht lässt sich nach Datum, Zahlungsempfänger, Konto (inkl. Unterkonten) und Beschreibung filtern (auch kombiniert).
- **Wiederkehrende Zahlungen** werden auf der Dashboard-Seite in die Zukunft extrapoliert (Prognose) und können mit "Jetzt buchen" als echte Buchung übernommen werden.
- **Auswertungen** nach Kategorie und Zahlungsempfänger, mit Rollup über verschachtelte Kategorie-Ebenen (eine Oberkategorie zeigt die Summe aller Unterkategorien).
- **CSV-Import**: Datei hochladen, Spalten zuordnen (inkl. Umbuchungen zwischen echten Konten, z. B. Kreditkarten-Ausgleich), Kategorien prüfen/anpassen (Vorschläge basieren auf bisherigen Zahlungsempfänger-Zuordnungen, Duplikate werden automatisch markiert), importieren. Spaltenzuordnungen lassen sich als Vorlage speichern und wiederverwenden.
