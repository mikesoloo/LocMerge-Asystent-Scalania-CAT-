# LocMerge 🔀

**Agent konsolidacji danych lokalizacyjnych**

Przeglądarkowa aplikacja SPA do scalania wyników tłumaczenia maszynowego z plikami roboczymi narzędzi CAT (Wordfast/TXLF). Działa w całości lokalnie w przeglądarce — żadne dane nie są wysyłane na serwer.

[![GitHub](https://img.shields.io/badge/GitHub-mikesoloo%2FLocMerge-blue)](https://github.com/mikesoloo/LocMerge)

---

## Funkcje

- **Wgrywanie pliku Master** — TSV, XLSX, DOCX (w tym pliki `.txlf.docx` Wordfast)
- **Wgrywanie wielu plików Partii** — dowolna liczba plików z tłumaczeniami
- **Automatyczna detekcja ról** — Master vs Partia na podstawie nagłówków kolumn
- **Konsolidacja po ID** — automatyczne dopasowanie segmentów
- **Statystyki pokrycia** — ile segmentów uzupełniono, ile brakuje
- **Eksport TSV / Markdown** — kopiowanie wyników do schowka
- **Eksport do DOCX** — zapis wyników z powrotem do oryginalnego pliku Master z zachowaniem formatowania

## Obsługiwane formaty

| Format | Rozszerzenie |
|---|---|
| Tab-separated values | `.tsv`, `.txt`, `.csv` |
| Microsoft Excel | `.xlsx`, `.xls`, `.ods` |
| Microsoft Word / CAT | `.docx` (w tym Wordfast `.txlf.docx`) |

## Uruchomienie

```bash
git clone https://github.com/mikesoloo/LocMerge.git
cd LocMerge
npm install
npm run dev
```

Otwórz **http://127.0.0.1:5173** w przeglądarce.

## Build produkcyjny

```bash
npm run build
npm run preview
```

## Jak używać

1. **Wgraj plik Master** — plik z kolumnami: `ID | Source | Target | Score`
2. **Wgraj pliki Partii** — pliki z kolumnami: `ID | Final Translation`
3. Kliknij **▶ Konsoliduj**
4. Sprawdź wyniki w zakładkach Tabela / Markdown / TSV
5. Opcjonalnie: **⬇ Zapisz do DOCX** — pobierz zmodyfikowany plik Master

## Stos technologiczny

- **React 18** + **Vite 5** — framework i bundler
- **JSZip 3.10** — parsowanie i generowanie plików DOCX
- **SheetJS (xlsx) 0.18.5** — parsowanie plików Excel

## Wersje

| Wersja | Gałąź | Opis |
|---|---|---|
| v1.0 | `master` | Stabilna: TSV + XLSX + DOCX, eksport TSV/MD |
| v1.2 | `v1.2-dev` | Eksport wyników z powrotem do DOCX |

## Dokumentacja

Pełna dokumentacja techniczna i historia rozwoju: [DOKUMENTACJA.md](./DOKUMENTACJA.md)

---

*Zbudowane z Claude Code (Anthropic Claude)*
