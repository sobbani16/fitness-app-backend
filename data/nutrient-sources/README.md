# Nutrient source cache

USDA FoodData Central records retrieved October 27, 2026. USDA publishes these data under CC0. Attribution: USDA FoodData Central, https://fdc.nal.usda.gov/.

Each usda/*.json retains the complete record, retrieval timestamp and official endpoint. Profiles retain source ID, dataset, publication date, URL and SHA-256 digest. Source confirmation does not mean every quantity was laboratory measured; original derivation metadata remains in the cache.

Sources: https://fdc.nal.usda.gov/api-guide/ and https://fdc.nal.usda.gov/download-datasets/. Candidates include existing source IDs and exact normalized names from SR Legacy April 2018 and Foundation April 2026. Conflicting identity/preparation and multiple candidates require review.

Resume missing IDs using `npm run nutrients:fetch -- data/nutrient-sources/fdc-ids.json` with USDA_API_KEY configured securely. Existing cache files are retained. Filter official bulk datasets using `node scripts/cache-nutrient-dataset.js ingredients-snapshot.json dataset.json OFFICIAL_DOWNLOAD_URL`.

IFCT requires a licensed, reviewed normalized export via --reviewed-dir. No unlicensed IFCT quantities were imported. See the mobile repository's docs/NUTRIENT_INTELLIGENCE_PHASE_2.md for commands and review procedures.
