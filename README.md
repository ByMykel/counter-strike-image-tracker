# Counter Strike Image Tracker

A repository to track CS:GO item images from Steam's CDN and game files.

This project collects and organizes CS2 item images in two ways:

1. **CDN Images** - Images with known CDN URLs are stored in [static/images.json](https://raw.githubusercontent.com/ByMykel/counter-strike-image-tracker/refs/heads/main/static/images.json)
2. **Game Files** - Raw images extracted from CS2 game files that we don't have the CDN are stored in the `static/` directory

## Current Status

**⚠️ Help Needed: Missing CDN Images**

There are still **1,800 CDN images** that need to be found! These are primarily non-marketable items that don't appear on Steam Market listings.

### How to Help

1. Visit [https://bymykel.com/counter-strike-items/#/collectibles](https://bymykel.com/counter-strike-items/#/collectibles)
2. Press `Ctrl + D` to see items with yellow borders (missing CDN images)
3. Click on any yellow-bordered item to see its `image_inventory` value
4. If you have the item in your inventory or know someone who does:
   - Right-click the image in their inventory
   - Select "Copy image address"
   - Find the corresponding `image_inventory` in `images.json`
   - Replace the null value with the CDN URL

**Issue Reference**: [#12 - Add missing CDN images](https://github.com/ByMykel/counter-strike-image-tracker/issues/12)
