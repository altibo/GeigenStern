# GeigenStern 🎻⭐

Geige üben wie mit Yousician – als Handy-Web-App (PWA) für Android, kinderfreundlich in Pastell, mit der Eule **Pip**.

## Für Eltern – so geht's
1. Link in **Chrome auf dem Android-Handy** öffnen, im Menü „Zum Startbildschirm hinzufügen“ (dann läuft die App auch offline).
2. Beim ersten Start fragt Pip nach dem Namen (vorausgefüllt: **Liviana**, später über ✏️ änderbar).
3. Lied antippen → **Stimmgerät** (G D A E, „passt!“ ab ±10 Cent, Tippen auf einen Buchstaben spielt den Ton) → „Weiter zum Lied“ oder „Überspringen“.
4. Beim ersten Mal erklärt Pip das Mikrofon, danach fragt Chrome nach der Erlaubnis.
5. **Kammerton** im Stimmgerät einstellen (Standard 440 Hz; 432/440/442 per Knopf, ±1 Hz, oder „🎯 Automatisch“: 3 Sekunden die leere A-Saite streichen). Gilt für Stimmgerät, Bewertung, Begleitung und Vorspiel-Melodie; auf der Startseite steht der aktuelle Wert.
6. Tempo wählen: 🐇 Normal · 🐢 Schildkröte (70 %, wartet auf den richtigen Ton) · 🐌 Schnecke (50 %, wartet, großzügigere Toleranz).
7. Ansicht oben umschalten: **Tabs** (Saiten + Fingernummern), **Tabs + Noten**, **Noten**.
8. „▶ Los geht's!“ – ein Takt Einzählen, dann laufen die Noten zur rosa Linie. „👂 Anhören“ spielt das Lied mit Melodie vor.
9. Am Ende gibt es bis zu 3 Sterne, Punkte, Abzeichen und den Vorschlag „Takt x–y üben“. Üben wiederholt die gewählten Takte, bis sie zweimal hintereinander zu mindestens 85 % klappen.

Tipp: Handy auf den Notenständer, ca. 0,5–1 m entfernt, Begleitung eher leise (der Regler „🎹 Begleitung“), damit das Mikrofon vor allem die Geige hört.

## Lieder (leicht → schwer)
| Lied | Tonart | Saiten |
|---|---|---|
| Alle meine Entchen | D-Dur | D, A |
| Hänschen klein | D-Dur | D, A |
| Ode an die Freude | D-Dur | G (A3), D, A – mit Achteln |
| Twinkle Twinkle Little Star | A-Dur | A, E |
| Harry-Potter-Thema | e-Moll, 3/4 | G (H3), D, A |

Alle Töne liegen in der 1. Lage; jede Note hat Saite und Finger (0 = leere Saite, 1, 2 (tief/hoch), 3). Der Test `songs: … playable in first position` prüft das.

**Harry-Potter-Thema:** eigene, stark vereinfachte Anfänger-Bearbeitung der Anfangsmelodie von „Hedwig's Theme“ (John Williams, urheberrechtlich geschützt). **Nur für den privaten Gebrauch** – den Link bitte nicht öffentlich teilen.

## Tempo
Normal-Tempo (Viertel pro Minute): Entchen 80, Hänschen 84, Ode 80, Twinkle 80, Harry-Potter-Thema 96 im 3/4-Takt (die Originalmelodie steht im 3/8, hier in Vierteln notiert – das entspricht etwa der halben Originalgeschwindigkeit). Schildkröte = 70 %, Schnecke = 50 %, zusätzlich „Feintempo“ 60–120 % in 5-%-Schritten. Ein Browser-Test misst die hörbaren Metronom-Klicks und prüft, dass sie dem angezeigten ♩-Wert entsprechen.

## Punkte und Sterne
- Pro Note max. 100 Punkte: Tonhöhe 70 + Timing 30. „Super!“ innerhalb der Toleranz (Normal ±30 Cent, Schildkröte ±40, Schnecke ±50), darüber „etwas zu hoch/tief“, ab 100 Cent „anderer Ton“.
- Timing (nur Normal): ±max(110 ms, 0,2 Schlag) = voll, sonst „etwas früh/spät“. In Schildkröte/Schnecke zählt Timing immer voll, falsche Versuche kosten etwas Tonhöhen-Punkte.
- Serien-Bonus: jede „Super!“-Note in Folge +2 je Serienlänge (max. +20).
- **Sterne nach Trefferquote (ohne Bonus): ★ ab 50 %, ★★ ab 70 %, ★★★ ab 88 %.** Sterne und Bestwert bleiben gespeichert (das bessere Ergebnis zählt).
- Abzeichen: Erstes Lied, Drei Sterne, 3 Tage, 7 Tage, 100 Super-Töne, Alle Lieder, Sternen-Profi, Hasen-Tempo.

## Datenschutz
Alles bleibt auf dem Gerät (localStorage). Das Mikrofon-Signal wird nur im Browser analysiert (YIN-Tonhöhenerkennung), nichts wird aufgenommen, hochgeladen oder verschickt. Echo-Unterdrückung, Rauschfilter und automatische Lautstärke sind aus, damit die Geige unverfälscht ankommt.

## Technik
Vite + TypeScript, Web Audio (eigene Begleitung: Pad, Klavier, Bass, leise Percussion, Metronom, Melodie), YIN-Pitch-Detektor (`src/core/pitch.ts`), Bewertung (`src/core/judge.ts`), Notensatz als eigenes SVG mit Glyphen aus **Bravura** (SIL Open Font License, © Steinberg), Schrift **Nunito** (SIL OFL). Bildschirm bleibt beim Spielen an (Wake Lock), Offline über Service Worker. Die Tonerkennung läuft in einem AudioWorklet (nicht im Haupt-Thread). Die Noten liegen in einer einzigen SVG-Ebene, die nur per `translate3d` verschoben wird; die Position kommt aus einer geglätteten Audio-Uhr (gegen Ruckeln durch grobe `currentTime`-Schritte auf Android).

```
npm install
npm test             # Unit-Tests (Pitch, Lieder, Bewertung, Tempo, Warte-Modus, Fortschritt)
npm run test:browser # Playwright mit simuliertem Mikrofon (WAV + Auto-Spieler), Screenshots nach shots/
npm run build
```

## Grenzen
Getestet nur in Headless-Chromium mit synthetischen Geigentönen. Nicht getestet: echte Geige, echtes Android-Handy, Raumgeräusche, leise oder kratzige Anfänger-Töne, Lautsprecher-Übersprechen der Begleitung.
