# Trading Book

Lokales Trading-Journal als einzelne HTML-App. Keine Installation, kein Server, keine Cloud – alle Daten bleiben in einer JSON-Datei auf deinem Rechner.

## Starten

`index.html` im Browser öffnen (per Doppelklick oder "Öffnen mit" → Chrome/Edge).

Für vollen Funktionsumfang (direktes Lesen/Schreiben der JSON-Datei) wird **Chrome oder Edge** empfohlen. In Safari/Firefox funktioniert die App ebenfalls, Speichern lädt die Datei dann als Download herunter statt sie direkt zu überschreiben.

## Sprache

Die App ist auf **Deutsch und Englisch** verfügbar – umschaltbar über den DE/EN-Schalter oben rechts im Startbildschirm bzw. unten in der Seitenleiste. Die Sprache wird sofort auf die gesamte Oberfläche angewendet (kein Neuladen nötig) und bleibt auch für zukünftige Besuche gespeichert. Das betrifft nur die Anzeige (Menüs, Beschriftungen, Zahlen- und Datumsformat) – deine Trade-Daten in der JSON-Datei bleiben unverändert, die Spracheinstellung ist reine Browser-/Geräteeinstellung, kein Teil der Datei.

## Erste Schritte

- **Neues Trading Book anlegen** – startet mit einer leeren Datenbasis, die du dir beim ersten Speichern lokal ablegst.
- **Vorhandene Datei öffnen** – lädt eine bestehende `trading-book.json`. Zum Ausprobieren liegt eine Beispieldatei unter `data/beispiel.json`.

## Daten & Speicherung

Alle Trades liegen in einer JSON-Datei (Struktur siehe `data/beispiel.json`). Die App merkt sich die verknüpfte Datei während der Sitzung – Klick auf **Speichern** schreibt Änderungen direkt zurück. Zusätzlich wird nach jeder Änderung automatisch eine Sicherungskopie im Browser (localStorage) gehalten, damit ein versehentliches Schließen des Tabs keine Eingaben verliert ("Letzte Sitzung fortsetzen").

**Nach einem Neuladen der Seite** stellt "Letzte Sitzung fortsetzen" automatisch auch die Verbindung zur zuletzt geöffneten Datei wieder her (die Datei-Verknüpfung wird dafür in IndexedDB gemerkt) – Chrome/Edge fragen dabei aus Sicherheitsgründen einmal kurz per Berechtigungs-Popup nach ("Zugriff erlauben"), aber du musst die Datei nicht erneut über den Dateidialog auswählen. Klappt die Wiederverbindung nicht (z.B. Berechtigung abgelehnt, Datei verschoben/gelöscht), landest du wie bisher im "Speichern unter…"-Dialog beim nächsten Speichern.

Beim Öffnen, Anlegen oder Speichern einer größeren Datei (mehrere Tausend Trades) zeigt die App einen Lade-Overlay mit Spinner, solange die Datei verarbeitet wird – das Einlesen und Aufbereiten großer JSON-Dateien blockiert kurz die Seite, damit ist aber sichtbar, dass etwas passiert, statt dass die App scheinbar eingefroren wirkt.

### Import und Sicherheit

Dateien werden vor der Verwendung geprüft: Werte, die nicht zum erwarteten Typ passen (z. B. Text statt Zahl, ungültige Währungscodes, defekte Einträge), werden bereinigt oder verworfen, und alle Inhalte aus einer Datei (Symbole, Tags, Namen) werden beim Anzeigen maskiert. Eine fremde JSON-Datei kann deshalb keinen Code in der App ausführen. Trotzdem gilt: Öffne nur Dateien aus vertrauenswürdiger Quelle.

## Buchname

Jedes Trading Book hat einen **Namen** (änderbar in den Einstellungen), der in der Sidebar unter dem Logo und im Browser-Tab-Titel angezeigt wird. Nützlich, wenn mehrere Bücher parallel offen sind (z.B. Live-Konto, Demo, Krypto) – so ist immer auf einen Blick klar, welches gerade geöffnet ist. Beim Öffnen einer alten Datei ohne gespeicherten Namen wird der Dateiname als Vorschlag übernommen. Beim Speichern wird der Buchname auch als vorgeschlagener Dateiname verwendet.

## Statistiken

Dashboard und Statistik-Ansicht berechnen aus den Trades u.a.: Gesamt-P&L, Win-Rate, Profit Factor, Erwartungswert, Max Drawdown, Equity-Kurve, P&L nach Symbol/Tag/Wochentag, P&L-Verteilung sowie R-Multiples (sofern ein Stop-Loss hinterlegt ist).

Die Statistik-Seite hat oben eine **Zeitraum-Auswahl** (Gesamter Zeitraum, Dieses/Letztes Jahr, Dieser/Letzter Monat, Letzte 30/90 Tage, oder freies Von/Bis) – damit lässt sich z.B. gezielt die Performance des letzten Jahres nachschlagen. Alle Kacheln und Charts auf der Seite filtern sich entsprechend.

Zusätzlich gibt es einen **P&L-Kalender** (Tagesansicht, grün/rot je nach Tagesergebnis, ähnlich einer GitHub-Contribution-Grafik) und in der Trades-Tabelle sind alle Spalten durch Klick auf den Spaltenkopf **sortierbar**.

### Gebühren

Gebühren werden konsistent in jeder P&L-Kennzahl berücksichtigt (Gesamt-P&L, Equity-Kurve, Drawdown, alle Gruppierungen, Kalender, Monatsziel, R-Multiple, Win-Rate) – ein Trade mit Gewinn vor Gebühren, der durch die Gebühr netto ins Minus rutscht, zählt korrekt als Verlust. Ausgenommen sind bewusst nur reine Positionsgrößen-Kennzahlen wie Liquidationspreis, Hebel und Margin, die keine Ergebnisrechnung sind.

Für Transparenz gibt es zusätzlich eine eigene **Gebühren-Spalte** in der Trades-Tabelle sowie eine **Gesamt-Gebühren**-Kachel auf der Statistik-Seite (inkl. Ø pro Trade), die sich ebenfalls nach der Zeitraum-Auswahl filtert.

## Monatsziel

In den Einstellungen lässt sich optional ein **Monatsziel** als Zielrendite in % (bezogen auf das Startkapital) hinterlegen.

- Das Dashboard zeigt einen Fortschrittsbalken mit dem aktuellen Monatsergebnis gegen das Ziel, samt Pfeilen zum Durchblättern vergangener Monate (nicht in die Zukunft).
- Die Statistik-Seite zeigt zusätzlich ein Balkendiagramm **"Monatsziel – letzte 24 Monate"** mit Ziellinie und einer Trefferquote ("X von 24 Monaten erreicht"). Dieser Chart ist bewusst unabhängig von der Zeitraum-Auswahl weiter oben auf der Seite (immer die letzten 24 Kalendermonate).

## Trade löschen

Löschen erfolgt sofort (kein Bestätigungsdialog) – dafür erscheint ein Toast mit **Rückgängig**-Option für ein paar Sekunden, falls es ein Versehen war.

## Hebel & Margin

Für gehebeltes Trading (CFD, Forex, Krypto-Margin, Futures, Optionen) gibt es pro Trade zwei optionale Felder:

- **Hebel** – fester Faktor (z.B. `30` für 1:30). Die Margin wird automatisch als Positionsgröße ÷ Hebel berechnet. Passt für CFD/Forex/Krypto-Margin.
- **Margin (manuell)** – überschreibt die automatische Berechnung. Sinnvoll für Futures (feste Initial Margin pro Kontrakt) oder Optionen (Kapitalbindung entspricht der Prämie, nicht Notional ÷ Hebel).

Ist keins von beiden gesetzt, gilt der Trade als ungehebelt (Margin = volle Positionsgröße).

Die Trades-Tabelle zeigt zusätzlich zur Kursrendite (**% Kurs**) die tatsächliche **% Kapital**-Rendite bezogen auf die eingesetzte Margin – bei Hebel ist das die aussagekräftigere Zahl. Das Dashboard zeigt außerdem die aktuell in offenen Positionen gebundene Margin.

### Liquidationspreis & Risiko-Warnungen

Ist ein Hebel oder eine Margin hinterlegt, berechnet die App einen **näherungsweisen Liquidationspreis** – die Kursbewegung, bei der die eingesetzte Margin vollständig aufgezehrt wäre (ohne Maintenance-Margin-Puffer oder Gebühren, also eine grobe Orientierung, kein exakter Broker-Wert).

- Im Trade-Formular erscheint beim Eintragen von Hebel/Margin ein Live-Hinweis mit Liquidationspreis und effektivem Hebel.
- Ab **10x effektivem Hebel** wird gewarnt, dass schon kleine Kursbewegungen die Margin aufzehren können.
- Liegt der Stop-Loss hinter dem Liquidationspreis, warnt die App zusätzlich, dass die Position vorher liquidiert würde, bevor der Stop greift.
- Das Dashboard zeigt ein **Risiko-Warnungen**-Panel für alle offenen Positionen mit hohem Hebel bzw. unsicherem Stop-Loss.
- Trades ohne Hebel/Margin gelten als ungehebelte Cash-Position – hier gibt es keinen Liquidationspreis.

## Mobile Nutzung

Die Oberfläche ist auch am Smartphone voll nutzbar:

- **Navigation:** unten eine Tab-Leiste (Dashboard, Trades, Statistiken, Einstellungen), oben eine schmale Leiste mit Buchname, Status-Punkt und Speichern-Button. Ein runder „+"-Button legt einen neuen Trade an.
- **Trades:** bis 640 px Breite als Karten statt Tabelle (Symbol, Ergebnis, Liquidationspreis, Tags); Tippen öffnet das Formular. Filter und Sortierung stecken in einem Bottom-Sheet. Ab 641 px (Tablet) bleibt die Tabelle, ein Tipp auf die Zeile öffnet den Trade.
- **Formular:** Vollbild, Zifferntastatur für Zahlenfelder, Tags werden auch beim Verlassen des Feldes übernommen.
- **Statistiken:** Kalender-Heatmap startet bei den neuesten Wochen; ein Tipp auf einen Tag zeigt sein Ergebnis darunter.
- **Sprache:** am Handy im Bereich „Einstellungen" umschaltbar.

**Speichern am Handy:** Mobile Browser kennen die File System Access API meist nicht. Speichern öffnet dort – sofern unterstützt – das System-Teilen-Menü („In Dateien sichern"), sonst wird die JSON-Datei heruntergeladen; Öffnen läuft über die Dateiauswahl. Zusätzlich wird deine Sitzung im Browser zwischengespeichert („Letzte Sitzung fortsetzen"), aber exportiere die Datei trotzdem regelmäßig – mobile Browser können ihren Speicher nach längerer Inaktivität räumen.

## Performance & Skalierung

Die App wird regelmäßig mit einem synthetischen Datensatz von 100.000 Trades getestet. Diese reine Stresstest-Datei (bewusst unrealistisch, ~46 Trades/Tag) liegt dauerhaft unter `data/stress-test-100k.json` (ca. 27 MB) und kann jederzeit über **Vorhandene Datei öffnen** geladen werden, um die App unter Last auszuprobieren. Für einen realistischen Eindruck der App nutz stattdessen `data/beispiel.json` (siehe oben) – die hat eine plausible Trade-Frequenz von 3–5 pro Handelstag.

- **Trades-Ansicht**: paginiert (25/50/100/200 pro Seite), dadurch auch bei sehr vielen Trades flüssig (~350ms Ladezeit bei 100.000 Trades). Ohne Pagination würde das Rendern von >10.000 Zeilen auf einmal den Browser-Tab einfrieren – das ist der Grund für die Paginierung. Auch die Sortierung per Klick auf einen Spaltenkopf bleibt bei 100.000 Trades unter 100ms.
- **Equity-Kurve** und **R-Multiple-Chart**: werden für die Chart-Darstellung auf max. 400 bzw. 300 Punkte reduziert (Downsampling) – ein Chart mit einem Balken pro Trade wäre bei mehreren Zehntausend Trades sowohl unlesbar als auch spürbar langsam (>1s allein fürs Rendern bei ~69.000 Punkten, gemessen). Max-Drawdown-Kennzahlen werden vorher aus der vollständigen Kurve berechnet und bleiben exakt.
- **Monatsziel-Verlauf (24 Monate)**: die Monats-P&L-Werte werden in einem einzigen Durchlauf über alle Trades vorberechnet statt 24 einzelne Scans – bei 100.000 Trades reduziert das die Ladezeit der Statistik-Seite von über 2s auf unter 700ms.
- **Autosave im Browser (localStorage)**: hat ein Limit von üblicherweise 5–10 MB. Bei sehr großen Dateien (grob ab ~15.000–20.000 Trades) greift das Autosave nicht mehr – die App zeigt das im Datei-Status an ("Autosave inaktiv") und du solltest dann regelmäßig manuell über **Speichern** sichern. Die eigentliche JSON-Datei auf der Festplatte hat dieses Limit nicht.

### Bekannte Grenzen / mögliche nächste Schritte

Nicht umgesetzt, weil außerhalb des ursprünglichen Anforderungsumfangs, aber gute Kandidaten für später:

- CSV-Export der Trades (z.B. für Steuerunterlagen)
- CSV-Import (Trade-Historien vom Broker einlesen)
- Mehrfachauswahl/Bulk-Löschen in der Trades-Tabelle
- "Verwendete Tags" in den Einstellungen ist ungedeckelt – bei sehr vielen unterschiedlichen Tags könnte die Liste lang werden
