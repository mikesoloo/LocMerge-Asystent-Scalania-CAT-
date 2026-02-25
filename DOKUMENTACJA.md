# LocMerge — Dokumentacja Techniczna i Użytkowa

> Wersja dokumentacji: 1.2 | Data: 2026-02-25
> Repozytorium: https://github.com/mikesoloo/LocMerge

---

## Spis treści

1. [Przegląd aplikacji](#1-przegląd-aplikacji)
2. [Architektura techniczna](#2-architektura-techniczna)
3. [Struktura projektu](#3-struktura-projektu)
4. [Obsługiwane formaty plików](#4-obsługiwane-formaty-plików)
5. [Funkcje aplikacji](#5-funkcje-aplikacji)
6. [Opis kodu — kluczowe funkcje](#6-opis-kodu--kluczowe-funkcje)
7. [Interfejs użytkownika](#7-interfejs-użytkownika)
8. [Historia powstania aplikacji](#8-historia-powstania-aplikacji)
9. [Napotykane problemy i rozwiązania](#9-napotykane-problemy-i-rozwiązania)
10. [Wersjonowanie i GitHub](#10-wersjonowanie-i-github)
11. [Uruchomienie lokalne](#11-uruchomienie-lokalne)
12. [Słownik pojęć](#12-słownik-pojęć)

---

## 1. Przegląd aplikacji

**LocMerge** to przeglądarkowa aplikacja SPA (Single Page Application) służąca do konsolidacji danych lokalizacyjnych. Umożliwia łączenie wyników tłumaczenia maszynowego (MT) z plikami roboczymi narzędzi CAT (Computer-Assisted Translation), takich jak Wordfast/TXLF.

### Problem, który rozwiązuje

W procesie lokalizacji plików (np. dokumentacja techniczna, interfejsy oprogramowania) tłumacze pracują na plikach CAT w formacie `.docx` lub `.txlf.docx`. Plik **Master** zawiera segmenty tekstu wraz z oceną MT (Machine Translation Score). Niezależnie od tego tworzone są **pliki Partii** — pliki wynikowe z finalnym tłumaczeniem każdego segmentu.

LocMerge automatycznie:
- Wczytuje plik Master (z ID segmentów, tekstem źródłowym i oceną MT)
- Wczytuje jeden lub więcej plików Partii (z ID i finalnym tłumaczeniem)
- Łączy je po kolumnie ID — uzupełniając kolumnę Target/Tłumaczenie
- Wyświetla wyniki ze statystykami pokrycia
- Umożliwia eksport wyników z powrotem do oryginalnego pliku DOCX

### Kto jest użytkownikiem

Tłumacze technicznii koordynatorzy projektów lokalizacyjnych, którzy obsługują narzędzia CAT (Wordfast, SDL Trados i podobne) i muszą scalić wyniki pracy wielu tłumaczy w jeden plik Master.

---

## 2. Architektura techniczna

### Stos technologiczny

| Technologia | Wersja | Rola |
|---|---|---|
| React | 18.2 | Framework UI, zarządzanie stanem |
| Vite | 5.0 | Serwer deweloperski i bundler |
| @vitejs/plugin-react | 4.2 | Obsługa JSX i Fast Refresh |
| JSZip | 3.10 | Odczyt i zapis plików DOCX (ZIP) |
| SheetJS (xlsx) | 0.18.5 | Odczyt plików XLSX/XLS |

### Paradygmat architektoniczny

Aplikacja jest **w pełni kliencka** — nie ma żadnego backendu, serwera API ani bazy danych. Wszystkie operacje (parsowanie plików, konsolidacja, eksport) wykonywane są lokalnie w przeglądarce przy użyciu Web API:

- `FileReader` — odczyt plików z dysku użytkownika
- `DOMParser` / `XMLSerializer` — parsowanie i serialzacja XML (wnętrze pliku DOCX)
- `Blob` / `URL.createObjectURL()` — generowanie i pobieranie plików
- `ArrayBuffer` — obsługa plików binarnych (DOCX, XLSX)

### Dlaczego brak backendu?

- **Prywatność danych**: pliki tłumaczeń mogą zawierać poufne treści
- **Prostota wdrożenia**: działa z dowolnego systemu plików lub serwera statycznego
- **Brak zależności sieciowych**: działa bez internetu po zainstalowaniu

---

## 3. Struktura projektu

```
locmerge/
├── src/
│   ├── App.jsx          # Główny i jedyny plik z logiką aplikacji oraz CSS
│   └── main.jsx         # Punkt wejścia React (ReactDOM.createRoot)
├── index.html           # Szablon HTML, język: pl, <div id="root">
├── vite.config.js       # Konfiguracja Vite (host: 127.0.0.1, port: 5173)
├── package.json         # Zależności npm i skrypty
├── .gitignore           # Wyklucza: node_modules/, dist/, .env
├── README.md            # Skrócony opis dla GitHub
└── DOKUMENTACJA.md      # Ten plik
```

### Zawartość `src/App.jsx`

Cały kod aplikacji — logika biznesowa, komponenty React i style CSS — zawarty jest w jednym pliku `src/App.jsx`. Plik składa się z:

1. **Importy** — React (useState, useRef), XLSX, JSZip
2. **Funkcje pomocnicze** — parsowanie plików, detekcja kolumn, manipulacja DOCX XML
3. **Stałe CSS** — szablon szablonu stylów wstrzykiwany przez `<style dangerouslySetInnerHTML>`
4. **Komponent `ExportModal`** — modal z podglądem i kopiowaniem TSV/Markdown
5. **Komponent `App`** — główny komponent z pełnym interfejsem użytkownika

---

## 4. Obsługiwane formaty plików

### Plik Master (wejście, źródłowe)

| Format | Rozszerzenie | Opis |
|---|---|---|
| TSV | `.tsv`, `.txt` | Wartości rozdzielone tabulatorami |
| CSV | `.csv` | Wartości rozdzielone przecinkami |
| Excel | `.xlsx`, `.xls`, `.ods` | Arkusz kalkulacyjny (pierwszy arkusz) |
| Word/CAT | `.docx` | Plik DOCX z tabelą danych CAT (format TXLF/Wordfast) |

**Wymagane kolumny Master:**
- `ID` (lub kolumna zaczynająca się od „ID")
- `Source` (lub zawierająca słowo „source")
- `Target` (lub zawierająca słowo „target")
- `Score` (opcjonalnie)

### Pliki Partii (wejście, z tłumaczeniami)

Te same formaty co Master.

**Wymagane kolumny Partii:**
- `ID` — musi odpowiadać ID w pliku Master
- `Final Translation` (lub „translation", „target", „source") — finalne tłumaczenie

### Obsługa wielotabelowych plików DOCX (TXLF)

Pliki `.txlf.docx` generowane przez narzędzia Wordfast zawierają **kilka tabel** w jednym dokumencie:
- **Tabela 0** — legenda (opisy statusów segmentów)
- **Tabela 1** — metadane projektu (klucz/wartość)
- **Tabela 2** — właściwe dane (ID | Source | Target | Score, ~46 wierszy)

Aplikacja automatycznie wybiera właściwą tabelę za pomocą funkcji `findBestTable()` i `isDataHeader()`.

---

## 5. Funkcje aplikacji

### 5.1 Wgrywanie pliku Master

- Kliknięcie na strefę upuszczania lub przeciągnięcie pliku
- Automatyczne rozpoznanie formatu na podstawie rozszerzenia
- Automatyczna detekcja roli pliku (Master/Partia) na podstawie nagłówków kolumn
- Wyświetlenie nazwy pliku i liczby wierszy na liście
- Możliwość usunięcia pliku przyciskiem „×"

### 5.2 Wgrywanie plików Partii

- Obsługa wielu plików jednocześnie (multiselect lub wielokrotne upuszczanie)
- Każdy plik wyświetlany osobno z etykietą „B" (Batch)

### 5.3 Konsolidacja

Po kliknięciu przycisku **▶ Konsoliduj**:

1. Identyfikacja pliku Master i plików Partii
2. Dopasowanie kolumn (ID, Source, Target, Score) na podstawie nagłówków
3. Zbudowanie mapy `ID → Tłumaczenie` ze wszystkich Partii
4. Przepisanie wierszy Mastera z uzupełnionymi tłumaczeniami
5. Obliczenie statystyk: total, uzupełnione, brakujące, liczba Partii
6. Wyświetlenie log operacji z timestampami

### 5.4 Wyświetlanie wyników

Trzy zakładki wynikowe:

- **Tabela** — interaktywna tabela HTML z wyszukiwarką, paginacją i kolorowaniem kolumn
- **Markdown** — tekst w formacie Markdown z możliwością kopiowania
- **TSV** — tekst w formacie TSV (do wklejenia do Excela lub innego arkusza)

### 5.5 Eksport TSV / Markdown

Kliknięcie **↓ Eksport TSV** lub **↓ Eksport Markdown** otwiera modal z pełnym tekstem wynikowym i przyciskiem „Kopiuj wszystko".

### 5.6 Eksport do DOCX (zapis do pliku Master)

Dostępny po konsolidacji, tylko gdy plik Master był w formacie DOCX.

Kliknięcie **⬇ Zapisz do DOCX**:
1. Wczytuje oryginalny plik Master ze zbuforowanego `ArrayBuffer`
2. Otwiera ZIP (DOCX = ZIP), parsuje `word/document.xml`
3. Lokalizuje właściwą tabelę danych (`findBestTable`)
4. Aktualizuje komórki w istniejących wierszach (`setCellText`)
5. Dodaje brakujące wiersze (klonowanie szablonu z ostatniego wiersza)
6. Usuwa nadmiarowe wiersze
7. Serializuje XML z powrotem i pakuje ZIP
8. Pobiera plik o nazwie `[oryginalna_nazwa]_consolidated.docx`

**Kluczowa zaleta**: oryginalne formatowanie DOCX (czcionki, kolory, obramowania komórek) jest zachowane — aktualizowany jest wyłącznie tekst w elementach `<w:t>`.

---

## 6. Opis kodu — kluczowe funkcje

### 6.1 Parsowanie plików

#### `parseTSV(text: string)`
Parsuje tekst TSV/CSV (wartości rozdzielone tabulatorami). Rozdziela linie, pierwszy wiersz to nagłówki, każdy następny to wiersz danych mapowany na obiekt `{ nagłówek: wartość }`.

```javascript
function parseTSV(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines[0].split("\t").map(h => h.trim());
  const rows = lines.slice(1).map(line => {
    const cols = line.split("\t");
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (cols[i] || "").trim(); });
    return obj;
  });
  return { headers, rows };
}
```

#### `parseXLSX(arrayBuffer: ArrayBuffer)`
Używa biblioteki SheetJS do odczytu plików Excel. Czyta pierwszy arkusz i konwertuje do formatu `{ headers, rows }`.

#### `parseDOCX(arrayBuffer: ArrayBuffer)` — async
Główna funkcja parsowania DOCX:
1. Używa JSZip do otwarcia pliku DOCX jako ZIP
2. Odczytuje `word/document.xml`
3. Parsuje XML za pomocą `DOMParser`
4. Szuka wszystkich elementów `<w:tbl>` (tabel Word)
5. Wywołuje `findBestTable()` by wybrać właściwą tabelę
6. Parsuje wiersze `<w:tr>` na obiekty z nagłówkami

### 6.2 Detekcja właściwej tabeli

#### `getRowTexts(tr: Element): string[]`
Zbiera teksty ze wszystkich komórek `<w:tc>` wiersza tabeli. Łączy tekst ze wszystkich elementów `<w:t>` wewnątrz komórki.

#### `isDataHeader(cells: string[]): boolean`
Sprawdza czy wiersz wygląda jak nagłówek tabeli danych (nie legendy). Warunek: zawiera kolumnę ID **oraz** kolumnę z danymi tłumaczeniowymi (source/target/translation/score).

```javascript
function isDataHeader(cells) {
  const lc = cells.map(h => h.toLowerCase());
  const hasId = lc.some(h => h === "id" || h.startsWith("id") || h.includes(" id"));
  const hasContent = lc.some(h =>
    h.includes("source") || h.includes("target") ||
    h.includes("translation") || h.includes("score")
  );
  return hasId && hasContent;
}
```

#### `findBestTable(tables: Element[]): Element`
Iteruje po wszystkich tabelach dokumentu. Preferuje tablicę z nagłówkiem danych (`isDataHeader`) i największą liczbą wierszy. Jako fallback wybiera tabelę z największą liczbą wierszy.

### 6.3 Eksport do DOCX

#### `setCellText(tc: Element, text: string)`
Aktualizuje tekst w komórce tabeli DOCX zachowując formatowanie:
1. Usuwa nadmiarowe paragrafy (zostawia pierwszy)
2. Usuwa nadmiarowe runy `<w:r>` (zostawia pierwszy)
3. Usuwa stare elementy `<w:t>` z runu
4. Tworzy nowy element `<w:t>` z nowym tekstem
5. Dodaje `xml:space="preserve"` jeśli tekst zaczyna/kończy się spacją

**Zachowane elementy formatowania**: `<w:tcPr>` (właściwości komórki), `<w:pPr>` (właściwości paragrafu), `<w:rPr>` (właściwości runu — czcionka, kolor, pogrubienie).

#### `exportToDOCX(buffer, rows, idCol, srcCol, tgtCol, scCol)` — async
Główna funkcja eksportu:
1. Otwiera DOCX jako ZIP (JSZip)
2. Parsuje `word/document.xml` (DOMParser)
3. Znajduje właściwą tabelę (`findBestTable`)
4. **Aktualizuje istniejące wiersze** — wywołuje `setCellText` dla każdej komórki
5. **Dodaje nowe wiersze** — klonuje ostatni wiersz (`cloneNode(true)`) i wypełnia go danymi
6. **Usuwa nadmiarowe wiersze** — jeśli wyników jest mniej niż wierszy w oryginale
7. Serializuje zmodyfikowany XML (`XMLSerializer.serializeToString`)
8. Pakuje z powrotem do ZIP (`zip.generateAsync({ type: "blob", compression: "DEFLATE" })`)
9. Zwraca `Blob` gotowy do pobrania

### 6.4 Detekcja ról i kolumn

#### `detectRole(headers: string[]): "master" | "batch"`
Automatycznie klasyfikuje plik jako Master lub Partia na podstawie nagłówków:
- **Master**: ma kolumnę Score LUB jednocześnie Source i Target
- **Batch**: ma kolumnę Translation lub Source (bez Target)

#### `findIdCol(headers)` / `findSourceCol(headers)` / `findTargetCol(headers)` / `findScoreCol(headers)` / `findTranslationCol(headers)`
Funkcje wyszukiwania kolumn z elastycznym dopasowaniem nazw. Przykłady obsługiwanych nagłówków:
- ID: `"ID"`, `"id"`, `"ID (en-us)"`, `"Segment ID"`
- Source: `"Source"`, `"Source (en-us)"`, `"Source Text"`
- Target: `"Target"`, `"Target (pl-pl)"`, `"Final Polish Translation"`
- Score: `"Score"`, `"Score MT"`, `"score"`

### 6.5 Eksport tekstowy

#### `toTSV(headers, rows): string`
Generuje tekst TSV: nagłówki + wiersze, wartości oddzielone tabulatorem.

#### `toMarkdown(headers, rows): string`
Generuje tabelę Markdown z separatorem `---` między nagłówkiem a danymi. Escapuje znaki `|` w danych.

### 6.6 Komponenty React

#### `ExportModal({ content, filename, onClose })`
Modal wyświetlający wygenerowany tekst (TSV/Markdown):
- `<textarea readOnly>` z pełną zawartością
- Przycisk „Kopiuj wszystko" (fallback: `execCommand('copy')` → `navigator.clipboard.writeText`)
- Kliknięcie poza modalem zamyka go

#### `App()` — główny komponent
Stan aplikacji (`useState`):
- `files` — lista wgranych plików `[{ name, role, headers, rows, buffer }]`
- `result` — wynik konsolidacji `{ headers, rows, log, stats, masterBuffer, masterName, idCol, srcCol, tgtCol, scCol }`
- `tab` — aktywna zakładka: `"table"` | `"markdown"` | `"tsv"`
- `search` — tekst wyszukiwania w tabeli
- `mOver` / `bOver` — stan hover dla stref upuszczania
- `modal` — zawartość otwartego modalu `{ content, filename }` lub `null`

Handlery:
- `loadFiles(fileList, forceRole)` — wczytuje pliki, parsuje, dodaje do stanu
- `removeFile(name)` — usuwa plik z listy
- `consolidate()` — łączy dane i ustawia `result`
- `handleExportDOCX()` — wywołuje `exportToDOCX` i pobiera plik
- `openExport(type)` — otwiera modal z TSV lub Markdown

---

## 7. Interfejs użytkownika

### Schemat układu

```
┌─────────────────────────────────────────────────────────┐
│  NAGŁÓWEK: LocMERGE  |  Badge statusu                  │
├───────────────────────┬─────────────────────────────────┤
│  SIDEBAR (380px)      │  CONTENT (reszta)               │
│  ─ Plik Master        │  ─ Statystyki (4 kafelki)       │
│    [strefa upuszcz.]  │  ─ Pasek postępu                │
│    [lista plików]     │  ─ Log operacji                 │
│  ─ Pliki Partii       │  ─ Zakładki: Tabela/MD/TSV      │
│    [strefa upuszcz.]  │  ─ Wyszukiwarka (tab: Tabela)   │
│    [lista plików]     │  ─ Tabela wynikowa              │
│  ─ Przyciski:         │                                 │
│    ▶ Konsoliduj       │                                 │
│    ↓ Eksport TSV      │                                 │
│    ↓ Eksport Markdown │                                 │
│    ⬇ Zapisz do DOCX   │                                 │
└───────────────────────┴─────────────────────────────────┘
```

### Kolory i motyw

Aplikacja używa jasnego motywu (light theme):

| Zmienna CSS | Wartość | Zastosowanie |
|---|---|---|
| `--bg` | `#f4f5f9` | Tło główne |
| `--s1` | `#ffffff` | Tło kart i sidebaru |
| `--s2` | `#eaecf4` | Tło drugorzędne |
| `--bd` | `#d2d5e0` | Obramowania |
| `--acc` | `#0d9e74` | Akcent główny (zielony) |
| `--acc2` | `#6b48c8` | Akcent drugorzędny (fioletowy) — przycisk DOCX |
| `--tx` | `#1c1c2e` | Tekst główny |
| `--mu` | `#6b7080` | Tekst drugorzędny |
| `--er` | `#c0283e` | Błędy |
| `--wa` | `#b06010` | Ostrzeżenia |

### Kolorowanie kolumn w tabeli

| Klasa | Kolor | Kolumna |
|---|---|---|
| `.c-id` | zielony akcent, monospace | ID |
| `.c-sc` | szary, monospace | Score |
| `.c-src` | tekst główny | Source |
| `.c-tgt` | ciemny zielony | Target (wypełniony) |
| `.c-emp` | szary, kursywa | Target (pusty, „—") |

---

## 8. Historia powstania aplikacji

### Etap 0 — Punkt wyjścia

Aplikacja dostarczona jako plik `locmerge.zip` zawierający podstawowy szkielet React + Vite z obsługą wyłącznie plików TSV. Interfejs korzystał z ciemnego motywu z małą czcionką.

### Etap 1 — Instalacja i konfiguracja środowiska (v0.1)

**Czynności:**
- Wypakowanie ZIP do katalogu `locmerge/`
- Uruchomienie `npm install` w katalogu projektu
- Konfiguracja pliku `.claude/launch.json` dla narzędzia `preview_start`:
  ```json
  { "runtimeArgs": ["--prefix", "locmerge", "run", "dev"] }
  ```
- Dodanie `host: '127.0.0.1'` do `vite.config.js` (rozwiązanie problemu IPv6 vs IPv4)

**Napotkany problem:**
Vite domyślnie bindował się do `[::1]:5173` (IPv6), ale narzędzie podglądu łączyło się z `127.0.0.1` (IPv4). Rozwiązanie: jawne ustawienie `host: '127.0.0.1'` w konfiguracji Vite.

### Etap 2 — Poprawki interfejsu (v0.2)

**Czynności:**
- Zmiana motywu z ciemnego na jasny:
  - Tło: `#090910` → `#f4f5f9`
  - Tekst: `#e0e0ee` → `#1c1c2e`
- Powiększenie czcionki: 13px → 15px
- Zmiana czcionki: Courier New → Segoe UI (z fallbackiem do system-ui)
- Layout pełnoekranowy: `min-height: 100vh`, `flex-direction: column`

### Etap 3 — Obsługa plików XLSX (v0.5)

**Problem:**
Użytkownik wgrał pliki `.docx`, które były interpretowane jako tekst — w tabeli wynikowej pojawiały się znaki binarne (nagłówek ZIP: `PK`, `[CONTENT_TYPES].XML`).

**Rozwiązanie:**
- Dodanie biblioteki SheetJS (`xlsx`): `npm install xlsx`
- Implementacja funkcji `parseXLSX()` z użyciem `reader.readAsArrayBuffer()`
- Detekcja formatu pliku na podstawie rozszerzenia (`isXLSX()`)

### Etap 4 — Obsługa plików DOCX (v0.8)

**Problem:**
Pliki wejściowe użytkownika to pliki `.txlf.docx` generowane przez Wordfast — format DOCX (ZIP z `word/document.xml`).

**Rozwiązanie:**
- Dodanie biblioteki JSZip (`jszip`): `npm install jszip`
- Implementacja funkcji `parseDOCX()`:
  - `JSZip.loadAsync(buffer)` — otwarcie pliku jako ZIP
  - `zip.file("word/document.xml").async("string")` — odczyt XML
  - `DOMParser.parseFromString(xml, "text/xml")` — parsowanie
  - Iteracja po `<w:tbl>`, `<w:tr>`, `<w:tc>`, `<w:t>`

### Etap 5 — Naprawa parsera DOCX: wielotabelowe pliki (v0.9)

**Problem:**
Rzeczywiste pliki `.txlf.docx` zawierają **3 tabele**. Parser zawsze wybierał `tables[0]` — tabelę legendy z opisami statusów segmentów. W efekcie jako „dane" parsowane były opisy takie jak „Locked segment - modifications will be ignored".

**Diagnoza:**
Analiza struktury XML za pomocą Node.js + JSZip z `node_modules`:
```javascript
// Skrypt diagnostyczny (inspect3.js)
const zip = await JSZip.loadAsync(fs.readFileSync(filePath));
const xml = await zip.file("word/document.xml").async("string");
// → znaleziono 3 tabele, każda z inną liczbą wierszy i nagłówkami
```

Wyniki analizy:
- Tabela 0: 8 wierszy, nagłówki: `["Locked segment — modifications will be ignored", ""]`
- Tabela 1: 6 wierszy, nagłówki: `["Key", "Value"]`
- Tabela 2: 47 wierszy, nagłówki: `["ID", "Source (en-us)", "Target (pl-pl)", "Score"]` ← właściwa

**Rozwiązanie:**
- Implementacja `isDataHeader()` — sprawdzenie czy wiersz zawiera ID + kolumnę treści
- Implementacja `findBestTable()` — priorytet: tabela z nagłówkiem danych, największa liczba wierszy

### Etap 6 — Eksport wyników do DOCX (v1.2)

**Wymaganie użytkownika:**
Po konsolidacji chciał zapisać wyniki z powrotem do oryginalnego pliku Master DOCX — uzupełnić kolumnę Target/Tłumaczenie i pobrać gotowy plik.

**Implementacja:**

1. **Buforowanie pliku Master**: podczas wgrywania pliku DOCX, `ArrayBuffer` jest przechowywany w stanie `files[i].buffer` i przekazywany do `result.masterBuffer`

2. **`setCellText(tc, text)`**: funkcja aktualizacji komórki z zachowaniem formatowania:
   - Zachowuje `<w:tcPr>` (właściwości komórki), `<w:pPr>` (paragraf), `<w:rPr>` (run)
   - Usuwa tylko stare elementy `<w:t>`, tworzy nowy
   - Obsługuje `xml:space="preserve"` dla spacji brzegowych

3. **`exportToDOCX()`**: kompletny pipeline eksportu:
   - Otwórz ZIP → parsuj XML → znajdź tabelę → aktualizuj wiersze → zapisz XML → spakuj ZIP → Blob

4. **`handleExportDOCX()`**: handler React który wywołuje `exportToDOCX` i inicjuje pobieranie przez:
   ```javascript
   const url = URL.createObjectURL(blob);
   const a = document.createElement("a");
   a.href = url; a.download = baseName + "_consolidated.docx";
   a.click();
   URL.revokeObjectURL(url);
   ```

5. **Przycisk UI**: fioletowy przycisk `⬇ Zapisz do DOCX` (klasa `.btn-docx`) widoczny tylko gdy Master był plikiem DOCX

### Etap 7 — Kontrola wersji i GitHub (v1.0 tag)

**Czynności:**
- Inicjalizacja repozytorium git: `git init`
- Utworzenie `.gitignore` (wyklucza `node_modules/`, `dist/`, `.env`)
- Commit v1.0: `git commit -m "v1.0 — LocMerge: konsolidacja danych lokalizacyjnych"`
- Tag: `git tag v1.0`
- Utworzenie gałęzi deweloperskiej: `git checkout -b v1.2-dev`
- Commit funkcji eksportu DOCX: `git commit -m "v1.2 feat: eksport wyników..."`
- Podłączenie do GitHub: `git remote add origin https://github.com/mikesoloo/LocMerge`
- Push: `git push -u origin master && git push origin v1.2-dev && git push --tags`

---

## 9. Napotykane problemy i rozwiązania

### Problem 1: ERR_CONNECTION_REFUSED na 127.0.0.1:5173

**Przyczyna:** Vite domyślnie binduje się do `::1` (IPv6 loopback), a narzędzie podglądu łączyło się z `127.0.0.1` (IPv4).

**Rozwiązanie:** Dodanie do `vite.config.js`:
```javascript
server: { host: '127.0.0.1', port: 5173 }
```

### Problem 2: Garble w tabeli (PK, [CONTENT_TYPES].XML)

**Przyczyna:** Pliki DOCX to archiwum ZIP. Odczyt przez `FileReader.readAsText()` traktuje bajty binarne jako UTF-8, co daje śmieciowe znaki.

**Rozwiązanie:** Użycie `FileReader.readAsArrayBuffer()` i parsowanie binarnego formatu bibliotekami JSZip i SheetJS.

### Problem 3: Parser wybiera złą tabelę z pliku DOCX

**Przyczyna:** Pliki TXLF mają 3 tabele; parser zawsze brał `tables[0]` (legendę).

**Rozwiązanie:** Implementacja `isDataHeader()` i `findBestTable()` z inteligentną selekcją tabeli.

### Problem 4: Nagłówki kolumn z locale (np. „Source (en-us)")

**Przyczyna:** Wordfast dodaje kod języka do nazw kolumn, np. `"Source (en-us)"`, `"Target (pl-pl)"`.

**Rozwiązanie:** Dopasowanie oparte na `includes()` zamiast porównania dokładnego. Np.:
```javascript
headers.find(h => h.toLowerCase().includes("source"))
```

### Problem 5: Konflikty portów przy restarcie

**Przyczyna:** Procesy Node.js z poprzednich sesji zajmowały port 5173.

**Rozwiązanie:** Kill procesów przez PowerShell:
```powershell
Stop-Process -Id <PID> -Force
```

### Problem 6: npm nie znajduje package.json

**Przyczyna:** Narzędzie `preview_start` uruchamia procesy z katalogu nadrzędnego (`C:\...\claude_code\`), nie z `locmerge\`.

**Rozwiązanie:** Użycie flagi `--prefix` w konfiguracji launch.json:
```json
"runtimeArgs": ["--prefix", "locmerge", "run", "dev"]
```

### Problem 7: XMLSerializer usuwa namespace'y DOCX

**Obserwacja:** Przy serializacji XML wewnętrzne namespace'y DOCX (np. `xmlns:w`, `xmlns:r`) mogą zostać zmienione przez przeglądarkowe implementacje `XMLSerializer`.

**Rozwiązanie:** `XMLSerializer.serializeToString()` zachowuje zadeklarowane namespace'y wystarczająco dobrze dla formatu DOCX — Word akceptuje nieznaczne zmiany w deklaracjach NS.

---

## 10. Wersjonowanie i GitHub

### Historia wersji

| Wersja | Gałąź | Opis |
|---|---|---|
| v1.0 | `master` (tag `v1.0`) | Stabilna wersja z obsługą TSV, XLSX, DOCX i eksportem TSV/MD |
| v1.2 | `v1.2-dev` | Dodano eksport wyników z powrotem do oryginalnego pliku DOCX |

### Repozytorium GitHub

- **URL**: https://github.com/mikesoloo/LocMerge
- **Gałęzie**: `master` (stabilna), `v1.2-dev` (deweloperska)
- **Tagi**: `v1.0`

### Struktura commitów

```
e8fdc2d v1.2 feat: eksport wyników z powrotem do oryginalnego pliku DOCX  [v1.2-dev]
1200db4 v1.0 — LocMerge: konsolidacja danych lokalizacyjnych               [master, v1.0]
```

---

## 11. Uruchomienie lokalne

### Wymagania

- Node.js >= 18
- npm >= 9

### Kroki

```bash
# Klonuj repozytorium
git clone https://github.com/mikesoloo/LocMerge.git
cd LocMerge

# Zainstaluj zależności
npm install

# Uruchom serwer deweloperski
npm run dev
```

Aplikacja dostępna pod adresem: **http://127.0.0.1:5173**

### Build produkcyjny

```bash
npm run build
# Wynik w katalogu dist/
npm run preview
# Podgląd builda pod http://localhost:4173
```

Build produkcyjny generuje pliki statyczne, które można wdrożyć na dowolnym serwerze HTTP (GitHub Pages, Netlify, Vercel, nginx, Apache).

---

## 12. Słownik pojęć

| Pojęcie | Wyjaśnienie |
|---|---|
| **CAT** | Computer-Assisted Translation — narzędzie wspomagające tłumaczenie (Wordfast, SDL Trados, memoQ) |
| **TXLF** | Format pliku Wordfast Pro — XML opakowany w ZIP, często z rozszerzeniem `.txlf.docx` |
| **MT** | Machine Translation — tłumaczenie maszynowe (np. DeepL, Google Translate) |
| **Score** | Ocena jakości tłumaczenia maszynowego (0–100%) |
| **Master** | Główny plik projektowy z wszystkimi segmentami do tłumaczenia |
| **Partia (Batch)** | Plik wynikowy od tłumacza z finalnymi tłumaczeniami segmentów |
| **Segment** | Jednostka tekstu do tłumaczenia (zdanie, fraza), identyfikowana przez ID |
| **Konsolidacja** | Proces łączenia tłumaczeń z Partii do pliku Master na podstawie ID |
| **SPA** | Single Page Application — aplikacja działająca w całości w przeglądarce bez przeładowań strony |
| **ArrayBuffer** | Niskopoziomowy bufor binarny w JavaScript — używany do pracy z plikami DOCX i XLSX |
| **DOMParser** | Wbudowane Web API do parsowania XML/HTML w przeglądarce |
| **XMLSerializer** | Wbudowane Web API do serializacji drzewa DOM z powrotem do tekstu XML |
| **Blob** | Obiekt przeglądarki reprezentujący dane binarne (używany do pobierania plików) |
| **JSZip** | Biblioteka JavaScript do odczytu i zapisu plików ZIP (w tym DOCX) |
| **SheetJS (xlsx)** | Biblioteka JavaScript do odczytu i zapisu plików Excel |

---

*Dokumentacja przygotowana przez Claude (Anthropic) w trakcie sesji deweloperskiej z użyciem Claude Code.*
*Ostatnia aktualizacja: 2026-02-25*
