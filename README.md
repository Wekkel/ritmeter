# RitMeter 🏍️

Snelle GPS-snelheidsmeter als PWA: 3D-kaart in rijpositie, grote snelheidsweergave
(km/u of mph) en een tripmeter met start/stop. Werkt op Android én iPhone, zonder app store.

## Bestanden

| Bestand | Functie |
|---|---|
| `index.html` | De complete app (HTML + CSS + JavaScript) |
| `manifest.json` | Maakt de app installeerbaar |
| `sw.js` | Service worker: snelle start en offline app-shell |
| `icon-*.png` | App-iconen |

## Online zetten via GitHub Pages (eenmalig, ±5 minuten)

1. Maak een account op github.com (als je dat nog niet hebt).
2. Klik rechtsboven op **+** → **New repository**. Naam: bijv. `ritmeter`. Zet hem op **Public** en klik **Create repository**.
3. Klik op **uploading an existing file**, sleep alle bestanden uit deze map erin en klik **Commit changes**.
4. Ga naar **Settings** → **Pages**. Bij *Branch* kies je `main` en map `/ (root)`, dan **Save**.
5. Na 1-2 minuten staat je app live op:
   `https://JOUWNAAM.github.io/ritmeter/`

Aanpassingen later? Upload gewoon de gewijzigde bestanden opnieuw. Verhoog dan in `sw.js`
het versienummer (`ritmeter-v1` → `ritmeter-v2`) zodat telefoons de nieuwe versie ophalen.

## Installeren op je telefoons

**Samsung S24 Ultra (Chrome of Samsung Internet):**
open de URL → menu (⋮) → **Toevoegen aan startscherm** / **App installeren**.

**iPhone (moet via Safari):**
open de URL → deelknop (vierkant met pijl) → **Zet op beginscherm**.

Bij de eerste start vraagt de telefoon om locatietoestemming — kies **Toestaan tijdens gebruik**.

## Bediening

- **Tik op de eenheid** onder het grote getal om te wisselen tussen km/u en mph.
- **Knop linksboven**: wisselt tussen kaartmodus en focusmodus (alleen een groot snelheidsgetal — zuiniger en beter leesbaar in fel licht).
- **Start rit / Stop / Hervat / Reset**: tripmeter met afstand, rijtijd, gemiddelde en topsnelheid. De rit blijft bewaard, ook als de app sluit.
- **Stip rechtsboven**: GPS-kwaliteit (groen = scherp, oranje = matig, rood = slecht/geen fix).
- Het scherm blijft automatisch aan zolang de app open staat (Wake Lock).

## Goed om te weten

- GPS werkt alleen via **https** — GitHub Pages regelt dat automatisch.
- Buiten en in beweging is GPS-snelheid nauwkeurig; binnen of stilstaand kan de waarde even zweven. De app filtert stilstand-ruis weg.
- iPhone: schermvergrendeling voorkomen (Wake Lock) werkt vanaf iOS 16.4 in een geïnstalleerde PWA.
- De kaart heeft internet nodig (tegels van OpenFreeMap, gratis en zonder sleutel); de snelheidsmeter en tripmeter werken ook **zonder** internet.

## Roadmap (v2-ideeën)

- Ritgeschiedenis opslaan en terugkijken
- HUD-modus (gespiegeld beeld voor reflectie in een voorruit)
- Hoogtemeter en kompas
