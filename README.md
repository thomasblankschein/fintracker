# Finanzen

Private Finanz-Tracker mit doppelter Buchhaltung, Kontenrahmen, Kategorien, Zahlungsempfängern, CSV-Import und Prognosen für wiederkehrende Zahlungen.

## Starten

```
npm install
npm run dev
```

Öffnet den Server auf http://localhost:3001 und die App auf **http://localhost:5173**.

Die Daten liegen lokal in `data/finanzen.db` (SQLite). Beim ersten Start wird automatisch ein editierbarer Standard-Kontenrahmen angelegt.

## Konzept

- **Konten** = Kontenrahmen (Aktiva, Passiva, Eigenkapital, Erträge, Aufwendungen). Kategorien sind schlicht Konten vom Typ Erträge/Aufwendungen.
- **Buchungen** bestehen aus mind. 2 Buchungszeilen, deren Beträge sich zu 0 summieren müssen (doppelte Buchhaltung). Vorzeichen: positiv = Geld fließt ins Konto, negativ = Geld fließt heraus.
- **Wiederkehrende Zahlungen** werden auf der Dashboard-Seite in die Zukunft extrapoliert (Prognose) und können mit "Jetzt buchen" als echte Buchung übernommen werden.
- **CSV-Import**: Datei hochladen, Spalten zuordnen, Kategorien prüfen/anpassen (Vorschläge basieren auf bisherigen Zahlungsempfänger-Zuordnungen), importieren.
