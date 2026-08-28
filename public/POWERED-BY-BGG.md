# Powered by BGG logo

BoardGameGeek requires public-facing apps that use the XML API to display the
"Powered by BGG" logo. The artwork is BGG's, so it is not vendored here.

To add it:

1. Download the official logo from https://boardgamegeek.com/using_the_xml_api
2. Save it in this directory as `powered-by-bgg.png`

`app/(app)/inventory/add/games/powered-by-bgg.tsx` picks it up automatically
and falls back to a text credit while the file is absent.
