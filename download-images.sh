#!/bin/bash
# Download all images from WordPress CDN for self-hosting
# Run this script from the repo root directory

mkdir -p assets/images

echo "Downloading images from WordPress CDN..."

curl -o assets/images/logo.png "https://lirp.cdn-website.com/56c34cf0/dms3rep/multi/opt/Attachment_1636041100.png-8965d9a2-1920w.png"
curl -o assets/images/logo-small.png "https://lirp.cdn-website.com/56c34cf0/dms3rep/multi/opt/Attachment_1636041100.png-8965d9a2-238w.png"
curl -o assets/images/james-larosa-tweet.webp "https://lirp.cdn-website.com/56c34cf0/dms3rep/multi/opt/snippet-951b07b3-561w.webp"
curl -o assets/images/google-search-screenshot.jpg "https://lirp.cdn-website.com/56c34cf0/dms3rep/multi/opt/restoration+google+search-1015h.jpg"
curl -o assets/images/romexterra-logo.webp "https://lirp.cdn-website.com/56c34cf0/dms3rep/multi/opt/romexterra-restoration-logo-240h.webp"
curl -o assets/images/ercolano-logo.webp "https://lirp.cdn-website.com/56c34cf0/dms3rep/multi/opt/596015a6-aeb6-4b3f-aec4-590f0d18978e-73be85a0-1920w-233w.webp"
curl -o assets/images/green-state-logo.webp "https://lirp.cdn-website.com/56c34cf0/dms3rep/multi/opt/logo_trans-157w-209w.webp"
curl -o assets/images/sunshine-logo.webp "https://lirp.cdn-website.com/56c34cf0/dms3rep/multi/opt/Logo-SunshineResto-218w-370w.webp"
curl -o assets/images/1800-water-damage-logo.png "https://lirp.cdn-website.com/56c34cf0/dms3rep/multi/opt/1800-water-damage-of-utah-county-180h.png"
curl -o assets/images/results-dashboard.png "https://lirp.cdn-website.com/56c34cf0/dms3rep/multi/opt/Group-860-8f68a0d5-790w.png"
curl -o assets/images/restoheroes-logo.webp "https://lirp.cdn-website.com/56c34cf0/dms3rep/multi/opt/restoheroes-main-logo-240w-1920w.webp"

echo "Done! Images saved to assets/images/"
echo ""
echo "To switch HTML to self-hosted images, run:"
echo "  find . -name '*.html' -exec sed -i 's|https://lirp.cdn-website.com/56c34cf0/dms3rep/multi/opt/Attachment_1636041100.png-8965d9a2-238w.png|/assets/images/logo-small.png|g' {} \;"
echo "  (repeat for each image URL)"
