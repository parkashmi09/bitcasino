# Seed coin images (migration 061)

Copied from `frontend/public/coins` (see its README for sources and licences:
cryptocurrency-icons CC0-1.0, Web3 Icons MIT, `inr.svg` drawn for the site;
`eur pkr bdt npr mvr aed nc` drawn for the site from Noto Sans outlines, SIL OFL 1.1; `idr.svg` drawn for the site, "Rp" as text, migration 151).
Migration `061-currencies.js` reads `<code>.svg` from here into
`currencies.image_data`. After that the image is managed in the site admin
(Finance → Coins) and this folder is only the seed.

Migration `066-coin-seed-images.js` fills these into an existing registry, only
for a coin that still has no image (an image uploaded in the admin is kept).
