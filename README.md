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


## Installeren op je telefoons

**Android:**
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
