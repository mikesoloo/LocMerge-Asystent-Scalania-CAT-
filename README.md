# LocMerge 🔀

Agent konsolidacji danych lokalizacyjnych.

## Uruchomienie

```bash
npm install
npm run dev
```

Otwórz http://localhost:5173 w przeglądarce.

## Build produkcyjny

```bash
npm run build
npm run preview
```

## Jak używać

1. **Wgraj plik Master** – plik TSV z kolumnami: `ID | Source | Target | Score`
2. **Wgraj pliki Partii** – pliki TSV z kolumnami: `ID | Final Translation`
3. Kliknij **Konsoliduj**
4. Sprawdź wyniki i wyeksportuj jako **TSV** lub **Markdown**
