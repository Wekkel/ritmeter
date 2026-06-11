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

## Locatietoestemming op de iPhone (Safari)

De toestemming zit in drie lagen:

1. **Systeem**: Instellingen → Privacy en beveiliging → Locatievoorzieningen **aan**, en in de lijst **Safari-websites** op *Bij gebruik van app*.
2. **Per website**: bij het openen toont Safari een pop-up — kies **Sta toe**. Per ongeluk geweigerd? Tik in de adresbalk op **aA** → **Website-instellingen** → Locatie → **Sta toe** en herlaad.
3. **Geïnstalleerde app**: na "Zet op beginscherm" geldt de app als eigen app; hij vraagt opnieuw om toestemming en staat daarna onder zijn eigen naam in Instellingen → Privacy → Locatievoorzieningen.

## Bediening

- **Tik op de eenheid** onder het grote getal om te wisselen tussen km/u en mph (kan ook via instellingen).
- **Tandwiel linksboven**: instellingen — taal (Nederlands/Engels), eenheid, hoogte & kompas aan/uit, en HUD-modus starten.
- **Hoogte & kompas**: optioneel paneel met GPS-hoogte en rijrichting (graden + windrichting).
- **HUD-modus**: gespiegeld, extra groot snelheidsgetal — leg de telefoon plat op het dashboard zodat het beeld in de voorruit reflecteert. Tik op het scherm om terug te keren.
- **Knop linksboven** (meter-icoon): wisselt tussen kaartmodus en focusmodus (alleen een groot snelheidsgetal — zuiniger en beter leesbaar in fel licht).
- **Start rit / Stop / Hervat / Reset**: tripmeter met afstand, rijtijd, gemiddelde en topsnelheid. De rit blijft bewaard, ook als de app sluit.
- **Stip rechtsboven**: GPS-kwaliteit (groen = scherp, oranje = matig, rood = slecht/geen fix).
- Het scherm blijft automatisch aan zolang de app open staat (Wake Lock).

## Goed om te weten

- GPS werkt alleen via **https** — GitHub Pages regelt dat automatisch.
- Buiten en in beweging is GPS-snelheid nauwkeurig; binnen of stilstaand kan de waarde even zweven. De app filtert stilstand-ruis weg.
- iPhone: schermvergrendeling voorkomen (Wake Lock) werkt vanaf iOS 16.4 in een geïnstalleerde PWA.
- De kaart heeft internet nodig (tegels van OpenFreeMap, gratis en zonder sleutel); de snelheidsmeter en tripmeter werken ook **zonder** internet.

## Roadmap (v3-ideeën)

- Ritgeschiedenis opslaan en terugkijken
