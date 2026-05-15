# Pipeline Report — 2026-05-15

**Run started:** 2026-05-15T17:56:25.310Z  
**Run ended:**   2026-05-15T17:56:29.554Z  
**Duration:**    4.2s  

## Stage Results

| Stage          | Status   | Notes                                                        |
|----------------|----------|--------------------------------------------------------------|
| ExtractAgent   | OK       | 29/29 verified, gap 71 to target |
| SortAgent      | OK       | 169 ranked rows, 169 with affiliate links |
| UploadAgent    | OK       | dry-run: built + validated, no push |

## Extract Summary

- Total rows: 29  
- Verified: 29

## Sort Summary

- Ranked rows: 169  
- Rows with affiliate link: 169  
- Missing links: 0

## Next Steps

- Review `data/Extract.md` for any Failed rows
- If hotel count is below 100, add more hotels to `data/hotels.json`
- Run `node agents/run_pipeline.js` again after adding hotels
